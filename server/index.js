const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Debug: Log available environment variables
console.log('Environment variables check:');
console.log('GOOGLE_CLIENT_EMAIL:', process.env.GOOGLE_CLIENT_EMAIL ? 'SET' : 'MISSING');
console.log('GOOGLE_PRIVATE_KEY:', process.env.GOOGLE_PRIVATE_KEY ? 'SET' : 'MISSING');
console.log('GOOGLE_PRIVATE_KEY length:', process.env.GOOGLE_PRIVATE_KEY?.length || 0);
console.log('GOOGLE_PRIVATE_KEY format:', process.env.GOOGLE_PRIVATE_KEY?.substring(0, 50) + '...');
console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'SET' : 'MISSING');
console.log('GOOGLE_PROJECT_ID:', process.env.GOOGLE_PROJECT_ID ? 'SET' : 'MISSING');
console.log('SPREADSHEET_ID:', process.env.SPREADSHEET_ID ? 'SET' : 'MISSING');

// Middleware
app.use(cors());
app.use(express.json());

// -----------------------------
// Google Sheets setup
// -----------------------------
let sheets = null;

// Validate required environment variables
const requiredEnvVars = [
  'GOOGLE_CLIENT_EMAIL',
  'GOOGLE_PRIVATE_KEY', 
  'GOOGLE_CLIENT_ID',
  'GOOGLE_PROJECT_ID',
  'SPREADSHEET_ID'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('Missing required environment variables:', missingVars.join(', '));
  console.error('Please check your Vercel environment variables configuration');
} else {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: "service_account",
        project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
        private_key: (() => {
          const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
          if (!rawKey.trim()) return '';
          if (rawKey.startsWith('-----BEGIN')) {
            return rawKey.replace(/\\n/g, '\n').trim();
          }
          try {
            const decoded = Buffer.from(rawKey, 'base64').toString('utf-8');
            if (decoded.includes('-----BEGIN')) {
              return decoded.replace(/\\n/g, '\n').trim();
            }
          } catch (error) {
            console.warn('Failed to base64-decode GOOGLE_PRIVATE_KEY, using raw value');
          }
          return rawKey.replace(/\\n/g, '\n').trim();
        })(),
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
        universe_domain: "googleapis.com",
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    sheets = google.sheets({ version: 'v4', auth });
    console.log('Google Sheets API initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Google Sheets API:', error.message);
  }
}

// -----------------------------
// Helpers
// -----------------------------
async function getSheetValues(spreadsheetId, range) {
  if (!sheets) {
    throw new Error('Google Sheets API not initialized');
  }
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.data.values || [];
}

function safeStr(v) {
  return (v ?? '').toString().trim();
}

function toMinutes(timeStr) {
  // forgiving time parser: "9:21 AM"
  const s = safeStr(timeStr);
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && hh !== 12) hh += 12;
  if (ap === 'AM' && hh === 12) hh = 0;
  return hh * 60 + mm;
}

function matchStageRank(match) {
  // Lower rank = earlier in the day/phase. We want Finals at the end.
  const label = `${safeStr(match?.team1)} ${safeStr(match?.team2)}`.toLowerCase();

  // Championship/Final last
  if (label.includes('championship') || label.includes('final')) return 99;

  // Consolation + placement games.
  // IMPORTANT: these should happen AFTER QFs but BEFORE SFs.
  // If they are ranked after SFs, the sequentializer can push SFs later in the day.
  if (label.includes('consol') || label.includes('dev ') || label.includes('place')) return 45;

  // Then semis
  if (label.includes('sf') || label.includes('semi')) return 50;

  // Then quarters
  if (label.includes('qf') || label.includes('quarter')) return 40;

  return 0;
}

function deriveEliteConsolChampionship({ scheduleData, bracketFromSheet, resolvedBracket }) {
  // Winner Elite Consol 1 vs Winner Elite Consol 2.
  // We can only resolve winners if the Bracket sheet has scores filled in for those consolation games.
  // Otherwise we keep placeholders.
  const getWinner = (m) => safeStr(m?.winner) || null;
  const ec1 = bracketFromSheet?.consolationElite?.[0];
  const ec2 = bracketFromSheet?.consolationElite?.[1];

  const w1 = getWinner(ec1);
  const w2 = getWinner(ec2);

  return {
    time: '', // assigned later by sequentializer if needed
    field: 'Field 1',
    team1: `Elite Consol Championship: ${w1 || 'Winner EC1'}`,
    score: 'vs',
    team2: w2 || 'Winner EC2',
  };
}

function sortScheduleBucket(matches) {
  // Sort by time first; within same time slot push later-stage games later
  return [...matches].sort((a, b) => {
    const am = toMinutes(a.time);
    const bm = toMinutes(b.time);
    if (am !== null && bm !== null && am !== bm) return am - bm;

    // Same/unknown time: sort by stage rank
    const ar = matchStageRank(a);
    const br = matchStageRank(b);
    if (ar !== br) return ar - br;

    // Stable: Field 1 before Field 2
    const af = safeStr(a.field);
    const bf = safeStr(b.field);
    if (af !== bf) return af.localeCompare(bf);
    return `${safeStr(a.team1)}|${safeStr(a.team2)}`.localeCompare(`${safeStr(b.team1)}|${safeStr(b.team2)}`);
  });
}

function addMinutesToTime(timeStr, minutesToAdd) {
  const base = toMinutes(timeStr);
  if (base === null) return null;
  const total = base + minutesToAdd;
  const hh24 = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const ap = hh24 >= 12 ? 'PM' : 'AM';
  let hh12 = hh24 % 12;
  if (hh12 === 0) hh12 = 12;
  return `${hh12}:${String(mm).padStart(2, '0')} ${ap}`;
}

function sequentializePhase2ToField1(matches, { incrementMinutes = 21 } = {}) {
  // For Phase 2 we want everything on Field 1.
  // If multiple games collide in the same time slot, move the extra ones forward
  // by incrementMinutes until an open slot exists.
  const used = new Set();

  // Work on a copy, and sort by time first for stable scheduling.
  // Within the same time slot, keep deeper bracket games first (QF -> SF -> consolation/placement -> final).
  const ordered = [...matches].sort((a, b) => {
    const am = toMinutes(a.time);
    const bm = toMinutes(b.time);
    if (am !== null && bm !== null && am !== bm) return am - bm;

    const ar = matchStageRank(a);
    const br = matchStageRank(b);
    if (ar !== br) return br - ar;

    // Stable: Field 1 before Field 2
    const af = safeStr(a.field);
    const bf = safeStr(b.field);
    if (af !== bf) return af.localeCompare(bf);
    return `${safeStr(a.team1)}|${safeStr(a.team2)}`.localeCompare(`${safeStr(b.team1)}|${safeStr(b.team2)}`);
  });
  const out = [];

  for (const m of ordered) {
    const baseTime = safeStr(m.time);
    const minutes = toMinutes(baseTime);
    if (minutes === null) {
      // Unknown time: still force Field 1.
      out.push({ ...m, field: 'Field 1' });
      continue;
    }

    let t = baseTime;
    // Find next open slot (Field 1 only)
    while (used.has(t)) {
      const next = addMinutesToTime(t, incrementMinutes);
      if (!next) break;
      t = next;
    }

    used.add(t);
    out.push({ ...m, time: t, field: 'Field 1' });
  }

  return out;
}

function parseScore(scoreText) {
  // expects "15-8"
  const s = safeStr(scoreText);
  const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  return { a: parseInt(m[1], 10), b: parseInt(m[2], 10) };
}

function parseTeamsFromTeamsSheet(rows) {
  // Template format: Two columns
  // Column A: Team name
  // Column B: Pool (A, B, C, or D)
  const pools = {
    poolA: [],
    poolB: [],
    poolC: [],
    poolD: [],
  };

  rows.forEach((row, idx) => {
    // Skip header row
    if (idx === 0) return;
    
    const team = safeStr(row[0]);
    const pool = safeStr(row[1]);
    
    // Skip empty rows
    if (!team || !pool) return;
    
    // Assign team to appropriate pool
    if (pool === 'A') pools.poolA.push(team);
    else if (pool === 'B') pools.poolB.push(team);
    else if (pool === 'C') pools.poolC.push(team);
    else if (pool === 'D') pools.poolD.push(team);
  });

  // Build reverse map team -> poolKey
  const teamToPool = {};
  Object.entries(pools).forEach(([poolKey, teams]) => {
    teams.forEach((t) => (teamToPool[t] = poolKey));
  });

  return { pools, teamToPool };
}

function parseScheduleRows(scheduleRows) {
  // Expected schedule format (your current):
  // [Time, F1 Team1, F1 Score, F1 Team2, F2 Team1, F2 Score, F2 Team2]
  // We skip header rows and return normalized matches.
  const out = [];

  scheduleRows.forEach((row, idx) => {
    if (!row || row.length === 0) return;

    const time = safeStr(row[0]);
    if (!time) return;

    // skip header row(s)
    if (time.toLowerCase() === 'time') return;
    if (time.includes('SCHDULE') || time.includes('SCHEDULE')) return;

    // Must have at least 4 cols for field1 match
    const f1t1 = safeStr(row[1]);
    const f1s = safeStr(row[2]);
    const f1t2 = safeStr(row[3]);

    // Field2 is optional (but usually present)
    const f2t1 = safeStr(row[4]);
    const f2s = safeStr(row[5]);
    const f2t2 = safeStr(row[6]);

    out.push({
      time,
      field1: f1t1 && f1t2 ? { team1: f1t1, score: f1s, team2: f1t2 } : null,
      field2: f2t1 && f2t2 ? { team1: f2t1, score: f2s, team2: f2t2 } : null,
      _rowIndex: idx,
    });
  });

  return out;
}

function computeStandings({ pools, teamToPool }, scheduleMatches) {
  // stats per team
  const stats = {};
  const ensure = (team) => {
    if (!stats[team]) stats[team] = { wins: 0, pf: 0, pa: 0, pd: 0, games: 0 };
    return stats[team];
  };

  // initialize all teams (so we can still seed if some scores missing)
  Object.values(pools).flat().forEach(ensure);

  const recordMatch = (team1, scoreText, team2) => {
    team1 = safeStr(team1);
    team2 = safeStr(team2);
    if (!team1 || !team2) return;

    const p1 = teamToPool[team1];
    const p2 = teamToPool[team2];
    if (!p1 || !p2) return;

    // Only count pool-play games *within the same pool*
    if (p1 !== p2) return;

    const score = parseScore(scoreText);
    if (!score) return;

    const s1 = ensure(team1);
    const s2 = ensure(team2);

    s1.games += 1;
    s2.games += 1;

    s1.pf += score.a;
    s1.pa += score.b;
    s2.pf += score.b;
    s2.pa += score.a;

    s1.pd = s1.pf - s1.pa;
    s2.pd = s2.pf - s2.pa;

    if (score.a > score.b) s1.wins += 1;
    else if (score.b > score.a) s2.wins += 1;
    // ties: no wins; add tie-breakers here if needed
  };

  scheduleMatches.forEach((m) => {
    if (m.field1) recordMatch(m.field1.team1, m.field1.score, m.field1.team2);
    if (m.field2) recordMatch(m.field2.team1, m.field2.score, m.field2.team2);
  });

  const standings = {};
  Object.entries(pools).forEach(([poolKey, teams]) => {
    standings[poolKey] = [...teams].sort((a, b) => {
      const A = stats[a] || { wins: 0, pd: 0, pf: 0 };
      const B = stats[b] || { wins: 0, pd: 0, pf: 0 };

      // 1) wins
      if (B.wins !== A.wins) return B.wins - A.wins;
      // 2) point differential
      if (B.pd !== A.pd) return B.pd - A.pd;
      // 3) points for
      if (B.pf !== A.pf) return B.pf - A.pf;
      // 4) stable
      return a.localeCompare(b);
    });
  });

  return { standings, stats };
}

function parseBracketSheet(bracketRows) {
  // Reads bracket rows into sections in order:
  // quarterfinals: 4 matches
  // semifinals: 2 matches
  // final: 1 match
  // consolationElite: 2 matches
  // eliteConsolationChampionship: 1 match
  // consolationDevelopment: 3 matches
  const sections = {
    quarterfinals: [],
    semifinals: [],
    final: [],
    consolationElite: [],
    eliteConsolationChampionship: [],
    consolationDevelopment: [],
  };

  let section = null;

  const setSection = (row0) => {
    const t = safeStr(row0).toLowerCase();
    if (t.includes('quarterfinal')) section = 'quarterfinals';
    else if (t.includes('semifinal')) section = 'semifinals';
    else if (t === 'final' || t.includes('final')) section = 'final';
    else if (t.includes('consolation elite')) section = 'consolationElite';
    else if (t.includes('elite consol') && t.includes('championship')) section = 'eliteConsolationChampionship';
    else if (t.includes('consolation development')) section = 'consolationDevelopment';
  };

  bracketRows.forEach((row) => {
    if (!row || row.length === 0) return;
    const c0 = safeStr(row[0]);
    const c1 = safeStr(row[1]);

    if (c0 && !c1) {
      // likely a header line
      setSection(c0);
      return;
    }

    if (!section) return;

    // match rows should have team1, team2, score1, score2
    if (c0 && c1) {
      const score1 = safeStr(row[2]) || '0';
      const score2 = safeStr(row[3]) || '0';

      // winner/loser if numeric
      const s1 = parseInt(score1, 10);
      const s2 = parseInt(score2, 10);
      let winner = null;
      let loser = null;
      if (!isNaN(s1) && !isNaN(s2) && (s1 !== 0 || s2 !== 0)) {
        winner = s1 > s2 ? c0 : c1;
        loser = s1 > s2 ? c1 : c0;
      }

      sections[section].push({
        team1: c0,
        team2: c1,
        score1: score1,
        score2: score2,
        winner,
        loser,
      });
    }
  });

  return sections;
}

function findMatchResultFromSchedule({ scheduleMatches, time, field }) {
  const targetTime = safeStr(time);
  const targetField = safeStr(field);

  // Find matching schedule row by time and field.
  // We prefer exact time match; field can be "Field 1" or "Field 2".
  const row = scheduleMatches.find((r) => safeStr(r.time) === targetTime);
  if (!row) return null;

  const slot = targetField === 'Field 2' ? row.field2 : row.field1;
  if (!slot) return null;

  const score = parseScore(slot.score);
  if (!score) return null;

  const team1 = safeStr(slot.team1);
  const team2 = safeStr(slot.team2);
  if (!team1 || !team2) return null;

  // If a score is present but tied, treat as no-winner for now.
  let winner = null;
  let loser = null;
  if (score.a !== score.b) {
    winner = score.a > score.b ? team1 : team2;
    loser = score.a > score.b ? team2 : team1;
  }

  return {
    team1,
    team2,
    score1: String(score.a),
    score2: String(score.b),
    winner,
    loser,
    source: 'schedule',
  };
}

function resolveBracketFromStandingsAndSchedule({ standings, bracketFromSheet, scheduleMatches }) {
  // Always seed QFs from Phase 1 standings.
  const qfSeeds = [
    { team1: standings.poolA?.[0] || 'Pool A 1st', team2: standings.poolC?.[0] || 'Pool C 1st' },
    { team1: standings.poolA?.[1] || 'Pool A 2nd', team2: standings.poolD?.[1] || 'Pool D 2nd' },
    { team1: standings.poolB?.[0] || 'Pool B 1st', team2: standings.poolD?.[0] || 'Pool D 1st' },
    { team1: standings.poolB?.[1] || 'Pool B 2nd', team2: standings.poolC?.[1] || 'Pool C 2nd' },
  ];

  const qfTimes = ['12:39 PM', '1:00 PM', '1:21 PM', '1:42 PM'];
  const sfTimes = ['2:03 PM', '2:24 PM'];
  const finalTime = '14:45'; // informational only; final score comes from Bracket sheet typically

  // 1) Quarterfinals
  const quarterfinals = qfSeeds.map((seed, i) => {
    const fromSheet = bracketFromSheet.quarterfinals[i];
    const fromSchedule = findMatchResultFromSchedule({ scheduleMatches, time: qfTimes[i], field: 'Field 1' });

    const base = {
      team1: fromSheet?.team1 || seed.team1,
      team2: fromSheet?.team2 || seed.team2,
      score1: fromSheet?.score1 || '0',
      score2: fromSheet?.score2 || '0',
      winner: fromSheet?.winner || null,
      loser: fromSheet?.loser || null,
    };

    // If bracket sheet doesn't have a decided winner, use schedule score.
    if (!base.winner && fromSchedule?.winner) {
      return {
        ...base,
        team1: fromSchedule.team1,
        team2: fromSchedule.team2,
        score1: fromSchedule.score1,
        score2: fromSchedule.score2,
        winner: fromSchedule.winner,
        loser: fromSchedule.loser,
      };
    }

    return base;
  });

  const qfWinners = quarterfinals.map((m) => m.winner).filter(Boolean);
  const qfLosers = quarterfinals.map((m) => m.loser).filter(Boolean);

  // 2) Semifinals (prefer sheet, else derive from QF winners)
  const semifinals = [0, 1].map((i) => {
    const fromSheet = bracketFromSheet.semifinals[i];
    const fromSchedule = findMatchResultFromSchedule({ scheduleMatches, time: sfTimes[i], field: 'Field 1' });

    const defaultTeams =
      i === 0
        ? { team1: qfWinners[0] || 'Winner QF1', team2: qfWinners[1] || 'Winner QF2' }
        : { team1: qfWinners[2] || 'Winner QF3', team2: qfWinners[3] || 'Winner QF4' };

    const base = {
      team1: fromSheet?.team1 || defaultTeams.team1,
      team2: fromSheet?.team2 || defaultTeams.team2,
      score1: fromSheet?.score1 || '0',
      score2: fromSheet?.score2 || '0',
      winner: fromSheet?.winner || null,
      loser: fromSheet?.loser || null,
    };

    if (!base.winner && fromSchedule?.winner) {
      return {
        ...base,
        team1: fromSchedule.team1,
        team2: fromSchedule.team2,
        score1: fromSchedule.score1,
        score2: fromSchedule.score2,
        winner: fromSchedule.winner,
        loser: fromSchedule.loser,
      };
    }

    return base;
  });

  const sfWinners = semifinals.map((m) => m.winner).filter(Boolean);

  // 3) Final (prefer sheet; otherwise derive teams from SF winners)
  const finalFromSheet = bracketFromSheet.final[0];
  const final = {
    team1: finalFromSheet?.team1 || sfWinners[0] || 'Winner SF1',
    team2: finalFromSheet?.team2 || sfWinners[1] || 'Winner SF2',
    score1: finalFromSheet?.score1 || '0',
    score2: finalFromSheet?.score2 || '0',
    winner: finalFromSheet?.winner || null,
    loser: finalFromSheet?.loser || null,
    time: finalTime,
    field: 'Field 1',
  };

  // 4) Elite consolation (prefer sheet; else derive from QF losers)
  const consolationElite = [0, 1].map((i) => {
    const from = bracketFromSheet.consolationElite[i];
    return {
      team1: from?.team1 || qfLosers[i * 2] || (i === 0 ? 'Loser QF1' : 'Loser QF3'),
      team2: from?.team2 || qfLosers[i * 2 + 1] || (i === 0 ? 'Loser QF2' : 'Loser QF4'),
      score1: from?.score1 || '0',
      score2: from?.score2 || '0',
      winner: from?.winner || null,
      loser: from?.loser || null,
    };
  });

  // 5) Dev placement (standings-derived, sheet can override)
  const consolationDevelopmentSeeds = [
    { team1: standings.poolC?.[1] || 'Pool C 2nd', team2: standings.poolD?.[1] || 'Pool D 2nd' },
    { team1: standings.poolC?.[2] || 'Pool C 3rd', team2: standings.poolD?.[2] || 'Pool D 3rd' },
    { team1: standings.poolC?.[3] || 'Pool C 4th', team2: standings.poolD?.[3] || 'Pool D 4th' },
  ];

  const consolationDevelopment = consolationDevelopmentSeeds.map((seed, i) => {
    const from = bracketFromSheet.consolationDevelopment[i];
    return {
      team1: from?.team1 || seed.team1,
      team2: from?.team2 || seed.team2,
      score1: from?.score1 || '0',
      score2: from?.score2 || '0',
      winner: from?.winner || null,
      loser: from?.loser || null,
    };
  });

  return {
    quarterfinals,
    semifinals,
    final,
    consolation: {
      elite: consolationElite,
      development: consolationDevelopment,
    },
  };
}

function generateChampionshipMatchupsFromStandings(standings) {
  // These are your “PM” times the old code used.
  // If your event times differ, change keys here.
  const matchups = {};

  const hasA = standings.poolA && standings.poolA.length >= 2;
  const hasB = standings.poolB && standings.poolB.length >= 2;
  const hasC = standings.poolC && standings.poolC.length >= 4;
  const hasD = standings.poolD && standings.poolD.length >= 4;

  if (!(hasA && hasB && hasC && hasD)) return matchups;

  // Quarterfinals
  matchups['12:39 PM'] = { field1: `QF1: ${standings.poolA[0]} vs ${standings.poolC[0]}` };
  matchups['1:00 PM']  = { field1: `QF2: ${standings.poolA[1]} vs ${standings.poolD[1]}` };
  matchups['1:21 PM']  = { field1: `QF3: ${standings.poolB[0]} vs ${standings.poolD[0]}` };
  matchups['1:42 PM']  = { field1: `QF4: ${standings.poolB[1]} vs ${standings.poolC[1]}` };

  // Consolation Development (correct indices)
  matchups['2:45 PM'] = { field2: `Dev 2nd Place: ${standings.poolC[1]} vs ${standings.poolD[1]}` };
  matchups['3:06 PM'] = { field2: `Dev 3rd Place: ${standings.poolC[2]} vs ${standings.poolD[2]}` };
  matchups['3:27 PM'] = { field2: `Dev 4th Place: ${standings.poolC[3]} vs ${standings.poolD[3]}` };

  return matchups;
}

// -----------------------------
// Routes
// -----------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/tournament/teams', async (req, res) => {
  try {
    if (!sheets) {
      return res.status(500).json({ error: 'Google Sheets API not available' });
    }
    
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const rows = await getSheetValues(spreadsheetId, 'Teams!A1:Z50');

    const { pools } = parseTeamsFromTeamsSheet(rows);

    // Return in your previous structure (elite/development A/B/C/D)
    res.json({
      elite: { A: pools.poolA, B: pools.poolB },
      development: { C: pools.poolC, D: pools.poolD }
    });
  } catch (error) {
    console.error('Error fetching teams data:', error);
    res.status(500).json({ error: 'Failed to fetch teams data' });
  }
});

app.get('/api/tournament/schedule', async (req, res) => {
  try {
    if (!sheets) {
      return res.status(500).json({ error: 'Google Sheets API not available' });
    }
    
    const spreadsheetId = process.env.SPREADSHEET_ID;

    const [scheduleRows, teamRows, bracketRows] = await Promise.all([
      getSheetValues(spreadsheetId, 'Schedule!A1:Z200'),
      getSheetValues(spreadsheetId, 'Teams!A1:Z50').catch(() => []),
      // Bracket sheet is optional
      getSheetValues(spreadsheetId, 'Bracket!A1:Z100').catch(() => []),
    ]);

    const teamsInfo = parseTeamsFromTeamsSheet(teamRows);
    const scheduleMatches = parseScheduleRows(scheduleRows);
    const { standings } = computeStandings(teamsInfo, scheduleMatches);

    // Split into poolPlay vs "championship" by time heuristics:
    // - everything before 12:00 PM is pool play
    // - everything 12:00 PM and later is bracket/champ
    const scheduleData = {
      poolPlay: [],
      championship: [],
      generated: [],
      standings,
    };

    const pushIfMissing = ({ bucket, time, field, team1, score, team2 }) => {
      // Avoid duplicates if the user already entered a row in the Schedule sheet
      const exists = scheduleData[bucket].some(
        (m) => m.time === time && m.field === field
      );
      if (exists) return;
      scheduleData[bucket].push({ time, field, team1, score, team2 });
    };

    const upsertMatch = ({ bucket, time, field, team1, score, team2 }) => {
      const idx = scheduleData[bucket].findIndex(
        (m) => m.time === time && m.field === field
      );
      if (idx >= 0) {
        scheduleData[bucket][idx] = { time, field, team1, score, team2 };
        return;
      }
      scheduleData[bucket].push({ time, field, team1, score, team2 });
    };

    scheduleMatches.forEach((m) => {
      const mins = toMinutes(m.time);
      const bucket = (mins !== null && mins < 12 * 60) ? 'poolPlay' : 'championship';

      if (m.field1) {
        scheduleData[bucket].push({
          time: m.time,
          field: 'Field 1',
          team1: m.field1.team1,
          score: m.field1.score,
          team2: m.field1.team2,
        });
      }
      if (m.field2) {
        scheduleData[bucket].push({
          time: m.time,
          field: 'Field 2',
          team1: m.field2.team1,
          score: m.field2.score,
          team2: m.field2.team2,
        });
      }
    });

    // Prefer Bracket sheet for Phase 2 matchups if it exists.
    // This matches your Excel "Bracket" layout (Quarterfinals/Semifinals/Final/Consolations)
    const bracketFromSheet = parseBracketSheet(bracketRows);
    const hasBracketData =
      bracketFromSheet.quarterfinals.length > 0 ||
      bracketFromSheet.semifinals.length > 0 ||
      bracketFromSheet.consolationElite.length > 0 ||
      bracketFromSheet.consolationDevelopment.length > 0;

    // Also compute a resolved bracket using ANY available scores so we can
    // auto-advance SFs/final as QF/SF scores get entered.
    const resolvedBracket = resolveBracketFromStandingsAndSchedule({
      standings,
      bracketFromSheet,
      scheduleMatches,
    });

    if (hasBracketData) {
      const qfTimes = ['12:39 PM', '1:00 PM', '1:21 PM', '1:42 PM'];
      qfTimes.forEach((time, i) => {
        const m = resolvedBracket.quarterfinals[i];
        if (!m) return;
        pushIfMissing({
          bucket: 'championship',
          time,
          field: 'Field 1',
          team1: `QF${i + 1}: ${m.team1}`,
          score: m.score1 && m.score2 && (m.score1 !== '0' || m.score2 !== '0') ? `${m.score1}-${m.score2}` : 'vs',
          team2: m.team2,
        });
      });

      const sfTimes = ['2:03 PM', '2:24 PM'];
      sfTimes.forEach((time, i) => {
        const m = resolvedBracket.semifinals[i];
        if (!m) return;
        pushIfMissing({
          bucket: 'championship',
          time,
          field: 'Field 1',
          team1: `SF${i + 1}: ${m.team1}`,
          score: m.score1 && m.score2 && (m.score1 !== '0' || m.score2 !== '0') ? `${m.score1}-${m.score2}` : 'vs',
          team2: m.team2,
        });
      });

      const finalMatch = resolvedBracket.final;
      if (finalMatch) {
        const finalScore = finalMatch.score1 && finalMatch.score2 && (finalMatch.score1 !== '0' || finalMatch.score2 !== '0')
          ? `${finalMatch.score1}-${finalMatch.score2}`
          : 'vs';
        upsertMatch({
          bucket: 'championship',
          time: '4:30 PM',
          field: 'Field 1',
          team1: finalMatch.team1,
          score: finalScore,
          team2: finalMatch.team2,
        });
      }

      // Elite consolation games run alongside semifinals on Field 2
      sfTimes.forEach((time, i) => {
        const m = bracketFromSheet.consolationElite[i];
        if (!m) return;

        // Prefer Bracket sheet score if present; else fall back to Schedule sheet score
        const bracketHasScore = safeStr(m.score1) !== '0' || safeStr(m.score2) !== '0';
        const fromSchedule = findMatchResultFromSchedule({ scheduleMatches, time, field: 'Field 2' });
        const team1 = m.team1;
        const team2 = m.team2;
        const score = bracketHasScore
          ? `${m.score1}-${m.score2}`
          : (fromSchedule ? `${fromSchedule.score1}-${fromSchedule.score2}` : 'vs');
        pushIfMissing({
          bucket: 'championship',
          time,
          field: 'Field 2',
          team1: `Elite Consol ${i + 1}: ${team1}`,
          score,
          team2,
        });
      });

      // Add Elite Consol Championship (from Bracket sheet section if present)
      const ecChampFromSheet = bracketFromSheet.eliteConsolationChampionship?.[0] || null;
      const ecChampTeam1 = ecChampFromSheet?.team1 || 'Winner EC1';
      const ecChampTeam2 = ecChampFromSheet?.team2 || 'Winner EC2';
      const ecChampScore = ecChampFromSheet && (safeStr(ecChampFromSheet.score1) !== '0' || safeStr(ecChampFromSheet.score2) !== '0')
        ? `${ecChampFromSheet.score1}-${ecChampFromSheet.score2}`
        : 'vs';
      pushIfMissing({
        bucket: 'championship',
        time: '4:09 PM',
        field: 'Field 2',
        team1: `Elite Consol Championship: ${ecChampTeam1}`,
        score: ecChampScore,
        team2: ecChampTeam2,
      });

      const devTimes = ['3:27 PM', '3:48 PM', '4:09 PM'];
      const devLabels = ['Dev 2nd Place', 'Dev 4th Place', 'Dev 6th Place'];
      devTimes.forEach((time, i) => {
        const m = bracketFromSheet.consolationDevelopment[i];
        if (!m) return;

        // Prefer Bracket sheet score if present; else fall back to Schedule sheet score
        const bracketHasScore = safeStr(m.score1) !== '0' || safeStr(m.score2) !== '0';
        const fromSchedule = findMatchResultFromSchedule({ scheduleMatches, time, field: 'Field 2' });
        const team1 = m.team1;
        const team2 = m.team2;
        const score = bracketHasScore
          ? `${m.score1}-${m.score2}`
          : (fromSchedule ? `${fromSchedule.score1}-${fromSchedule.score2}` : 'vs');
        pushIfMissing({
          bucket: 'championship',
          time,
          field: 'Field 2',
          team1: `${devLabels[i]}: ${team1}`,
          score,
          team2,
        });
      });
    } else {
      // Fallback: Add generated PM matchups based on pool standings
      const generated = generateChampionshipMatchupsFromStandings(standings);
      Object.entries(generated).forEach(([time, obj]) => {
        if (obj.field1) {
          const m = safeStr(obj.field1).match(/^(.*?):\s*(.*?)\s+vs\s+(.*)$/i);
          const label = m ? m[1] : '';
          const t1 = m ? m[2] : safeStr(obj.field1);
          const t2 = m ? m[3] : '';

          pushIfMissing({
            bucket: 'championship',
            time,
            field: 'Field 1',
            team1: label ? `${label}: ${t1}` : t1,
            score: 'vs',
            team2: t2,
          });
        }
        if (obj.field2) {
          const m = safeStr(obj.field2).match(/^(.*?):\s*(.*?)\s+vs\s+(.*)$/i);
          const label = m ? m[1] : '';
          const t1 = m ? m[2] : safeStr(obj.field2);
          const t2 = m ? m[3] : '';

          pushIfMissing({
            bucket: 'championship',
            time,
            field: 'Field 2',
            team1: label ? `${label}: ${t1}` : t1,
            score: 'vs',
            team2: t2,
          });
        }
      });
    }

    // ✅ Phase 2 should all be on Field 1. If any games collide, move the extra
    // ones to the next open slot on Field 1.
    scheduleData.championship = sequentializePhase2ToField1(scheduleData.championship);

    // Ensure consistent ordering:
    // - poolPlay chronological
    // - championship chronological (after we sequentialize)
    scheduleData.poolPlay = sortScheduleBucket(scheduleData.poolPlay);
    scheduleData.championship = sortScheduleBucket(scheduleData.championship);

    res.json(scheduleData);
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ error: 'Failed to fetch schedule data' });
  }
});

app.get('/api/tournament/bracket', async (req, res) => {
  try {
    if (!sheets) {
      return res.status(500).json({ error: 'Google Sheets API not available' });
    }
    
    const spreadsheetId = process.env.SPREADSHEET_ID;

    const [scheduleRows, bracketRows, teamRows] = await Promise.all([
      getSheetValues(spreadsheetId, 'Schedule!A1:Z200'),
      getSheetValues(spreadsheetId, 'Bracket!A1:Z100').catch(() => []),
      getSheetValues(spreadsheetId, 'Teams!A1:Z50').catch(() => []),
    ]);

    const teamsInfo = parseTeamsFromTeamsSheet(teamRows);
    const scheduleMatches = parseScheduleRows(scheduleRows);
    const { standings } = computeStandings(teamsInfo, scheduleMatches);

    const bracketFromSheet = parseBracketSheet(bracketRows);

    const resolved = resolveBracketFromStandingsAndSchedule({
      standings,
      bracketFromSheet,
      scheduleMatches,
    });

    const eliteConsolationChampionship = bracketFromSheet.eliteConsolationChampionship?.[0] || null;
    res.json({ standings, ...resolved, eliteConsolationChampionship });
  } catch (error) {
    console.error('Error fetching bracket data:', error);
    res.status(500).json({ error: 'Failed to fetch bracket data' });
  }
});

// -----------------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
