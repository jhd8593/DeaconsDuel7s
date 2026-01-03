import React, { useMemo, useRef, useState, useEffect } from 'react';
import './App.css';

const Icon = ({ name, size = 18, stroke = 'currentColor', className = '', ariaLabel }) => {
  const ariaProps = ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': true, focusable: false };
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', className, ...ariaProps };
  switch (name) {
    case 'grid':
      return (
        <svg {...props}>
          <rect x="4" y="4" width="6" height="6" rx="2" />
          <rect x="14" y="4" width="6" height="6" rx="2" />
          <rect x="4" y="14" width="6" height="6" rx="2" />
          <rect x="14" y="14" width="6" height="6" rx="2" />
        </svg>
      );
    case 'flag':
      return (
        <svg {...props}>
          <path d="M6 20V5" />
          <path d="M6 5h9l-2 4 2 4H6" />
        </svg>
      );
    case 'trophy':
      return (
        <svg {...props}>
          <path d="M8 21h8" />
          <path d="M12 17c3 0 4-2 4-5V4H8v8c0 3 1 5 4 5Z" />
          <path d="M18 4h2v3c0 1.7-1.3 3-3 3h-1" />
          <path d="M6 4H4v3c0 1.7 1.3 3 3 3h1" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...props}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4" />
          <path d="M16 3v4" />
          <path d="M4 10h16" />
        </svg>
      );
    case 'map':
      return (
        <svg {...props}>
          <path d="M9 21 4 19V5l5 2 6-2 5 2v14l-5-2-6 2Z" />
          <path d="M9 7v14" />
          <path d="M15 5v14" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...props}>
          <path d="M3 12a9 9 0 0 1 15-6" />
          <path d="M3 5v7h7" />
          <path d="M21 12a9 9 0 0 1-15 6" />
          <path d="M21 19v-7h-7" />
        </svg>
      );
    default:
      return null;
  }
};

function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const API_BASE = process.env.REACT_APP_API_URL || '';
  const [tournamentData, setTournamentData] = useState({
    overview: {
      totalMatches: '',
      poolPlay: '',
      championship: '',
      estimatedFinish: ''
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
  const touchStartRef = useRef(null);

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

  const computeOverviewFromSchedule = (schedule = {}) => {
    const matchDuration = 20; // 16-minute matches + ~4 minutes turnover
    const poolPlayCount = schedule.poolPlay?.length || 0;
    const championshipCount = schedule.championship?.length || 0;
    const totalMatches = poolPlayCount + championshipCount;

    const allTimes = [...(schedule.poolPlay || []), ...(schedule.championship || [])]
      .map((m) => parseTimeToMinutes(m.time))
      .filter((n) => n != null);

    const lastKick = allTimes.length ? Math.max(...allTimes) : null;
    const estimatedFinish = lastKick != null ? formatMinutesToAmPm(lastKick + matchDuration) : '';

    return {
      totalMatches: totalMatches ? String(totalMatches) : '',
      poolPlay: poolPlayCount ? String(poolPlayCount) : '',
      championship: championshipCount ? String(championshipCount) : '',
      estimatedFinish,
    };
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
      console.log('Fetching data from:', `${API_BASE}/api/tournament/schedule`, `${API_BASE}/api/tournament/teams`, `${API_BASE}/api/tournament/bracket`);
      const [scheduleRes, teamsRes, bracketRes] = await Promise.all([
        fetch(`${API_BASE}/api/tournament/schedule`),
        fetch(`${API_BASE}/api/tournament/teams`),
        fetch(`${API_BASE}/api/tournament/bracket`)
      ]);

      if (!scheduleRes.ok || !teamsRes.ok || !bracketRes.ok) {
        throw new Error('Failed to fetch tournament data');
      }

      const [schedule, teams, bracket] = await Promise.all([
        scheduleRes.json(),
        teamsRes.json(),
        bracketRes.json()
      ]);

      const computedOverview = computeOverviewFromSchedule(schedule);

      setTournamentData({
        overview: computedOverview,
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

  const goToAdjacentTab = (direction) => {
    const idx = tabOrder.indexOf(activeTab);
    if (idx === -1) return;
    const nextIdx = direction === 'next' ? Math.min(tabOrder.length - 1, idx + 1) : Math.max(0, idx - 1);
    setActiveTab(tabOrder[nextIdx]);
  };

  const handleTouchStart = (e) => {
    if (!e.touches?.length) return;
    touchStartRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (touchStartRef.current == null || !e.changedTouches?.length) return;
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current;
    touchStartRef.current = null;
    const threshold = 45;
    if (deltaX > threshold) {
      goToAdjacentTab('prev');
    } else if (deltaX < -threshold) {
      goToAdjacentTab('next');
    }
  };

  const NAV_TABS = [
    { key: 'overview', label: 'Overview', helper: 'Snapshot' },
    { key: 'schedule', label: 'Schedule', helper: 'Matches' },
    { key: 'bracket', label: 'Bracket', helper: 'Knockouts' },
    { key: 'teams', label: 'Teams', helper: 'Registration' }
  ];
  const tabOrder = NAV_TABS.map((t) => t.key);

  return (
    <div className="min-h-screen app-shell">
      {/* Header */}
      <header className="topbar">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="header-grid">
            <div className="brand-block">
              <div className="crest-badge" aria-label="Deacons Duel crest">
                <div className="crest-title">DD</div>
                <div className="crest-sub">7s</div>
              </div>
              <div aria-label="Deacons Duel event summary">
                <div className="kicker">Rugby Sevens Command</div>
                <h1 className="page-title">Deacons Duel 7s</h1>
                <div className="subhead">Feb 15, 2025 | 2 Pitches | 09:00 Kickoff</div>
                <div className="meta-row">
                  <span className="meta-pill">Wake Forest Rugby</span>
                  <span className="meta-pill alt">Winston-Salem, NC</span>
                  <span className="meta-pill subtle">{headerMeta}</span>
                </div>
              </div>
            </div>
            <div className="live-shell">
              {liveGame ? (
                <div className="header-live-indicator">
                  <div className="flex items-center gap-2">
                    <div className="live-dot"></div>
                    <div className="flex flex-col">
                      <span className="live-text">LIVE NOW</span>
                      <span className="live-match-small">{liveGame.team1} vs {liveGame.team2}</span>
                      <span className="live-meta">{liveGame.field} | {liveGame.phase}</span>
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
              <div className="header-actions">
                <button
                  type="button"
                  className={`btn btn-ghost ${refreshing ? 'is-busy' : ''}`}
                  onClick={() => fetchTournamentData({ showInitialLoader: false })}
                  disabled={refreshing}
                  aria-label="Refresh tournament data"
                >
                  <Icon name="refresh" size={16} className="btn-icon" ariaLabel="Refresh" />
                  <span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
                </button>
                <div className="pill subtle-pill">
                  <Icon name="clock" size={14} className="pill-icon" ariaLabel="Last updated" />
                  <span>{headerMeta}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 nav-shell" aria-label="Tournament sections">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="tabs">
            {NAV_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`nav-tab ${activeTab === tab.key ? 'active' : ''}`}
                aria-current={activeTab === tab.key ? 'page' : undefined}
              >
                <span className="nav-tab-label">{tab.label}</span>
                <span className="nav-tab-sub">{tab.helper}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main
        className="content-shell max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {error && (
          <div className="error-banner">
            <div className="text-xs font-mono">{error}</div>
          </div>
        )}

        {!loading && (
          <section className="action-grid" aria-label="Quick actions">
              {[
                { key: 'schedule', icon: 'flag', title: 'Live & Schedule', helper: 'Jump to fixtures', accent: 'primary' },
                { key: 'bracket', icon: 'trophy', title: 'Bracket', helper: 'Cup + consolation', accent: 'accent' },
                { key: 'teams', icon: 'map', title: 'Teams', helper: 'Pools & registration', accent: 'neutral' }
              ].map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className={`action-card ${action.accent}`}
                  onClick={() => setActiveTab(action.key)}
                  aria-label={`Go to ${action.title}`}
                >
                <span className="action-icon">
                  <Icon name={action.icon} size={18} ariaLabel={`${action.title} icon`} />
                </span>
                  <div className="action-text">
                    <span className="action-title">{action.title}</span>
                    <span className="action-helper">{action.helper}</span>
                  </div>
                <span className="action-caret">→</span>
              </button>
            ))}
          </section>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stat-grid">
        {[
          { label: 'TOTAL MATCHES', value: data.totalMatches, icon: 'grid' },
          { label: 'POOL PLAY', value: data.poolPlay, icon: 'flag' },
          { label: 'CHAMPIONSHIP', value: data.championship, icon: 'trophy' },
          { label: 'EST. FINISH', value: data.estimatedFinish, icon: 'clock' }
        ].filter((stat) => stat.value).map((stat, i) => (
          <div key={i} className="stat-card">
            <div className="stat-icon">
              <Icon name={stat.icon} size={18} ariaLabel={stat.label} />
            </div>
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
          <p><span className="font-semibold text-text">ELITE DIVISION</span> - Two pools of three teams. All advance to the 8-team cup bracket; quarterfinal drop-outs slide to consolation.</p>
          <p><span className="font-semibold text-text">DEVELOPMENT DIVISION</span> - Two pools of four teams. Pool winners earn promotion into the Elite cup; remaining sides play ranked fixtures.</p>
          <p><span className="font-semibold text-text">MATCH STRUCTURE</span> - 16-minute matches with 5-minute turnovers between pitches.</p>
          <p><span className="font-semibold text-text">LUNCH BREAK</span> - 30-minute break at 12:30 PM.</p>
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
              <span className="mt-1" aria-hidden>{'>'}</span>
              <span>Pool play utilizes both fields simultaneously</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1" aria-hidden>{'>'}</span>
              <span>Championship matches on Field 1</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1" aria-hidden>{'>'}</span>
              <span>Consolation matches on Field 2</span>
            </li>
          </ul>
        </div>
        <div className="info-card">
          <h3 className="card-title">TEAM REQUIREMENTS</h3>
          <ul className="space-y-3 text-sm text-secondary">
            <li className="flex items-start gap-3">
              <span className="mt-1" aria-hidden>{'>'}</span>
              <span>Arrive 15 minutes before scheduled match</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1" aria-hidden>{'>'}</span>
              <span>Bring adequate hydration and nutrition</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1" aria-hidden>{'>'}</span>
              <span>Monitor schedule board for updates</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
);

const normalizeMatchLabel = (matchText = '') => {
  const spaced = matchText
    .replace(/([A-Za-z0-9)\]#])vs([A-Za-z0-9(#[])/gi, '$1 vs $2')
    .replace(/:\s*/g, ': ')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced;
};

const renderMatchWithWinner = (matchText) => {
  if (!matchText || !matchText.trim()) {
    return <span className="match-muted">TBD</span>;
  }

  const cleanedText = normalizeMatchLabel(matchText);
  const scoreRegex = /^(.+?)\s+(\d+)-(\d+)\s+(.+)$/;
  const match = cleanedText.match(scoreRegex);

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
  const vsMatch = cleanedText.match(vsRegex);

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

  const parts = cleanedText.split(/\s+/);
  if (parts.length === 2) {
    return (
      <span>
        <span>{parts[0]}</span>
        <span className="mx-2 match-scoreline">vs</span>
        <span>{parts[1]}</span>
      </span>
    );
  }

  return <span>{cleanedText}</span>;
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
    { time: '12:39 PM', field1: 'QF1: Pool C 1st vs Pool A 3rd' },
    { time: '1:00 PM', field1: 'QF2: Pool D 1st vs Pool B 3rd' },
    { time: '1:21 PM', field1: 'QF3: Pool A 1st vs Pool C 4th' },
    { time: '1:42 PM', field1: 'QF4: Pool B 1st vs Pool D 4th' },
    { time: '2:03 PM', field1: 'SF1: Winner QF1 vs Winner QF2' },
    { time: '2:24 PM', field1: 'Elite Consol 1: Loser QF1 vs Loser QF2' },
    { time: '2:45 PM', field1: 'SF2: Winner QF3 vs Winner QF4' },
    { time: '3:06 PM', field1: 'Elite Consol 2: Loser QF3 vs Loser QF4' },
    { time: '4:09 PM', field1: 'Elite Consol Championship: Winner EC1 vs Winner EC2' }
  ];

  const phase2BaseRows = championshipPlayRows.length > 0 ? championshipPlayRows : sampleChampionshipRows;

  const finalTimeMinutes = phase2BaseRows
    .map((r) => parseTimeToMinutes(r.time))
    .filter((n) => n != null)
    .reduce((max, n) => (max == null || n > max ? n : max), null);

  // Kept for potential future use if the final time becomes data-driven again.
  // eslint-disable-next-line no-unused-vars
  const finalTimeLabel = formatMinutesToAmPm(finalTimeMinutes) || 'TBD';

  // Final is a fixed time slot (4:30 PM) on Field 1.
  // Prefer the Bracket API final teams when available.
  const FINAL_TIME_LABEL = '4:30 PM';
  const finalFromSchedule = (data?.schedule?.championship || []).find(
    (m) => m.time === FINAL_TIME_LABEL && m.field === 'Field 1'
  );

  const fallbackBracketFinal = data?.bracket?.final || {};

  const finalTeam1 = finalFromSchedule?.team1 || fallbackBracketFinal.team1 || 'WINNER SF1';
  const finalTeam2 = finalFromSchedule?.team2 || fallbackBracketFinal.team2 || 'WINNER SF2';

  // Score can come from the schedule list (already formatted "10-5") or bracket numeric values.
  const finalScoreText = (() => {
    if (finalFromSchedule?.score && finalFromSchedule.score.toLowerCase() !== 'vs') {
      return finalFromSchedule.score;
    }
    const s1 = fallbackBracketFinal.score1;
    const s2 = fallbackBracketFinal.score2;
    if (s1 != null && s2 != null && (String(s1) !== '0' || String(s2) !== '0')) {
      return `${s1}-${s2}`;
    }
    return null;
  })();

  const finalMatchupLabel = finalScoreText
    ? `${finalTeam1} ${finalScoreText} ${finalTeam2}`
    : `${finalTeam1} vs ${finalTeam2}`;


  return (
    <div className="space-y-16">
      <section>
        <div className="section-header">
          <div className="section-label">
            <span className="icon-chip" aria-label="Schedule"><Icon name="calendar" size={16} ariaLabel="Calendar icon" /></span>
            <h2 className="section-title">COMPLETE SCHEDULE</h2>
          </div>
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
                    <span className="live-field-text">{liveGame.field} | {liveGame.phase}</span>
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
              <span className="phase-meta">09:00 - 12:09</span>
            </div>
          </div>
          <div className="table-shell">
            <div className="schedule-table">
              <table className="w-full">
                <thead>
                  <tr className="table-head-row">
                    <th className="text-left py-4 px-6 text-xs font-mono table-head-cell uppercase tracking-wider">TIME</th>
                    <th className="text-left py-4 px-6 text-xs font-mono table-head-cell uppercase tracking-wider">FIELD 1</th>
                    <th className="text-left py-4 px-6 text-xs font-mono table-head-cell uppercase tracking-wider">FIELD 2</th>
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
                      <tr key={i} className={`table-row ${isLiveGame ? 'live-game-row' : ''}`}>
                        <td className="py-4 px-6 text-sm font-mono time-cell">
                          {row.time}
                          {isLiveGame && <span className="live-indicator-small ml-2">LIVE</span>}
                        </td>
                        <td className={`py-4 px-6 text-sm match-cell ${isLiveGame && liveGame.field === 'Field 1' ? 'is-live' : ''}`}>
                          {renderMatchWithWinner(row.field1)}
                        </td>
                        <td className={`py-4 px-6 text-sm match-cell ${isLiveGame && liveGame.field === 'Field 2' ? 'is-live' : ''}`}>
                          {renderMatchWithWinner(row.field2 || '')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Lunch */}
        <div className="mb-16">
          <div className="lunch-break">
            <div className="text-center">
              <div className="phase-meta">BREAK</div>
              <h3 className="text-lg font-mono tracking-wider lunch-title">LUNCH</h3>
              <p className="phase-subtext">12:09 - 12:39</p>
            </div>
          </div>
        </div>

        {/* Phase 2 */}
        <div className="mb-16">
          <div className="phase-header">
          <div className="flex items-center justify-between">
              <h3 className="text-sm font-mono tracking-widest">PHASE 2: CHAMPIONSHIP</h3>
              <span className="phase-meta">12:39 - 16:09</span>
            </div>
          </div>
          <div className="table-shell compact">
            <div className="schedule-table w-full max-w-3xl">
              <table className="w-full">
                <thead>
                  <tr className="table-head-row">
                    <th className="text-left py-4 px-6 text-xs font-mono table-head-cell uppercase tracking-wider">TIME</th>
                    <th className="text-left py-4 px-6 text-xs font-mono table-head-cell uppercase tracking-wider">FIELD 1</th>
                    {/* Phase 2 is Field 1 only */}
                  </tr>
                </thead>
                <tbody>
                  {phase2BaseRows.map((row, i) => (
                    <tr key={i} className="table-row">
                      <td className="py-4 px-6 text-sm font-mono time-cell">{row.time}</td>
                      <td className="py-4 px-6 text-sm match-cell">{renderMatchWithWinner(row.field1)}</td>
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
            <div className="text-center space-y-2">
              <div className="final-badge">CHAMPIONSHIP</div>
              <h3 className="text-2xl font-mono tracking-wider final-title">FINAL</h3>
              <p className="phase-subtext">{FINAL_TIME_LABEL} - FIELD 1</p>
              <p className="text-base font-mono final-matchup">{finalMatchupLabel}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

const getBracketWinner = (score1, score2) => {
  const s1 = Number(score1);
  const s2 = Number(score2);
  if (Number.isNaN(s1) || Number.isNaN(s2)) return null;
  if (s1 === s2) return null;
  return s1 > s2 ? 'team1' : 'team2';
};

const Bracket = ({ data }) => {
  const finalWinner = getBracketWinner(data.final?.score1, data.final?.score2);

  return (
    <div className="space-y-16">
      <section>
        <div className="section-header">
          <div className="section-label">
            <span className="icon-chip" aria-label="Bracket"><Icon name="trophy" size={16} ariaLabel="Trophy icon" /></span>
            <h2 className="section-title">CHAMPIONSHIP BRACKET</h2>
          </div>
        </div>
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
            ]).map((match, i) => {
              const winner = getBracketWinner(match.score1, match.score2);
              return (
                <div key={i} className="bracket-match">
                  <div className={`match-team ${winner === 'team1' ? 'winner' : winner ? 'loser' : ''}`}>
                    <span className="text-sm">{match.team1 || match[0]}</span>
                    <span className="match-score">{match.score1 || '0'}</span>
                  </div>
                  <div className={`match-team ${winner === 'team2' ? 'winner' : winner ? 'loser' : ''}`}>
                    <span className="text-sm">{match.team2 || match[1]}</span>
                    <span className="match-score">{match.score2 || '0'}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Semifinals */}
          <div className="space-y-6">
            <h3 className="bracket-stage-title">SEMIFINALS</h3>
            {(data.semifinals && data.semifinals.length > 0 ? data.semifinals : [
              ['Winner QF1', 'Winner QF2'],
              ['Winner QF3', 'Winner QF4']
            ]).map((match, i) => {
              const winner = getBracketWinner(match.score1, match.score2);
              return (
                <div key={i} className="bracket-match mt-20">
                  <div className={`match-team ${winner === 'team1' ? 'winner' : winner ? 'loser' : ''}`}>
                    <span className="text-sm">{match.team1 || match[0]}</span>
                    <span className="match-score">{match.score1 || '0'}</span>
                  </div>
                  <div className={`match-team ${winner === 'team2' ? 'winner' : winner ? 'loser' : ''}`}>
                    <span className="text-sm">{match.team2 || match[1]}</span>
                    <span className="match-score">{match.score2 || '0'}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Final */}
          <div className="space-y-6">
            <h3 className="bracket-stage-title">FINAL</h3>
            <div className="bracket-final mt-32">
              <div className="final-trophy">TRY</div>
              <div className={`match-team ${finalWinner === 'team1' ? 'winner' : finalWinner ? 'loser' : ''}`}>
                <span className="text-sm">{data.final?.team1 || 'Winner SF1'}</span>
                <span className="match-score">{data.final?.score1 || '0'}</span>
              </div>
              <div className={`match-team ${finalWinner === 'team2' ? 'winner' : finalWinner ? 'loser' : ''}`}>
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
      <div className="section-header">
        <div className="section-label">
          <span className="icon-chip" aria-label="Consolation"><Icon name="flag" size={16} ariaLabel="Flag icon" /></span>
          <h2 className="section-title">CONSOLATION MATCHES</h2>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="consolation-section">
          <h3 className="consolation-title">ELITE BRACKET LOSERS</h3>
          <div className="space-y-4">
            {(data.consolation?.elite && data.consolation.elite.length > 0 ? data.consolation.elite : [
              ['Loser QF1', 'Loser QF2'],
              ['Loser QF3', 'Loser QF4']
            ]).map((match, i) => {
              const winner = getBracketWinner(match.score1, match.score2);
              return (
              <div key={i} className="consolation-match">
                <div className={`match-team-small ${winner === 'team1' ? 'winner' : winner ? 'loser' : ''}`}>
                  <span>{match.team1 || match[0]}</span>
                  <span className="match-score-small">{match.score1 || '0'}</span>
                </div>
                <div className={`match-team-small ${winner === 'team2' ? 'winner' : winner ? 'loser' : ''}`}>
                  <span>{match.team2 || match[1]}</span>
                  <span className="match-score-small">{match.score2 || '0'}</span>
                </div>
              </div>
            )})}

            {data?.eliteConsolationChampionship && (
              (() => {
                const winner = getBracketWinner(
                  data.eliteConsolationChampionship.score1,
                  data.eliteConsolationChampionship.score2
                );
                return (
              <div className="consolation-match">
                <div className="small-muted mb-2 text-center font-mono">ELITE CONSOL CHAMPIONSHIP</div>
                <div className={`match-team-small ${winner === 'team1' ? 'winner' : winner ? 'loser' : ''}`}>
                  <span>{data.eliteConsolationChampionship.team1}</span>
                  <span className="match-score-small">{data.eliteConsolationChampionship.score1 || '0'}</span>
                </div>
                <div className={`match-team-small ${winner === 'team2' ? 'winner' : winner ? 'loser' : ''}`}>
                  <span>{data.eliteConsolationChampionship.team2}</span>
                  <span className="match-score-small">{data.eliteConsolationChampionship.score2 || '0'}</span>
                </div>
              </div>
                );
              })()
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
            ]).map((match, i) => {
              const winner = getBracketWinner(match.score1, match.score2);
              return (
              <div key={i} className="consolation-match">
                <div className="small-muted mb-2 text-center font-mono">{match.place || match[2]}</div>
                <div className={`match-team-small ${winner === 'team1' ? 'winner' : winner ? 'loser' : ''}`}>
                  <span>{match.team1 || match[0]}</span>
                  <span className="match-score-small">{match.score1 || '0'}</span>
                </div>
                <div className={`match-team-small ${winner === 'team2' ? 'winner' : winner ? 'loser' : ''}`}>
                  <span>{match.team2 || match[1]}</span>
                  <span className="match-score-small">{match.score2 || '0'}</span>
                </div>
              </div>
            )})}
          </div>
        </div>
      </div>
    </section>
    </div>
  );
};

const Teams = ({ data }) => (
  <div className="space-y-16">
    <section>
      <div className="section-header">
        <div className="section-label">
          <span className="icon-chip" aria-label="Teams"><Icon name="map" size={16} ariaLabel="Map icon" /></span>
          <h2 className="section-title">TEAM REGISTRATION</h2>
        </div>
      </div>
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
                    readOnly
                    aria-readonly="true"
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
                    readOnly
                    aria-readonly="true"
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
