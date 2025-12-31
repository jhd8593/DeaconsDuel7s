import React, { useMemo, useRef, useState, useEffect } from 'react';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [tournamentData, setTournamentData] = useState({
    overview: {
      totalMatches: '31',
      poolPlay: '18',
      championship: '7',
      estimatedFinish: '3:30 PM'
    },
    schedule: {
      poolPlay: [],
      quarterfinals: [],
      semifinals: [],
      final: {}
    },
    teams: {
      elite: { A: [], B: [] },
      development: { C: [], D: [] }
    },
    bracket: {
      quarterfinals: [],
      semifinals: [],
      final: {},
      consolation: { elite: [], development: [] }
    }
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const isFirstLoadRef = useRef(true);

  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const s = String(timeStr).trim();
    // Supports e.g. "2:45 PM", "14:45", "9:00 AM"
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!m) return null;

    let h = parseInt(m[1], 10);
    const min = parseInt(m[2] ?? '0', 10);
    const ampm = (m[3] ?? '').toUpperCase();

    if (ampm) {
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
    }

    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  };

  const formatMinutesToAmPm = (totalMinutes) => {
    if (totalMinutes == null) return '';
    const h24 = Math.floor(totalMinutes / 60) % 24;
    const min = totalMinutes % 60;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    let h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
  };

  const getCurrentLiveGame = () => {
    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    
    const currentMinutes = parseTimeToMinutes(currentTime);
    
    // Check pool play games
    for (const match of tournamentData.schedule.poolPlay || []) {
      const matchTime = parseTimeToMinutes(match.time);
      const matchEndTime = matchTime + 16; // 16-minute matches
      
      if (currentMinutes >= matchTime && currentMinutes <= matchEndTime) {
        return {
          ...match,
          phase: 'Pool Play',
          isLive: true
        };
      }
    }
    
    // Check championship games
    for (const match of tournamentData.schedule.championship || []) {
      const matchTime = parseTimeToMinutes(match.time);
      const matchEndTime = matchTime + 16; // 16-minute matches
      
      if (currentMinutes >= matchTime && currentMinutes <= matchEndTime) {
        return {
          ...match,
          phase: 'Championship',
          isLive: true
        };
      }
    }
    
    return null;
  };

  const liveGame = getCurrentLiveGame();

  useEffect(() => {
    fetchTournamentData({ showInitialLoader: true });
    const interval = setInterval(() => fetchTournamentData({ showInitialLoader: false }), 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchTournamentData = async ({ showInitialLoader }) => {
    try {
      if (showInitialLoader && isFirstLoadRef.current) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      console.log('Fetching data from:', '/api/tournament/overview', '/api/tournament/schedule', '/api/tournament/teams', '/api/tournament/bracket');
      const [overviewRes, scheduleRes, teamsRes, bracketRes] = await Promise.all([
        fetch('/api/tournament/overview'),
        fetch('/api/tournament/schedule'),
        fetch('/api/tournament/teams'),
        fetch('/api/tournament/bracket')
      ]);

      if (!overviewRes.ok || !scheduleRes.ok || !teamsRes.ok || !bracketRes.ok) {
        throw new Error('Failed to fetch tournament data');
      }

      const [overview, schedule, teams, bracket] = await Promise.all([
        overviewRes.json(),
        scheduleRes.json(),
        teamsRes.json(),
        bracketRes.json()
      ]);

      setTournamentData({
        overview: {
          totalMatches: overview.totalMatches || '31',
          poolPlay: overview.poolPlay || '18',
          championship: overview.championship || '7',
          estimatedFinish: overview.estimatedFinish || '3:30 PM'
        },
        schedule,
        teams,
        bracket
      });

      setLastUpdated(new Date());
      isFirstLoadRef.current = false;
    } catch (err) {
      console.error('Error fetching tournament data:', err);
      setError('Failed to load tournament data. Using default data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const headerMeta = useMemo(() => {
    if (!lastUpdated) return 'Live';
    const t = lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `Updated ${t}`;
  }, [lastUpdated]);

  return (
    <div className="min-h-screen app-shell">
      {/* Header */}
      <header className="topbar">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="kicker">Tournament Dashboard</div>
              <h1 className="page-title">Deacons Duel 7s</h1>
              <div className="subhead">Feb 15, 2025 • 2 Fields • 09:00 Start</div>
            </div>
            <div className="flex items-center gap-3">
              {liveGame ? (
                <div className="header-live-indicator">
                  <div className="flex items-center gap-2">
                    <div className="live-dot"></div>
                    <div className="flex flex-col">
                      <span className="live-text">LIVE NOW</span>
                      <span className="live-match-small">{liveGame.team1} vs {liveGame.team2}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="header-live-indicator">
                  <div className="flex items-center gap-2">
                    <div className="live-dot inactive"></div>
                    <span className="live-text inactive">NO LIVE GAMES</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 nav-shell">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="tabs">
            {['OVERVIEW', 'SCHEDULE', 'BRACKET', 'TEAMS'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab.toLowerCase())}
                className={`nav-tab ${activeTab === tab.toLowerCase() ? 'active' : ''}`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {error && (
          <div className="error-banner">
            <div className="text-xs font-mono">{error}</div>
          </div>
        )}

        {loading ? (
          <div className="skeleton-page">
            <div className="skeleton-grid">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton-card" />
              ))}
            </div>
            <div className="skeleton-block" />
            <div className="skeleton-block" />
          </div>
        ) : (
          <>
        {activeTab === 'overview' && <Overview data={tournamentData.overview} />}
        {activeTab === 'schedule' && <Schedule data={tournamentData} parseTimeToMinutes={parseTimeToMinutes} formatMinutesToAmPm={formatMinutesToAmPm} liveGame={liveGame} />}
        {activeTab === 'bracket' && <Bracket data={tournamentData.bracket} />}
        {activeTab === 'teams' && <Teams data={tournamentData.teams} />}
          </>
        )}
      </main>
    </div>
  );
}

const Overview = ({ data }) => (
  <div className="space-y-16">
    {/* Stats Grid */}
    <section>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'TOTAL MATCHES', value: data.totalMatches },
          { label: 'POOL PLAY', value: data.poolPlay },
          { label: 'CHAMPIONSHIP', value: data.championship },
          { label: 'EST. FINISH', value: data.estimatedFinish }
        ].map((stat, i) => (
          <div key={i} className="stat-card">
            <div className="stat-value">{stat.value}</div>
            <div className="stat-label">{stat.label}</div>
          </div>
        ))}
      </div>
    </section>

    {/* Format */}
    <section className="space-y-8">
      <h2 className="section-title">TOURNAMENT FORMAT</h2>
      <div className="info-card">
        <div className="space-y-6 text-sm text-secondary leading-relaxed">
          <p><span className="font-semibold text-text">ELITE DIVISION</span> — Two pools of three teams. All advance to 8-team championship bracket. Quarterfinalists play consolation matches.</p>
          <p><span className="font-semibold text-text">DEVELOPMENT DIVISION</span> — Two pools of four teams. Winners join Elite bracket. Remaining teams compete by rank: 2v2, 3v3, 4v4.</p>
          <p><span className="font-semibold text-text">MATCH STRUCTURE</span> — 16-minute matches with 5-minute turnovers between fields.</p>
          <p><span className="font-semibold text-text">LUNCH BREAK</span> — 30-minute break at 12:30 PM.</p>
        </div>
      </div>
    </section>

    {/* Key Details */}
    <section className="space-y-8">
      <h2 className="section-title">CRITICAL INFORMATION</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="info-card">
          <h3 className="card-title">FIELD ASSIGNMENTS</h3>
          <ul className="space-y-3 text-sm text-secondary">
            <li className="flex items-start gap-3">
              <span className="mt-1" aria-hidden>▸</span>
              <span>Pool play utilizes both fields simultaneously</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1" aria-hidden>▸</span>
              <span>Championship matches on Field 1</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1" aria-hidden>▸</span>
              <span>Consolation matches on Field 2</span>
            </li>
          </ul>
        </div>
        <div className="info-card">
          <h3 className="card-title">TEAM REQUIREMENTS</h3>
          <ul className="space-y-3 text-sm text-secondary">
            <li className="flex items-start gap-3">
              <span className="mt-1" aria-hidden>▸</span>
              <span>Arrive 15 minutes before scheduled match</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1" aria-hidden>▸</span>
              <span>Bring adequate hydration and nutrition</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1" aria-hidden>▸</span>
              <span>Monitor schedule board for updates</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
);

const renderMatchWithWinner = (matchText) => {
  if (!matchText || !matchText.trim()) {
    return <span className="match-muted">TBD</span>;
  }

  const scoreRegex = /^(.+?)\s+(\d+)-(\d+)\s+(.+)$/;
  const match = matchText.match(scoreRegex);

  if (match) {
    const team1 = match[1].trim();
    const score1 = parseInt(match[2]);
    const score2 = parseInt(match[3]);
    const team2 = match[4].trim();

    const winner = score1 > score2 ? team1 : team2;

    return (
      <span>
        <span className={winner === team1 ? "match-winner" : "match-muted"}>{team1}</span>
        <span className="mx-2 match-scoreline">{score1}-{score2}</span>
        <span className={winner === team2 ? "match-winner" : "match-muted"}>{team2}</span>
      </span>
    );
  }

  const vsRegex = /^(.+?)\s+(?:vs|0)\s+(.+)$/;
  const vsMatch = matchText.match(vsRegex);

  if (vsMatch) {
    const team1 = vsMatch[1].trim();
    const team2 = vsMatch[2].trim();

    return (
      <span>
        <span>{team1}</span>
        <span className="mx-2 match-scoreline">vs</span>
        <span>{team2}</span>
      </span>
    );
  }

  const parts = matchText.split(/\s+/);
  if (parts.length === 2) {
    return (
      <span>
        <span>{parts[0]}</span>
        <span className="mx-2 match-scoreline">vs</span>
        <span>{parts[1]}</span>
      </span>
    );
  }

  return <span>{matchText}</span>;
};

const Schedule = ({ data, parseTimeToMinutes, formatMinutesToAmPm, liveGame }) => {
  // Helper to group matches by time
  const matchesByTime = (data.schedule.poolPlay || []).reduce((acc, match) => {
    if (!acc[match.time]) {
      acc[match.time] = {};
    }
    if (match.field === 'Field 1') {
      acc[match.time].field1 = `${match.team1} ${match.score} ${match.team2}`;
    } else if (match.field === 'Field 2') {
      acc[match.time].field2 = `${match.team1} ${match.score} ${match.team2}`;
    }
    return acc;
  }, {});

  const poolPlayRows = Object.entries(matchesByTime).map(([time, matches]) => ({
    time,
    ...matches
  }));


  const championshipRows = (data.schedule.championship || []).reduce((acc, match) => {
    if (!acc[match.time]) {
      acc[match.time] = {};
    }
    if (match.field === 'Field 1') {
      acc[match.time].field1 = `${match.team1} ${match.score} ${match.team2}`;
    } else if (match.field === 'Field 2') {
      acc[match.time].field2 = `${match.team1} ${match.score} ${match.team2}`;
    }
    return acc;
  }, {});

  const championshipPlayRows = Object.entries(championshipRows).map(([time, matches]) => ({
    time,
    ...matches
  }));

  const sampleChampionshipRows = [
    { time: '12:39 PM', field1: 'QF1: Seed 1 vs Seed 8 (Dev C #1)' },
    { time: '1:00 PM', field1: 'QF2: Seed 4 vs Seed 5' },
    { time: '1:21 PM', field1: 'QF3: Seed 2 vs Seed 7 (Dev D #1)' },
    { time: '1:42 PM', field1: 'QF4: Seed 3 vs Seed 6' },
    { time: '2:03 PM', field1: 'SF1: Winner QF1 vs Winner QF2' },
    { time: '2:24 PM', field1: 'SF2: Winner QF3 vs Winner QF4' }
  ];

  const phase2BaseRows = championshipPlayRows.length > 0 ? championshipPlayRows : sampleChampionshipRows;

  const finalTimeMinutes = phase2BaseRows
    .map((r) => parseTimeToMinutes(r.time))
    .filter((n) => n != null)
    .reduce((max, n) => (max == null || n > max ? n : max), null);

  // Kept for potential future use if the final time becomes data-driven again.
  // eslint-disable-next-line no-unused-vars
  const finalTimeLabel = formatMinutesToAmPm(finalTimeMinutes) || 'TBD';

  // Final is a fixed time slot (4:09 PM) on Field 1.
  // Prefer the Bracket API final teams when available.
  const FINAL_TIME_LABEL = '4:30 PM';
  const finalTeam1 = data?.bracket?.final?.team1 || 'WINNER SF1';
  const finalTeam2 = data?.bracket?.final?.team2 || 'WINNER SF2';
  const finalMatchupLabel = `${finalTeam1} vs ${finalTeam2}`;


  return (
    <div className="space-y-16">
      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="section-title">COMPLETE SCHEDULE</h2>
        </div>

        {/* Live Games Banner */}
        {liveGame && (
          <div className="mb-8">
            <div className="live-games-banner">
              <div className="flex items-center justify-center gap-3">
                <div className="live-dot-large"></div>
                <div className="text-center">
                  <span className="live-banner-text">LIVE NOW</span>
                  <div className="live-game-details">
                    <span className="live-match-text">{liveGame.team1} vs {liveGame.team2}</span>
                    <span className="live-field-text">• {liveGame.field} • {liveGame.phase}</span>
                  </div>
                </div>
                <div className="live-dot-large"></div>
              </div>
            </div>
          </div>
        )}

        {/* Phase 1 */}
        <div className="mb-16">
          <div className="phase-header">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-mono tracking-widest">PHASE 1: POOL PLAY</h3>
              <span className="text-xs text-zinc-500 font-mono">09:00 — 12:09</span>
            </div>
          </div>
          <div className="schedule-table">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left py-4 px-6 text-xs font-mono text-zinc-500 uppercase tracking-wider">TIME</th>
                  <th className="text-left py-4 px-6 text-xs font-mono text-zinc-500 uppercase tracking-wider">FIELD 1</th>
                  <th className="text-left py-4 px-6 text-xs font-mono text-zinc-500 uppercase tracking-wider">FIELD 2</th>
                </tr>
              </thead>
              <tbody>
                {(poolPlayRows.length > 0 ? poolPlayRows : [
                  {time: '9:00 AM', field1: 'Pool A: A1 vs A2', field2: 'Pool C: C1 vs C2'},
                  {time: '9:21 AM', field1: 'Pool B: B1 vs B2', field2: 'Pool D: D1 vs D2'},
                  {time: '9:42 AM', field1: 'Pool A: A2 vs A3', field2: 'Pool C: C1 vs C3'},
                  {time: '10:03 AM', field1: 'Pool B: B2 vs B3', field2: 'Pool D: D1 vs D3'},
                  {time: '10:24 AM', field1: 'Pool A: A3 vs A1', field2: 'Pool C: C1 vs C4'},
                  {time: '10:45 AM', field1: 'Pool B: B3 vs B1', field2: 'Pool D: D1 vs D4'},
                  {time: '11:06 AM', field1: 'Pool C: C2 vs C3', field2: 'Pool D: D2 vs D3'},
                  {time: '11:27 AM', field1: 'Pool C: C2 vs C4', field2: 'Pool D: D2 vs D4'},
                  {time: '11:48 AM', field1: 'Pool C: C3 vs C4', field2: 'Pool D: D3 vs D4'}
                ]).map((row, i) => {
                  const isLiveGame = liveGame && liveGame.time === row.time && 
                    ((liveGame.field === 'Field 1' && row.field1 === liveGame.team1 + ' ' + liveGame.score + ' ' + liveGame.team2) ||
                     (liveGame.field === 'Field 2' && row.field2 === liveGame.team1 + ' ' + liveGame.score + ' ' + liveGame.team2));
                  
                  return (
                    <tr key={i} className={`border-b border-zinc-900 hover:bg-zinc-950 transition-colors ${isLiveGame ? 'live-game-row' : ''}`}>
                      <td className="py-4 px-6 text-sm font-mono text-white">
                        {row.time}
                        {isLiveGame && <span className="live-indicator-small ml-2">🔴 LIVE</span>}
                      </td>
                      <td className={`py-4 px-6 text-sm ${isLiveGame && liveGame.field === 'Field 1' ? 'text-red-500 font-bold' : 'text-zinc-400'}`}>
                        {renderMatchWithWinner(row.field1)}
                      </td>
                      <td className={`py-4 px-6 text-sm ${isLiveGame && liveGame.field === 'Field 2' ? 'text-red-500 font-bold' : 'text-zinc-400'}`}>
                        {renderMatchWithWinner(row.field2 || '')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Lunch */}
        <div className="mb-16">
          <div className="lunch-break">
            <div className="text-center">
              <div className="text-xs font-mono text-zinc-500 mb-2">BREAK</div>
              <h3 className="text-lg font-mono tracking-wider text-white mb-1">LUNCH</h3>
              <p className="text-sm text-zinc-500 font-mono">12:09 — 12:39</p>
            </div>
          </div>
        </div>

        {/* Phase 2 */}
        <div className="mb-16">
          <div className="phase-header">
          <div className="flex items-center justify-between">
              <h3 className="text-sm font-mono tracking-widest">PHASE 2: CHAMPIONSHIP</h3>
              <span className="text-xs text-zinc-500 font-mono">12:39 — 16:09</span>
            </div>
          </div>
          <div className="flex justify-center">
            <div className="schedule-table w-full max-w-3xl">
              <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left py-4 px-6 text-xs font-mono text-zinc-500 uppercase tracking-wider">TIME</th>
                  <th className="text-left py-4 px-6 text-xs font-mono text-zinc-500 uppercase tracking-wider">FIELD 1</th>
                  {/* Phase 2 is Field 1 only */}
                </tr>
              </thead>
              <tbody>
                {phase2BaseRows.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-900 hover:bg-zinc-950 transition-colors">
                    <td className="py-4 px-6 text-sm font-mono text-white">{row.time}</td>
                    <td className="py-4 px-6 text-sm text-zinc-400">{renderMatchWithWinner(row.field1)}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Final */}
        <div>
          <div className="final-match">
            <div className="text-center">
              <div className="final-badge">CHAMPIONSHIP</div>
              <h3 className="text-2xl font-mono tracking-wider text-white mb-4">FINAL</h3>
              <p className="text-sm text-zinc-400 font-mono mb-2">{FINAL_TIME_LABEL} — FIELD 1</p>
              <p className="text-xs text-zinc-600 font-mono">{finalMatchupLabel}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

const Bracket = ({ data }) => (
  <div className="space-y-16">
    <section>
      <h2 className="section-title mb-12">CHAMPIONSHIP BRACKET</h2>
      <div className="bracket-container">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Quarterfinals */}
          <div className="space-y-6">
            <h3 className="bracket-stage-title">QUARTERFINALS</h3>
            {(data.quarterfinals && data.quarterfinals.length > 0 ? data.quarterfinals : [
              ['Seed 1', 'Seed 8 (Dev C #1)'],
              ['Seed 4', 'Seed 5'],
              ['Seed 2', 'Seed 7 (Dev D #1)'],
              ['Seed 3', 'Seed 6']
            ]).map((match, i) => (
              <div key={i} className="bracket-match">
                <div className="match-team">
                  <span className="text-sm">{match.team1 || match[0]}</span>
                  <span className="match-score">{match.score1 || '0'}</span>
                </div>
                <div className="match-team">
                  <span className="text-sm">{match.team2 || match[1]}</span>
                  <span className="match-score">{match.score2 || '0'}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Semifinals */}
          <div className="space-y-6">
            <h3 className="bracket-stage-title">SEMIFINALS</h3>
            {(data.semifinals && data.semifinals.length > 0 ? data.semifinals : [
              ['Winner QF1', 'Winner QF2'],
              ['Winner QF3', 'Winner QF4']
            ]).map((match, i) => (
              <div key={i} className="bracket-match mt-20">
                <div className="match-team">
                  <span className="text-sm">{match.team1 || match[0]}</span>
                  <span className="match-score">{match.score1 || '0'}</span>
                </div>
                <div className="match-team">
                  <span className="text-sm">{match.team2 || match[1]}</span>
                  <span className="match-score">{match.score2 || '0'}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Final */}
          <div className="space-y-6">
            <h3 className="bracket-stage-title">FINAL</h3>
            <div className="bracket-final mt-32">
              <div className="final-trophy">★</div>
              <div className="match-team">
                <span className="text-sm">{data.final?.team1 || 'Winner SF1'}</span>
                <span className="match-score">{data.final?.score1 || '0'}</span>
              </div>
              <div className="match-team">
                <span className="text-sm">{data.final?.team2 || 'Winner SF2'}</span>
                <span className="match-score">{data.final?.score2 || '0'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* Consolation */}
    <section>
      <h2 className="section-title mb-12">CONSOLATION MATCHES</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="consolation-section">
          <h3 className="consolation-title">ELITE BRACKET LOSERS</h3>
          <div className="space-y-4">
            {(data.consolation?.elite && data.consolation.elite.length > 0 ? data.consolation.elite : [
              ['Loser QF1', 'Loser QF2'],
              ['Loser QF3', 'Loser QF4']
            ]).map((match, i) => (
              <div key={i} className="consolation-match">
                <div className="match-team-small">
                  <span>{match.team1 || match[0]}</span>
                  <span className="match-score-small">{match.score1 || '0'}</span>
                </div>
                <div className="match-team-small">
                  <span>{match.team2 || match[1]}</span>
                  <span className="match-score-small">{match.score2 || '0'}</span>
                </div>
              </div>
            ))}

            {data?.eliteConsolationChampionship && (
              <div className="consolation-match">
                <div className="text-xs text-zinc-600 mb-2 text-center font-mono">ELITE CONSOL CHAMPIONSHIP</div>
                <div className="match-team-small">
                  <span>{data.eliteConsolationChampionship.team1}</span>
                  <span className="match-score-small">{data.eliteConsolationChampionship.score1 || '0'}</span>
                </div>
                <div className="match-team-small">
                  <span>{data.eliteConsolationChampionship.team2}</span>
                  <span className="match-score-small">{data.eliteConsolationChampionship.score2 || '0'}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="consolation-section">
          <h3 className="consolation-title">DEVELOPMENT RANK MATCHES</h3>
          <div className="space-y-4">
            {(data.consolation?.development && data.consolation.development.length > 0 ? data.consolation.development : [
              ['Pool C #2', 'Pool D #2', '2ND PLACE'],
              ['Pool C #3', 'Pool D #3', '3RD PLACE'],
              ['Pool C #4', 'Pool D #4', '4TH PLACE']
            ]).map((match, i) => (
              <div key={i} className="consolation-match">
                <div className="text-xs text-zinc-600 mb-2 text-center font-mono">{match.place || match[2]}</div>
                <div className="match-team-small">
                  <span>{match.team1 || match[0]}</span>
                  <span className="match-score-small">{match.score1 || '0'}</span>
                </div>
                <div className="match-team-small">
                  <span>{match.team2 || match[1]}</span>
                  <span className="match-score-small">{match.score2 || '0'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  </div>
);

const Teams = ({ data }) => (
  <div className="space-y-16">
    <section>
      <h2 className="section-title mb-12">TEAM REGISTRATION</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Elite Pools */}
        <div className="space-y-8">
          <h3 className="division-title">ELITE DIVISION</h3>
          {['A', 'B'].map((pool) => (
            <div key={pool} className="pool-card">
              <h4 className="pool-title">POOL {pool}</h4>
              <div className="space-y-3">
                {(data.elite?.[pool] && data.elite[pool].length > 0 ? data.elite[pool] : ['A1', 'A2', 'A3'].map(n => `${pool}${n}`)).map((team, i) => (
                  <input
                    key={i}
                    type="text"
                    defaultValue={team}
                    placeholder={`${pool}${i + 1} TEAM NAME`}
                    className="team-input"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Development Pools */}
        <div className="space-y-8">
          <h3 className="division-title">DEVELOPMENT DIVISION</h3>
          {['C', 'D'].map((pool) => (
            <div key={pool} className="pool-card">
              <h4 className="pool-title">POOL {pool}</h4>
              <div className="space-y-3">
                {(data.development?.[pool] && data.development[pool].length > 0 ? data.development[pool] : ['C1', 'C2', 'C3', 'C4'].map(n => `${pool}${n}`)).map((team, i) => (
                  <input
                    key={i}
                    type="text"
                    defaultValue={team}
                    placeholder={`${pool}${i + 1} TEAM NAME`}
                    className="team-input"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  </div>
);

export default App;
