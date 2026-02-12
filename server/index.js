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

// Guard: avoid crashing if request is null (e.g. some serverless invocations)
app.use((req, res, next) => {
  if (!req || !res) {
    console.error('Request or response object missing');
    if (res && typeof res.status === 'function') res.status(500).json({ error: 'Server configuration error' });
    return;
  }
  next();
});

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
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
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
function requireSpreadsheetId(res) {
  const id = process.env.SPREADSHEET_ID;
  if (!id || String(id).trim() === '') {
    if (res) res.status(503).json({ error: 'SPREADSHEET_ID not configured', code: 'NO_SPREADSHEET_ID' });
    return null;
  }
  return id;
}

async function getSheetValues(spreadsheetId, range) {
  if (!sheets) {
    throw new Error('Google Sheets API not initialized');
  }
  if (!spreadsheetId || !range) {
    throw new Error('spreadsheetId and range are required');
  }
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.data.values || [];
}

async function appendSheetRows(spreadsheetId, range, rows) {
  if (!sheets) {
    throw new Error('Google Sheets API not initialized');
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
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
  if (label.includes('consol') || label.includes('place')) return 45;

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

function sequentializePhase2ByField(matches, { incrementMinutes = 21 } = {}) {
  // Keep Field 1/Field 2 assignments intact, but avoid time collisions per field.
  const usedByField = new Map();

  const ordered = [...matches].sort((a, b) => {
    const am = toMinutes(a.time);
    const bm = toMinutes(b.time);
    if (am !== null && bm !== null && am !== bm) return am - bm;

    const ar = matchStageRank(a);
    const br = matchStageRank(b);
    if (ar !== br) return br - ar;

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
      out.push({ ...m });
      continue;
    }

    const field = safeStr(m.field) || 'Field 1';
    const used = usedByField.get(field) || new Set();

    let t = baseTime;
    while (used.has(t)) {
      const next = addMinutesToTime(t, incrementMinutes);
      if (!next) break;
      t = next;
    }

    used.add(t);
    usedByField.set(field, used);
    out.push({ ...m, time: t, field });
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

function flattenScheduleMatches(scheduleMatches) {
  const out = [];
  scheduleMatches.forEach((row) => {
    if (row.field1) {
      out.push({ time: row.time, field: 'Field 1', ...row.field1 });
    }
    if (row.field2) {
      out.push({ time: row.time, field: 'Field 2', ...row.field2 });
    }
  });
  return out;
}

function normalizeMatchText(value) {
  return safeStr(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function stripMatchLabel(value) {
  const s = safeStr(value);
  if (!s) return '';
  const idx = s.indexOf(':');
  if (idx === -1) return s.trim();
  return s.slice(idx + 1).trim();
}

function normalizeTeamKey(value) {
  return normalizeMatchText(stripMatchLabel(value));
}

function findScheduleMatchByLabel(scheduleFlat, labels = []) {
  for (const label of labels) {
    const key = normalizeMatchText(label);
    if (!key) continue;
    const matches = scheduleFlat.filter((m) => {
      const t1 = normalizeMatchText(m.team1);
      const t2 = normalizeMatchText(m.team2);
      return t1.includes(key) || t2.includes(key);
    });
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function findScheduleMatchByTeams(scheduleFlat, team1, team2) {
  const t1 = normalizeTeamKey(team1);
  const t2 = normalizeTeamKey(team2);
  if (!t1 || !t2) return null;
  return scheduleFlat.find((m) => {
    const a = normalizeTeamKey(m.team1);
    const b = normalizeTeamKey(m.team2);
    return (a === t1 && b === t2) || (a === t2 && b === t1);
  }) || null;
}

function resolveMatchFromSchedule({ scheduleFlat, labels = [], team1, team2 }) {
  if (!scheduleFlat || scheduleFlat.length === 0) return null;
  let match = findScheduleMatchByLabel(scheduleFlat, labels);
  if (!match && team1 && team2) {
    match = findScheduleMatchByTeams(scheduleFlat, team1, team2);
  }
  if (!match) return null;

  const score = parseScore(match.score);
  if (!score) return null;

  const cleanTeam1 = stripMatchLabel(match.team1);
  const cleanTeam2 = stripMatchLabel(match.team2);

  let winner = null;
  let loser = null;
  if (score.a !== score.b) {
    winner = score.a > score.b ? cleanTeam1 : cleanTeam2;
    loser = score.a > score.b ? cleanTeam2 : cleanTeam1;
  }

  return {
    team1: cleanTeam1,
    team2: cleanTeam2,
    score1: String(score.a),
    score2: String(score.b),
    winner,
    loser,
    source: 'schedule',
  };
}

function buildLabelVariants(prefixes, label) {
  const out = [];
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  list.filter(Boolean).forEach((prefix) => out.push(`${prefix} ${label}`));
  out.push(label);
  return out;
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

  (rows || []).forEach((row, idx) => {
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

  (scheduleRows || []).forEach((row, idx) => {
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

function emptyBracket() {
  return {
    quarterfinals: [],
    semifinals: [],
    final: [],
    thirdPlace: [],
    consolation: { elite: [], development: [] },
    eliteConsolationChampionship: [],
  };
}

function parseBracketSheet(bracketRows) {
  const brackets = {
    elite: emptyBracket(),
    development: emptyBracket(),
  };

  let section = null;
  let currentBracket = 'elite';

  const setSection = (row0) => {
    const t = safeStr(row0).toLowerCase();

    if (t.includes('development') || t.includes('dev bracket')) currentBracket = 'development';
    if (t.includes('elite') || t.includes('championship bracket')) currentBracket = 'elite';

    if (
      t.includes('bracket') &&
      !t.includes('quarterfinal') &&
      !t.includes('semifinal') &&
      !t.includes('final') &&
      !t.includes('consol')
    ) {
      section = null;
      return;
    }

    if (t.includes('elite consol') && t.includes('championship')) {
      section = 'eliteConsolationChampionship';
      return;
    }
    if (t.includes('consolation elite')) {
      section = 'consolationElite';
      return;
    }
    if (t.includes('consolation development')) {
      section = 'consolationDevelopment';
      return;
    }
    if (t.includes('quarterfinal')) {
      section = 'quarterfinals';
      return;
    }
    if (t.includes('semifinal')) {
      section = 'semifinals';
      return;
    }
    if (t.includes('3rd place') || t.includes('third place')) {
      section = 'thirdPlace';
      return;
    }
    if (t === 'final' || t.includes('final')) {
      section = 'final';
      return;
    }
  };

  const pushMatch = (target, match) => {
    if (Array.isArray(target)) target.push(match);
  };

  bracketRows.forEach((row) => {
    if (!row || row.length === 0) return;
    const c0 = safeStr(row[0]);
    const c1 = safeStr(row[1]);

    if (c0 && !c1) {
      setSection(c0);
      return;
    }

    if (!section) return;

    if (c0 && c1) {
      const score1 = safeStr(row[2]) || '0';
      const score2 = safeStr(row[3]) || '0';

      const s1 = parseInt(score1, 10);
      const s2 = parseInt(score2, 10);
      let winner = null;
      let loser = null;
      if (!isNaN(s1) && !isNaN(s2) && (s1 !== 0 || s2 !== 0)) {
        winner = s1 > s2 ? c0 : c1;
        loser = s1 > s2 ? c1 : c0;
      }

      const match = {
        team1: c0,
        team2: c1,
        score1: score1,
        score2: score2,
        winner,
        loser,
      };

      if (section === 'quarterfinals') pushMatch(brackets[currentBracket].quarterfinals, match);
      else if (section === 'semifinals') pushMatch(brackets[currentBracket].semifinals, match);
      else if (section === 'thirdPlace') pushMatch(brackets[currentBracket].thirdPlace, match);
      else if (section === 'final') pushMatch(brackets[currentBracket].final, match);
      else if (section === 'consolationElite') pushMatch(brackets.elite.consolation.elite, match);
      else if (section === 'eliteConsolationChampionship') pushMatch(brackets.elite.eliteConsolationChampionship, match);
      else if (section === 'consolationDevelopment') pushMatch(brackets.development.consolation.development, match);
    }
  });

  return brackets;
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

function resolveMatchWithSchedule({ base, scheduleFlat, labels }) {
  if (!base || base.winner) return base;
  const fromSchedule = resolveMatchFromSchedule({
    scheduleFlat,
    labels,
    team1: base.team1,
    team2: base.team2,
  });
  if (!fromSchedule || !fromSchedule.winner) return base;
  return { ...base, ...fromSchedule };
}

function resolveDivisionBracket({
  divisionKey,
  standings,
  bracketFromSheet,
  scheduleFlat,
  pool1Key,
  pool2Key,
  pool1Label,
  pool2Label,
  labelPrefixes,
  allowPlacementFallback = false,
}) {
  const bracket = bracketFromSheet?.[divisionKey] || emptyBracket();
  const pool1 = standings[pool1Key] || [];
  const pool2 = standings[pool2Key] || [];

  const seed = (arr, idx, fallback) => arr?.[idx] || fallback;
  const qfSeeds = [
    { team1: seed(pool1, 0, `${pool1Label} 1st`), team2: seed(pool2, 3, `${pool2Label} 4th`) },
    { team1: seed(pool1, 1, `${pool1Label} 2nd`), team2: seed(pool2, 2, `${pool2Label} 3rd`) },
    { team1: seed(pool2, 0, `${pool2Label} 1st`), team2: seed(pool1, 3, `${pool1Label} 4th`) },
    { team1: seed(pool2, 1, `${pool2Label} 2nd`), team2: seed(pool1, 2, `${pool1Label} 3rd`) },
  ];

  const quarterfinals = qfSeeds.map((seedMatch, i) => {
    const fromSheet = bracket.quarterfinals[i];
    const base = {
      team1: fromSheet?.team1 || seedMatch.team1,
      team2: fromSheet?.team2 || seedMatch.team2,
      score1: fromSheet?.score1 || '0',
      score2: fromSheet?.score2 || '0',
      winner: fromSheet?.winner || null,
      loser: fromSheet?.loser || null,
    };
    return resolveMatchWithSchedule({
      base,
      scheduleFlat,
      labels: buildLabelVariants(labelPrefixes, `QF${i + 1}`),
    });
  });

  const qfWinners = quarterfinals.map((m) => m.winner).filter(Boolean);
  const qfLosers = quarterfinals.map((m) => m.loser).filter(Boolean);

  const semifinals = [0, 1].map((i) => {
    const fromSheet = bracket.semifinals[i];
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
    return resolveMatchWithSchedule({
      base,
      scheduleFlat,
      labels: buildLabelVariants(labelPrefixes, `SF${i + 1}`),
    });
  });

  const sfWinners = semifinals.map((m) => m.winner).filter(Boolean);
  const sfLosers = semifinals.map((m) => m.loser).filter(Boolean);

  // 3rd Place Match: Loser SF1 vs Loser SF2
  const thirdPlaceFromSheet = bracket.thirdPlace?.[0];
  const thirdPlaceBase = {
    team1: thirdPlaceFromSheet?.team1 || sfLosers[0] || 'Loser SF1',
    team2: thirdPlaceFromSheet?.team2 || sfLosers[1] || 'Loser SF2',
    score1: thirdPlaceFromSheet?.score1 || '0',
    score2: thirdPlaceFromSheet?.score2 || '0',
    winner: thirdPlaceFromSheet?.winner || null,
    loser: thirdPlaceFromSheet?.loser || null,
    time: '',
    field: '',
  };
  const thirdPlace = resolveMatchWithSchedule({
    base: thirdPlaceBase,
    scheduleFlat,
    labels: buildLabelVariants(labelPrefixes, '3rd Place'),
  });

  const finalFromSheet = bracket.final[0];
  const finalBase = {
    team1: finalFromSheet?.team1 || sfWinners[0] || 'Winner SF1',
    team2: finalFromSheet?.team2 || sfWinners[1] || 'Winner SF2',
    score1: finalFromSheet?.score1 || '0',
    score2: finalFromSheet?.score2 || '0',
    winner: finalFromSheet?.winner || null,
    loser: finalFromSheet?.loser || null,
    time: '',
    field: '',
  };
  const final = resolveMatchWithSchedule({
    base: finalBase,
    scheduleFlat,
    labels: buildLabelVariants(labelPrefixes, 'Final'),
  });

  const consolation = { elite: [], development: [] };
  let eliteConsolationChampionship = null;

  if (divisionKey === 'elite') {
    const consolationElite = [0, 1].map((i) => {
      const from = bracket.consolation?.elite?.[i];
      const base = {
        team1: from?.team1 || qfLosers[i * 2] || (i === 0 ? 'Loser QF1' : 'Loser QF3'),
        team2: from?.team2 || qfLosers[i * 2 + 1] || (i === 0 ? 'Loser QF2' : 'Loser QF4'),
        score1: from?.score1 || '0',
        score2: from?.score2 || '0',
        winner: from?.winner || null,
        loser: from?.loser || null,
      };
      return resolveMatchWithSchedule({
        base,
        scheduleFlat,
        labels: buildLabelVariants(['Elite'], `Consol ${i + 1}`),
      });
    });
    consolation.elite = consolationElite;

    const ecChampFromSheet = bracket.eliteConsolationChampionship?.[0] || null;
    if (ecChampFromSheet) {
      eliteConsolationChampionship = {
        team1: ecChampFromSheet.team1,
        team2: ecChampFromSheet.team2,
        score1: ecChampFromSheet.score1 || '0',
        score2: ecChampFromSheet.score2 || '0',
        winner: ecChampFromSheet.winner || null,
        loser: ecChampFromSheet.loser || null,
      };
    } else {
      const winners = consolationElite.map((m) => m.winner).filter(Boolean);
      if (winners.length > 0) {
        eliteConsolationChampionship = {
          team1: winners[0] || 'Winner EC1',
          team2: winners[1] || 'Winner EC2',
          score1: '0',
          score2: '0',
          winner: null,
          loser: null,
        };
      }
    }
  }

  if (divisionKey === 'development') {
    const hasDevBracket =
      bracket.quarterfinals.length > 0 ||
      bracket.semifinals.length > 0 ||
      bracket.final.length > 0;

    if (!hasDevBracket && allowPlacementFallback) {
      const devPlaceLabels = ['2nd Place', '3rd Place', '4th Place'];
      const consolationDevelopmentSeeds = [
        { team1: standings.poolC?.[1] || 'Pool C 2nd', team2: standings.poolD?.[1] || 'Pool D 2nd' },
        { team1: standings.poolC?.[2] || 'Pool C 3rd', team2: standings.poolD?.[2] || 'Pool D 3rd' },
        { team1: standings.poolC?.[3] || 'Pool C 4th', team2: standings.poolD?.[3] || 'Pool D 4th' },
      ];
      consolation.development = consolationDevelopmentSeeds.map((seedMatch, i) => {
        const from = bracket.consolation?.development?.[i];
        const base = {
          team1: from?.team1 || seedMatch.team1,
          team2: from?.team2 || seedMatch.team2,
          score1: from?.score1 || '0',
          score2: from?.score2 || '0',
          winner: from?.winner || null,
          loser: from?.loser || null,
        };
        return resolveMatchWithSchedule({
          base,
          scheduleFlat,
          labels: buildLabelVariants(['Dev', 'Development'], devPlaceLabels[i] || `Place ${i + 2}`),
        });
      });
    } else if (bracket.consolation?.development?.length) {
      consolation.development = bracket.consolation.development.map((from, i) => ({
        team1: from.team1,
        team2: from.team2,
        score1: from.score1 || '0',
        score2: from.score2 || '0',
        winner: from.winner || null,
        loser: from.loser || null,
      }));
    }
  }

  return {
    quarterfinals,
    semifinals,
    final,
    thirdPlace,
    consolation,
    eliteConsolationChampionship,
  };
}

function resolveBracketsFromStandingsAndSchedule({ standings, bracketFromSheet, scheduleMatches }) {
  const scheduleFlat = flattenScheduleMatches(scheduleMatches);
  const elite = resolveDivisionBracket({
    divisionKey: 'elite',
    standings,
    bracketFromSheet,
    scheduleFlat,
    pool1Key: 'poolA',
    pool2Key: 'poolB',
    pool1Label: 'Pool A',
    pool2Label: 'Pool B',
    labelPrefixes: ['Elite'],
    allowPlacementFallback: false,
  });

  const development = resolveDivisionBracket({
    divisionKey: 'development',
    standings,
    bracketFromSheet,
    scheduleFlat,
    pool1Key: 'poolC',
    pool2Key: 'poolD',
    pool1Label: 'Pool C',
    pool2Label: 'Pool D',
    labelPrefixes: ['Development', 'Dev'],
    allowPlacementFallback: true,
  });

  return { elite, development };
}

function generateChampionshipMatchupsFromStandings(standings) {
  const matchups = {};

  const hasElite = (standings.poolA?.length || 0) >= 4 && (standings.poolB?.length || 0) >= 4;
  const hasDev = (standings.poolC?.length || 0) >= 4 && (standings.poolD?.length || 0) >= 4;

  if (!hasElite && !hasDev) return matchups;

  const qfTimes = ['1:22 PM', '1:43 PM', '2:04 PM', '2:25 PM'];
  const sfTimes = ['2:46 PM', '3:07 PM'];

  const eliteQf = [
    `Elite QF1: ${standings.poolA?.[0] || 'Pool A 1st'} vs ${standings.poolB?.[3] || 'Pool B 4th'}`,
    `Elite QF2: ${standings.poolA?.[1] || 'Pool A 2nd'} vs ${standings.poolB?.[2] || 'Pool B 3rd'}`,
    `Elite QF3: ${standings.poolB?.[0] || 'Pool B 1st'} vs ${standings.poolA?.[3] || 'Pool A 4th'}`,
    `Elite QF4: ${standings.poolB?.[1] || 'Pool B 2nd'} vs ${standings.poolA?.[2] || 'Pool A 3rd'}`,
  ];

  const devQf = [
    `Dev QF1: ${standings.poolC?.[0] || 'Pool C 1st'} vs ${standings.poolD?.[3] || 'Pool D 4th'}`,
    `Dev QF2: ${standings.poolC?.[1] || 'Pool C 2nd'} vs ${standings.poolD?.[2] || 'Pool D 3rd'}`,
    `Dev QF3: ${standings.poolD?.[0] || 'Pool D 1st'} vs ${standings.poolC?.[3] || 'Pool C 4th'}`,
    `Dev QF4: ${standings.poolD?.[1] || 'Pool D 2nd'} vs ${standings.poolC?.[2] || 'Pool C 3rd'}`,
  ];

  qfTimes.forEach((time, i) => {
    matchups[time] = matchups[time] || {};
    if (hasElite) matchups[time].field1 = eliteQf[i];
    if (hasDev) matchups[time].field2 = devQf[i];
  });

  sfTimes.forEach((time, i) => {
    matchups[time] = matchups[time] || {};
    if (hasElite) matchups[time].field1 = `Elite SF${i + 1}: Winner QF${i * 2 + 1} vs Winner QF${i * 2 + 2}`;
    if (hasDev) matchups[time].field2 = `Dev SF${i + 1}: Winner QF${i * 2 + 1} vs Winner QF${i * 2 + 2}`;
  });

  if (hasDev) {
    matchups['4:32 PM'] = { ...(matchups['4:32 PM'] || {}), field1: 'Dev Final: Winner SF1 vs Winner SF2' };
  }
  if (hasElite) {
    matchups['4:53 PM'] = { ...(matchups['4:53 PM'] || {}), field1: 'Elite Final: Winner SF1 vs Winner SF2' };
  }

  return matchups;
}

// -----------------------------
// Predictions (persisted in Google Sheet "Predictions")
// Sheet columns: A=Timestamp, B=Elite Winner, C=Development Winner, D=Name, E=IP (row 1 = header)
// One vote per IP: submissions from the same IP are rejected.
// -----------------------------
const PREDICTIONS_SHEET_RANGE = 'Predictions!A2:E';

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) return first.trim();
  }
  return req.ip || req.connection?.remoteAddress || '';
}

function predictionsRowsToStats(rows) {
  const elite = {};
  const development = {};
  (rows || []).forEach((row) => {
    const eliteWinner = safeStr(row[1]);
    const devWinner = safeStr(row[2]);
    if (eliteWinner) elite[eliteWinner] = (elite[eliteWinner] || 0) + 1;
    if (devWinner) development[devWinner] = (development[devWinner] || 0) + 1;
  });
  return { elite, development, totalVotes: rows.length };
}

app.get('/api/predictions', async (req, res) => {
  try {
    if (!sheets) {
      return res.status(503).json({ error: 'Google Sheets API not available', code: 'SHEETS_NOT_INIT' });
    }
    const spreadsheetId = requireSpreadsheetId(res);
    if (!spreadsheetId) return;
    const rows = await getSheetValues(spreadsheetId, PREDICTIONS_SHEET_RANGE).catch(() => []);
    res.json(predictionsRowsToStats(Array.isArray(rows) ? rows : []));
  } catch (error) {
    console.error('Error fetching predictions:', error);
    res.status(500).json({ error: 'Failed to fetch predictions' });
  }
});

app.post('/api/predictions', async (req, res) => {
  try {
    if (!sheets) {
      return res.status(503).json({ error: 'Google Sheets API not available', code: 'SHEETS_NOT_INIT' });
    }
    const spreadsheetId = requireSpreadsheetId(res);
    if (!spreadsheetId) return;
    const clientIp = getClientIp(req);
    const existingRows = await getSheetValues(spreadsheetId, PREDICTIONS_SHEET_RANGE).catch(() => []);
    const alreadyVoted = Array.isArray(existingRows) && existingRows.some((row) => safeStr(row[4]) === clientIp);
    if (alreadyVoted) {
      return res.status(429).json({ error: 'You have already voted from this device or network. Only one vote per IP is allowed.' });
    }
    const { eliteWinner, developmentWinner, userName } = req.body || {};
    const elite = safeStr(eliteWinner);
    const development = safeStr(developmentWinner);
    const name = safeStr(userName) || 'Anonymous';
    if (!elite && !development) {
      return res.status(400).json({ error: 'Pick at least one winner (Elite and/or Development)' });
    }
    const newRow = [new Date().toISOString(), elite || '', development || '', name, clientIp];
    await appendSheetRows(spreadsheetId, PREDICTIONS_SHEET_RANGE, [newRow]);
    const rows = await getSheetValues(spreadsheetId, PREDICTIONS_SHEET_RANGE).catch(() => []);
    const stats = predictionsRowsToStats(Array.isArray(rows) ? rows : []);
    res.status(201).json({ ok: true, stats });
  } catch (error) {
    console.error('Error submitting prediction:', error);
    res.status(500).json({ error: 'Failed to submit prediction' });
  }
});

// -----------------------------
// Routes
// -----------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/tournament/teams', async (req, res) => {
  try {
    if (!sheets) {
      return res.status(503).json({ error: 'Google Sheets API not available', code: 'SHEETS_NOT_INIT' });
    }
    const spreadsheetId = requireSpreadsheetId(res);
    if (!spreadsheetId) return;
    const rows = await getSheetValues(spreadsheetId, 'Teams!A1:Z50');

    const { pools } = parseTeamsFromTeamsSheet(Array.isArray(rows) ? rows : []);

    // Return in your previous structure (elite/development A/B/C/D)
    res.json({
      elite: { A: pools.poolA, B: pools.poolB },
      development: { C: pools.poolC, D: pools.poolD }
    });
  } catch (error) {
    console.error('Error fetching teams data:', error);
    res.status(500).json({ error: 'Failed to fetch teams data', detail: error?.message || String(error) });
  }
});

app.get('/api/tournament/schedule', async (req, res) => {
  try {
    if (!sheets) {
      return res.status(503).json({ error: 'Google Sheets API not available', code: 'SHEETS_NOT_INIT' });
    }
    const spreadsheetId = requireSpreadsheetId(res);
    if (!spreadsheetId) return;

    const [scheduleRows, teamRows, bracketRows] = await Promise.all([
      getSheetValues(spreadsheetId, 'Schedule!A1:Z200'),
      getSheetValues(spreadsheetId, 'Teams!A1:Z50').catch(() => []),
      getSheetValues(spreadsheetId, 'Bracket!A1:Z100').catch(() => []),
    ]);

    const teamsInfo = parseTeamsFromTeamsSheet(Array.isArray(teamRows) ? teamRows : []);
    const scheduleMatches = parseScheduleRows(Array.isArray(scheduleRows) ? scheduleRows : []);
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
    let didAutoInject = false;

    const pushIfMissing = ({ bucket, time, field, team1, score, team2 }) => {
      // Avoid duplicates if the user already entered a row in the Schedule sheet
      const exists = scheduleData[bucket].some(
        (m) => m.time === time && m.field === field
      );
      if (exists) return;
      scheduleData[bucket].push({ time, field, team1, score, team2 });
      didAutoInject = true;
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
      didAutoInject = true;
    };

    scheduleMatches.forEach((m) => {
      const mins = toMinutes(m.time);
      // Pool play ends at 12:51 PM (771 minutes), lunch starts at 12:52 PM, championship starts at 1:22 PM
      const bucket = (mins !== null && mins <= 12 * 60 + 51) ? 'poolPlay' : 'championship';

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
    const bracketFromSheet = parseBracketSheet(bracketRows);
    const hasEliteSeedData =
      bracketFromSheet.elite.quarterfinals.length > 0 ||
      bracketFromSheet.elite.semifinals.length > 0 ||
      bracketFromSheet.elite.final.length > 0;
    const hasEliteExtras =
      bracketFromSheet.elite.consolation.elite.length > 0 ||
      bracketFromSheet.elite.eliteConsolationChampionship.length > 0;
    const hasDevSeedData =
      bracketFromSheet.development.quarterfinals.length > 0 ||
      bracketFromSheet.development.semifinals.length > 0 ||
      bracketFromSheet.development.final.length > 0;
    const hasDevExtras = bracketFromSheet.development.consolation.development.length > 0;

    const useEliteBracket = hasEliteSeedData || hasEliteExtras;
    const useDevBracket = hasDevSeedData;
    const hasBracketData = useEliteBracket || useDevBracket || hasDevExtras;

    const resolvedBrackets = resolveBracketsFromStandingsAndSchedule({
      standings,
      bracketFromSheet,
      scheduleMatches,
    });

    const scoreFromMatch = (m) =>
      m?.score1 && m?.score2 && (m.score1 !== '0' || m.score2 !== '0')
        ? `${m.score1}-${m.score2}`
        : 'vs';

    if (hasBracketData) {
      const qfTimes = ['1:22 PM', '1:43 PM', '2:04 PM', '2:25 PM'];
      const sfTimes = ['2:46 PM', '3:07 PM'];
      const eliteBracket = resolvedBrackets.elite;
      const devBracket = resolvedBrackets.development;

      qfTimes.forEach((time, i) => {
        if (useEliteBracket) {
          const m = eliteBracket.quarterfinals[i];
          if (m) {
            pushIfMissing({
              bucket: 'championship',
              time,
              field: 'Field 1',
              team1: `Elite QF${i + 1}: ${m.team1}`,
              score: scoreFromMatch(m),
              team2: m.team2,
            });
          }
        }
        if (useDevBracket) {
          const m = devBracket.quarterfinals[i];
          if (m) {
            pushIfMissing({
              bucket: 'championship',
              time,
              field: 'Field 2',
              team1: `Dev QF${i + 1}: ${m.team1}`,
              score: scoreFromMatch(m),
              team2: m.team2,
            });
          }
        }
      });

      sfTimes.forEach((time, i) => {
        if (useEliteBracket) {
          const m = eliteBracket.semifinals[i];
          if (m) {
            pushIfMissing({
              bucket: 'championship',
              time,
              field: 'Field 1',
              team1: `Elite SF${i + 1}: ${m.team1}`,
              score: scoreFromMatch(m),
              team2: m.team2,
            });
          }
        }
        if (useDevBracket) {
          const m = devBracket.semifinals[i];
          if (m) {
            pushIfMissing({
              bucket: 'championship',
              time,
              field: 'Field 2',
              team1: `Dev SF${i + 1}: ${m.team1}`,
              score: scoreFromMatch(m),
              team2: m.team2,
            });
          }
        }
      });

      // Finals - Both on Field 1
      if (useDevBracket && devBracket.final) {
        upsertMatch({
          bucket: 'championship',
          time: '4:32 PM',
          field: 'Field 1',
          team1: `Dev Final: ${devBracket.final.team1}`,
          score: scoreFromMatch(devBracket.final),
          team2: devBracket.final.team2,
        });
      }

      if (useEliteBracket && eliteBracket.final) {
        upsertMatch({
          bucket: 'championship',
          time: '4:53 PM',
          field: 'Field 1',
          team1: `Elite Final: ${eliteBracket.final.team1}`,
          score: scoreFromMatch(eliteBracket.final),
          team2: eliteBracket.final.team2,
        });
      }

      // 3rd Place Matches - Both on Field 2
      if (useEliteBracket) {
        const eliteThirdPlace = eliteBracket.thirdPlace || {};
        pushIfMissing({
          bucket: 'championship',
          time: '4:32 PM',
          field: 'Field 2',
          team1: `Elite 3rd Place: ${eliteThirdPlace.team1 || 'Loser SF1'}`,
          score: scoreFromMatch(eliteThirdPlace),
          team2: eliteThirdPlace.team2 || 'Loser SF2',
        });
      }

      if (useDevBracket) {
        const devThirdPlace = devBracket.thirdPlace || {};
        pushIfMissing({
          bucket: 'championship',
          time: '4:53 PM',
          field: 'Field 2',
          team1: `Dev 3rd Place: ${devThirdPlace.team1 || 'Loser SF1'}`,
          score: scoreFromMatch(devThirdPlace),
          team2: devThirdPlace.team2 || 'Loser SF2',
        });
      }

      const allowConsolations = !useDevBracket;
      if (allowConsolations && eliteBracket.consolation?.elite?.length) {
        const eliteConsolTimes = ['2:46 PM', '3:07 PM'];
        eliteConsolTimes.forEach((time, i) => {
          const m = eliteBracket.consolation.elite[i];
          if (!m) return;
          pushIfMissing({
            bucket: 'championship',
            time,
            field: 'Field 2',
            team1: `Elite Consol ${i + 1}: ${m.team1}`,
            score: scoreFromMatch(m),
            team2: m.team2,
          });
        });
      }

      if (allowConsolations && eliteBracket.eliteConsolationChampionship) {
        const m = eliteBracket.eliteConsolationChampionship;
        pushIfMissing({
          bucket: 'championship',
          time: '4:52 PM',
          field: 'Field 2',
          team1: `Elite Consol Championship: ${m.team1}`,
          score: scoreFromMatch(m),
          team2: m.team2,
        });
      }

      if (allowConsolations && devBracket.consolation?.development?.length) {
        const devTimes = ['4:10 PM', '4:31 PM', '4:52 PM'];
        const devLabels = ['Dev 2nd Place', 'Dev 3rd Place', 'Dev 4th Place'];
        devTimes.forEach((time, i) => {
          const m = devBracket.consolation.development[i];
          if (!m) return;
          pushIfMissing({
            bucket: 'championship',
            time,
            field: 'Field 2',
            team1: `${devLabels[i]}: ${m.team1}`,
            score: scoreFromMatch(m),
            team2: m.team2,
          });
        });
      }
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

    if (didAutoInject) {
      scheduleData.championship = sequentializePhase2ByField(scheduleData.championship);
    }

    // Ensure consistent ordering:
    // - poolPlay chronological
    // - championship chronological (after we sequentialize)
    scheduleData.poolPlay = sortScheduleBucket(scheduleData.poolPlay);
    scheduleData.championship = sortScheduleBucket(scheduleData.championship);

    res.json(scheduleData);
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ error: 'Failed to fetch schedule data', detail: error?.message || String(error) });
  }
});

app.get('/api/tournament/bracket', async (req, res) => {
  try {
    if (!sheets) {
      return res.status(503).json({ error: 'Google Sheets API not available', code: 'SHEETS_NOT_INIT' });
    }
    const spreadsheetId = requireSpreadsheetId(res);
    if (!spreadsheetId) return;

    const [scheduleRows, bracketRows, teamRows] = await Promise.all([
      getSheetValues(spreadsheetId, 'Schedule!A1:Z200'),
      getSheetValues(spreadsheetId, 'Bracket!A1:Z100').catch(() => []),
      getSheetValues(spreadsheetId, 'Teams!A1:Z50').catch(() => []),
    ]);

    const teamsInfo = parseTeamsFromTeamsSheet(Array.isArray(teamRows) ? teamRows : []);
    const scheduleMatches = parseScheduleRows(Array.isArray(scheduleRows) ? scheduleRows : []);
    const { standings } = computeStandings(teamsInfo, scheduleMatches);

    const bracketFromSheet = parseBracketSheet(Array.isArray(bracketRows) ? bracketRows : []);

    const resolved = resolveBracketsFromStandingsAndSchedule({
      standings,
      bracketFromSheet,
      scheduleMatches,
    });

    const eliteConsolationChampionship = resolved?.elite?.eliteConsolationChampionship || null;
    res.json({ standings, ...resolved, eliteConsolationChampionship });
  } catch (error) {
    console.error('Error fetching bracket data:', error);
    res.status(500).json({ error: 'Failed to fetch bracket data', detail: error?.message || String(error) });
  }
});

// -----------------------------
// For Vercel: wrap the app so we never invoke Express with null req/res
// (avoids "Cannot read properties of null (reading 'method')" in some runtimes).
// For local: start the server with listen().
if (process.env.VERCEL) {
  module.exports = (req, res) => {
    if (!req || !res) {
      console.error('Vercel handler: req or res is null');
      if (res && typeof res.status === 'function') res.status(500).json({ error: 'Server received invalid request' });
      return;
    }
    app(req, res);
  };
} else {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
