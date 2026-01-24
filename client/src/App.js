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
      championship: [],
      quarterfinals: [],
      semifinals: [],
      final: {}
    },
    teams: {
      elite: { A: [], B: [] },
      development: { C: [], D: [] }
    },
    bracket: {
      elite: {
        quarterfinals: [],
        semifinals: [],
        final: {},
        consolation: { elite: [], development: [] },
        eliteConsolationChampionship: null,
      },
      development: {
        quarterfinals: [],
        semifinals: [],
        final: {},
        consolation: { elite: [], development: [] },
      }
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
    const totalMatchesValue = Math.max(31, totalMatches || 0);

    return {
      totalMatches: String(totalMatchesValue),
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

  // Check if pool play is complete to show bracket tab
  const isPoolPlayComplete = () => {
    const poolPlayMatches = tournamentData.schedule?.poolPlay || [];
    if (poolPlayMatches.length === 0) return false;
    const expectedMatches = 12;
    if (poolPlayMatches.length < expectedMatches) return false;
    return poolPlayMatches.every(match => {
      const score = String(match.score || '').trim().toLowerCase();
      return score && score !== 'vs' && score !== '0-0' && !isUnplayedScoreText(score);
    });
  };

  const poolPlayComplete = isPoolPlayComplete();

  const NAV_TABS = [
    { key: 'overview', label: 'Overview', helper: 'Snapshot' },
    { key: 'schedule', label: 'Schedule', helper: 'Matches' },
    ...(poolPlayComplete ? [{ key: 'bracket', label: 'Bracket', helper: 'Knockouts' }] : []),
    { key: 'teams', label: 'Teams', helper: 'Registration' }
  ];
  const tabOrder = NAV_TABS.map((t) => t.key);

  return (
    <div className="min-h-screen app-shell">
      {/* Header */}
      <header className="topbar">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
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
      <nav className="nav-shell" aria-label="Tournament sections">
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
        {activeTab === 'schedule' && <Schedule data={tournamentData} liveGame={liveGame} />}
        {activeTab === 'bracket' && poolPlayComplete && <Bracket data={tournamentData.bracket} schedule={tournamentData.schedule} />}
        {activeTab === 'bracket' && !poolPlayComplete && (
          <div className="text-center py-16">
            <div className="info-card max-w-md mx-auto">
              <h2 className="section-title mb-4">POOL PLAY IN PROGRESS</h2>
              <p className="text-sm text-secondary">Complete all pool play matches to view brackets and finals.</p>
            </div>
          </div>
        )}
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
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 stat-grid">
        {[
          { label: 'TOTAL MATCHES', value: data.totalMatches, icon: 'grid' },
          { label: 'POOL PLAY', value: data.poolPlay, icon: 'flag' },
          { label: 'BRACKETS', value: data.championship, icon: 'trophy' },
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
          <p><span className="font-semibold text-text">ELITE DIVISION</span> - Two pools of four teams. Top teams from pool play advance to the Elite bracket playoffs (quarterfinals, semifinals, 3rd place, and final).</p>
          <p><span className="font-semibold text-text">DEVELOPMENT DIVISION</span> - Two pools of four teams. Top teams from pool play advance to the Development bracket playoffs (quarterfinals, semifinals, 3rd place, and final).</p>
          <p><span className="font-semibold text-text">MATCH STRUCTURE</span> - 16-minute matches with 5-minute turnovers between pitches.</p>
          <p><span className="font-semibold text-text">LUNCH BREAK</span> - 30-minute break at 12:52 PM.</p>
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

const escapeRegExp = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripMatchLabel = (matchText = '') => {
  const cleaned = String(matchText ?? '').trim();
  if (!cleaned) return '';
  const idx = cleaned.indexOf(':');
  return idx === -1 ? cleaned : cleaned.slice(idx + 1).trim();
};

const findUniqueMatchByLabels = (matches = [], labels = []) => {
  for (const label of labels) {
    const pattern = new RegExp(`\\b${escapeRegExp(label)}\\b`, 'i');
    const found = matches.filter((m) => pattern.test(m.team1 || '') || pattern.test(m.team2 || ''));
    if (found.length === 1) return found[0];
  }
  return null;
};

const isUnplayedScoreText = (scoreText = '') => {
  const s = String(scoreText ?? '').trim().toLowerCase();
  if (!s || s === 'vs') return true;
  if (s === '0' || s === '0-0' || s === '0:0') return true;
  if (/^0+\s*-\s*0+$/.test(s)) return true;
  return false;
};

const isUnplayedScoreValue = (value = '') => {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s || s === 'vs' || s === '0-0' || s === '0:0') return true;
  return /^0+(?:\.0+)?$/.test(s);
};

const isUnplayedScorePair = (score1, score2) => (
  isUnplayedScoreValue(score1) && isUnplayedScoreValue(score2)
);

const formatScheduleScore = (scoreText) => (
  isUnplayedScoreText(scoreText) ? 'vs' : String(scoreText ?? '').trim()
);

const formatBracketScore = (score, otherScore) => (
  isUnplayedScorePair(score, otherScore)
    ? 'vs'
    : (String(score ?? '').trim() || '0')
);

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

    if (isUnplayedScorePair(score1, score2)) {
      return (
        <span>
          <span>{team1}</span>
          <span className="mx-2 match-scoreline">vs</span>
          <span>{team2}</span>
        </span>
      );
    }

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

const Schedule = ({ data, liveGame }) => {
  // Check if all pool play games are completed
  const isPoolPlayComplete = () => {
    const poolPlayMatches = data.schedule.poolPlay || [];
    if (poolPlayMatches.length === 0) return false;
    // Expected 12 pool play matches (6 per pool, 4 pools)
    const expectedMatches = 12;
    if (poolPlayMatches.length < expectedMatches) return false;
    // Check if all matches have scores (not "vs" or empty)
    return poolPlayMatches.every(match => {
      const score = String(match.score || '').trim().toLowerCase();
      return score && score !== 'vs' && score !== '0-0' && !isUnplayedScoreText(score);
    });
  };

  const poolPlayComplete = isPoolPlayComplete();

  // Helper to group matches by time
  const matchesByTime = (data.schedule.poolPlay || []).reduce((acc, match) => {
    if (!acc[match.time]) {
      acc[match.time] = {};
    }
    const scoreText = formatScheduleScore(match.score);
    if (match.field === 'Field 1') {
      acc[match.time].field1 = `${match.team1} ${scoreText} ${match.team2}`;
    } else if (match.field === 'Field 2') {
      acc[match.time].field2 = `${match.team1} ${scoreText} ${match.team2}`;
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
    const scoreText = formatScheduleScore(match.score);
    if (match.field === 'Field 1') {
      acc[match.time].field1 = `${match.team1} ${scoreText} ${match.team2}`;
    } else if (match.field === 'Field 2') {
      acc[match.time].field2 = `${match.team1} ${scoreText} ${match.team2}`;
    }
    return acc;
  }, {});

  const championshipPlayRows = Object.entries(championshipRows).map(([time, matches]) => ({
    time,
    ...matches
  }));

  const sampleChampionshipRows = [
    { time: '1:22 PM', field1: 'Elite QF1: Pool A 1st vs Pool B 4th', field2: 'Dev QF1: Pool C 1st vs Pool D 4th' },
    { time: '1:43 PM', field1: 'Elite QF2: Pool A 2nd vs Pool B 3rd', field2: 'Dev QF2: Pool C 2nd vs Pool D 3rd' },
    { time: '2:04 PM', field1: 'Elite QF3: Pool B 1st vs Pool A 4th', field2: 'Dev QF3: Pool D 1st vs Pool C 4th' },
    { time: '2:25 PM', field1: 'Elite QF4: Pool B 2nd vs Pool A 3rd', field2: 'Dev QF4: Pool D 2nd vs Pool C 3rd' },
    { time: '2:46 PM', field1: 'Elite SF1: Winner QF1 vs Winner QF2', field2: 'Dev SF1: Winner QF1 vs Winner QF2' },
    { time: '3:07 PM', field1: 'Elite SF2: Winner QF3 vs Winner QF4', field2: 'Dev SF2: Winner QF3 vs Winner QF4' },
    { time: '4:32 PM', field1: 'Dev Final: Winner SF1 vs Winner SF2', field2: 'Elite 3rd Place: Loser SF1 vs Loser SF2' },
    { time: '4:53 PM', field1: 'Elite Final: Winner SF1 vs Winner SF2', field2: 'Dev 3rd Place: Loser SF1 vs Loser SF2' }
  ];

  const phase2BaseRows = championshipPlayRows.length > 0 ? championshipPlayRows : sampleChampionshipRows;
  const showPhase2Field2 = phase2BaseRows.some((row) => row.field2);

  const scheduleChampionship = data?.schedule?.championship || [];
  const eliteFinalFallback = data?.bracket?.elite?.final || data?.bracket?.final || {};
  const devFinalFallback = data?.bracket?.development?.final || {};

  const buildFinal = ({ labels, fallbackFinal, fallbackTime, fallbackField, defaultTeam1, defaultTeam2 }) => {
    const fromSchedule = findUniqueMatchByLabels(scheduleChampionship, labels);
    const team1 = stripMatchLabel(fromSchedule?.team1 || fallbackFinal?.team1 || defaultTeam1);
    const team2 = stripMatchLabel(fromSchedule?.team2 || fallbackFinal?.team2 || defaultTeam2);
    const scoreText = (() => {
      if (fromSchedule?.score && String(fromSchedule.score).toLowerCase() !== 'vs') {
        return fromSchedule.score;
      }
      const s1 = fallbackFinal?.score1;
      const s2 = fallbackFinal?.score2;
      if (s1 != null && s2 != null && (String(s1) !== '0' || String(s2) !== '0')) {
        return `${s1}-${s2}`;
      }
      return null;
    })();
    return {
      team1,
      team2,
      scoreText,
      time: fromSchedule?.time || fallbackTime || '',
      field: fromSchedule?.field || fallbackField || '',
      hasData: Boolean(fromSchedule || fallbackFinal?.team1 || fallbackFinal?.team2),
    };
  };

  const eliteFinal = buildFinal({
    labels: ['Elite Final', 'Final'],
    fallbackFinal: eliteFinalFallback,
    fallbackTime: '4:53 PM',
    fallbackField: 'Field 1',
    defaultTeam1: 'WINNER SF1',
    defaultTeam2: 'WINNER SF2',
  });

  const devFinal = buildFinal({
    labels: ['Dev Final', 'Development Final'],
    fallbackFinal: devFinalFallback,
    fallbackTime: '4:32 PM',
    fallbackField: 'Field 2',
    defaultTeam1: 'WINNER DEV SF1',
    defaultTeam2: 'WINNER DEV SF2',
  });

  const eliteFinalMatchup = eliteFinal.scoreText
    ? `${eliteFinal.team1} ${eliteFinal.scoreText} ${eliteFinal.team2}`
    : `${eliteFinal.team1} vs ${eliteFinal.team2}`;

  const devFinalMatchup = devFinal.scoreText
    ? `${devFinal.team1} ${devFinal.scoreText} ${devFinal.team2}`
    : `${devFinal.team1} vs ${devFinal.team2}`;

  const showDevFinal = devFinal.hasData || (data?.bracket?.development?.quarterfinals?.length || 0) > 0;


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
            <div className="phase-title-stack">
              <h3 className="text-sm font-mono tracking-widest">PHASE 1: POOL PLAY</h3>
              <span className="phase-meta">09:00 - 12:51 PM</span>
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
                    {time: '11:48 AM', field1: 'Pool C: C3 vs C4', field2: 'Pool D: D3 vs D4'},
                    {time: '12:09 PM', field1: 'Pool A: A4 vs A1', field2: 'Pool B: B4 vs B1'},
                    {time: '12:30 PM', field1: 'Pool A: A4 vs A2', field2: 'Pool B: B4 vs B2'},
                    {time: '12:51 PM', field1: 'Pool A: A4 vs A3', field2: 'Pool B: B4 vs B3'}
                  ]).map((row, i) => {
                    const isLiveGame = liveGame && liveGame.time === row.time && 
                      ((liveGame.field === 'Field 1' && row.field1 === liveGame.team1 + ' ' + liveGame.score + ' ' + liveGame.team2) ||
                       (liveGame.field === 'Field 2' && row.field2 === liveGame.team1 + ' ' + liveGame.score + ' ' + liveGame.team2));
                    
                    return (
                      <tr key={i} className={`table-row ${isLiveGame ? 'live-game-row' : ''}`}>
                        <td className="py-4 px-6 text-sm font-mono time-cell" data-label="Time">
                          {row.time}
                          {isLiveGame && <span className="live-indicator-small ml-2">LIVE</span>}
                        </td>
                        <td className={`py-4 px-6 text-sm match-cell ${isLiveGame && liveGame.field === 'Field 1' ? 'is-live' : ''}`} data-label="Field 1">
                          {renderMatchWithWinner(row.field1)}
                        </td>
                        <td className={`py-4 px-6 text-sm match-cell ${isLiveGame && liveGame.field === 'Field 2' ? 'is-live' : ''}`} data-label="Field 2">
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
              <p className="phase-subtext">12:52 - 1:22 PM</p>
            </div>
          </div>
        </div>

        {/* Phase 2 - Only show if pool play is complete */}
        {poolPlayComplete && (
          <div className="mb-16">
            <div className="phase-header">
              <div className="phase-title-stack">
                <h3 className="text-sm font-mono tracking-widest">PHASE 2: BRACKETS</h3>
                <span className="phase-meta">1:22 PM - 4:52 PM</span>
              </div>
            </div>
            <div className="table-shell compact">
              <div className="schedule-table w-full max-w-5xl">
                <table className="w-full">
                  <thead>
                    <tr className="table-head-row">
                      <th className="text-left py-4 px-6 text-xs font-mono table-head-cell uppercase tracking-wider">TIME</th>
                      <th className="text-left py-4 px-6 text-xs font-mono table-head-cell uppercase tracking-wider">FIELD 1</th>
                      {showPhase2Field2 && (
                        <th className="text-left py-4 px-6 text-xs font-mono table-head-cell uppercase tracking-wider">FIELD 2</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {phase2BaseRows.map((row, i) => (
                      <tr key={i} className="table-row">
                        <td className="py-4 px-6 text-sm font-mono time-cell" data-label="Time">{row.time}</td>
                        <td className="py-4 px-6 text-sm match-cell" data-label="Field 1">{renderMatchWithWinner(row.field1)}</td>
                        {showPhase2Field2 && (
                          <td className="py-4 px-6 text-sm match-cell" data-label="Field 2">{renderMatchWithWinner(row.field2 || '')}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Finals - Only show if pool play is complete */}
        {poolPlayComplete && (
          <div>
            <div className={`grid grid-cols-1 ${showDevFinal ? 'lg:grid-cols-2' : ''} gap-6`}>
              <div className="final-match">
                <div className="text-center space-y-2">
                  <div className="final-badge">ELITE FINAL</div>
                  <h3 className="text-2xl font-mono tracking-wider final-title">FINAL</h3>
                  <p className="phase-subtext">{eliteFinal.time || 'TBD'} - {(eliteFinal.field || 'Field 1').toUpperCase()}</p>
                  <p className="text-base font-mono final-matchup">{eliteFinalMatchup}</p>
                </div>
              </div>
              {showDevFinal && (
                <div className="final-match">
                  <div className="text-center space-y-2">
                    <div className="final-badge">DEVELOPMENT FINAL</div>
                    <h3 className="text-2xl font-mono tracking-wider final-title">FINAL</h3>
                    <p className="phase-subtext">{devFinal.time || 'TBD'} - {(devFinal.field || 'Field 2').toUpperCase()}</p>
                    <p className="text-base font-mono final-matchup">{devFinalMatchup}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
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

const Bracket = ({ data, schedule }) => {
  const scheduleMatches = schedule?.championship || [];
  const eliteBracket = data?.elite || {};
  const devBracket = data?.development || {};

  const qfTimes = ['1:22 PM', '1:43 PM', '2:04 PM', '2:25 PM'];
  const sfTimes = ['2:46 PM', '3:07 PM'];
  const eliteFinalTimeFallback = '4:53 PM';
  const devFinalTimeFallback = '4:32 PM';

  const buildLabelVariants = (prefixes, label) => {
    const out = [];
    (Array.isArray(prefixes) ? prefixes : [prefixes]).filter(Boolean).forEach((prefix) => {
      out.push(`${prefix} ${label}`);
    });
    out.push(label);
    return out;
  };

  const resolveTime = (labels, fallback) => {
    const match = findUniqueMatchByLabels(scheduleMatches, labels);
    return match?.time || fallback || '';
  };

  const resolveField = (labels, time, defaultField) => {
    const match = findUniqueMatchByLabels(scheduleMatches, labels);
    if (match?.field) return match.field;
    // Try to find by time if labels don't match
    if (time) {
      const timeMatch = scheduleMatches.find(m => m.time === time);
      if (timeMatch?.field) return timeMatch.field;
    }
    return defaultField || '';
  };

  const makeBracketTimes = (prefixes, finalFallback) => ({
    getQfTime: (index) => resolveTime(buildLabelVariants(prefixes, `QF${index + 1}`), qfTimes[index]),
    getSfTime: (index) => resolveTime(buildLabelVariants(prefixes, `SF${index + 1}`), sfTimes[index]),
    getFinalTime: () => resolveTime(buildLabelVariants(prefixes, 'Final'), finalFallback),
    getQfField: (index) => {
      const time = qfTimes[index];
      return resolveField(buildLabelVariants(prefixes, `QF${index + 1}`), time, prefixes.includes('Elite') ? 'Field 1' : 'Field 2');
    },
    getSfField: (index) => {
      const time = sfTimes[index];
      return resolveField(buildLabelVariants(prefixes, `SF${index + 1}`), time, prefixes.includes('Elite') ? 'Field 1' : 'Field 2');
    },
    getFinalField: () => {
      const time = finalFallback;
      return resolveField(buildLabelVariants(prefixes, 'Final'), time, 'Field 1');
    },
    getThirdPlaceField: () => {
      const time = prefixes.includes('Elite') ? '4:32 PM' : '4:53 PM';
      return resolveField(buildLabelVariants(prefixes, '3rd Place'), time, prefixes.includes('Elite') ? 'Field 1' : 'Field 2');
    },
  });

  const eliteTimes = makeBracketTimes(['Elite'], eliteFinalTimeFallback);
  const devTimes = makeBracketTimes(['Dev', 'Development'], devFinalTimeFallback);

  const eliteQfDefaults = [
    ['Pool A #1', 'Pool B #4'],
    ['Pool A #2', 'Pool B #3'],
    ['Pool B #1', 'Pool A #4'],
    ['Pool B #2', 'Pool A #3']
  ];
  const devQfDefaults = [
    ['Pool C #1', 'Pool D #4'],
    ['Pool C #2', 'Pool D #3'],
    ['Pool D #1', 'Pool C #4'],
    ['Pool D #2', 'Pool C #3']
  ];
  const semiDefaults = [
    ['Winner QF1', 'Winner QF2'],
    ['Winner QF3', 'Winner QF4']
  ];

  const renderBracketSection = ({ title, bracket, times, qfDefaults }) => {
    const finalWinner = getBracketWinner(bracket.final?.score1, bracket.final?.score2);
    const finalScore1 = formatBracketScore(bracket.final?.score1, bracket.final?.score2);
    const finalScore2 = formatBracketScore(bracket.final?.score2, bracket.final?.score1);
    const finalTime = times.getFinalTime();
    const finalField = times.getFinalField();
    
    const thirdPlaceWinner = getBracketWinner(bracket.thirdPlace?.score1, bracket.thirdPlace?.score2);
    const thirdPlaceScore1 = formatBracketScore(bracket.thirdPlace?.score1, bracket.thirdPlace?.score2);
    const thirdPlaceScore2 = formatBracketScore(bracket.thirdPlace?.score2, bracket.thirdPlace?.score1);
    const thirdPlaceTime = resolveTime(buildLabelVariants(title.includes('ELITE') ? ['Elite'] : ['Dev', 'Development'], '3rd Place'), title.includes('ELITE') ? '4:32 PM' : '4:53 PM');
    const thirdPlaceField = times.getThirdPlaceField();

    return (
      <section>
        <div className="section-header">
          <div className="section-label">
            <span className="icon-chip" aria-label="Bracket"><Icon name="trophy" size={16} ariaLabel="Trophy icon" /></span>
            <h2 className="section-title">{title}</h2>
          </div>
        </div>
        <div className="bracket-container">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Quarterfinals */}
          <div className="space-y-6">
            <h3 className="bracket-stage-title">QUARTERFINALS</h3>
            {(bracket.quarterfinals && bracket.quarterfinals.length > 0 ? bracket.quarterfinals : qfDefaults).map((match, i) => {
              const winner = getBracketWinner(match.score1, match.score2);
              const score1 = formatBracketScore(match.score1, match.score2);
              const score2 = formatBracketScore(match.score2, match.score1);
              const timeLabel = times.getQfTime(i);
              return (
                <div key={i} className="bracket-match">
                  {timeLabel && <div className="match-time">{timeLabel}</div>}
                  {times.getQfField(i) && <div className="match-field">{times.getQfField(i)}</div>}
                  <div className={`match-team ${winner === 'team1' ? 'winner' : winner ? 'loser' : ''}`}>
                    <span className="text-sm">{match.team1 || match[0]}</span>
                    <span className="match-score">{score1}</span>
                  </div>
                  <div className={`match-team ${winner === 'team2' ? 'winner' : winner ? 'loser' : ''}`}>
                    <span className="text-sm">{match.team2 || match[1]}</span>
                    <span className="match-score">{score2}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Semifinals */}
          <div className="space-y-6">
            <h3 className="bracket-stage-title">SEMIFINALS</h3>
            {(bracket.semifinals && bracket.semifinals.length > 0 ? bracket.semifinals : semiDefaults).map((match, i) => {
              const winner = getBracketWinner(match.score1, match.score2);
              const score1 = formatBracketScore(match.score1, match.score2);
              const score2 = formatBracketScore(match.score2, match.score1);
              const timeLabel = times.getSfTime(i);
              return (
                <div key={i} className="bracket-match mt-20">
                  {timeLabel && <div className="match-time">{timeLabel}</div>}
                  {times.getSfField(i) && <div className="match-field">{times.getSfField(i)}</div>}
                  <div className={`match-team ${winner === 'team1' ? 'winner' : winner ? 'loser' : ''}`}>
                    <span className="text-sm">{match.team1 || match[0]}</span>
                    <span className="match-score">{score1}</span>
                  </div>
                  <div className={`match-team ${winner === 'team2' ? 'winner' : winner ? 'loser' : ''}`}>
                    <span className="text-sm">{match.team2 || match[1]}</span>
                    <span className="match-score">{score2}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Final */}
          <div className="space-y-6">
            <h3 className="bracket-stage-title">FINAL</h3>
            <div className="bracket-final mt-32">
              {finalTime && <div className="match-time">{finalTime}</div>}
              {finalField && <div className="match-field">{finalField}</div>}
              <div className="final-trophy">🏆</div>
              <div className={`match-team ${finalWinner === 'team1' ? 'winner' : finalWinner ? 'loser' : ''}`}>
                <span className="text-sm">{bracket.final?.team1 || 'Winner SF1'}</span>
                <span className="match-score">{finalScore1}</span>
              </div>
              <div className={`match-team ${finalWinner === 'team2' ? 'winner' : finalWinner ? 'loser' : ''}`}>
                <span className="text-sm">{bracket.final?.team2 || 'Winner SF2'}</span>
                <span className="match-score">{finalScore2}</span>
              </div>
            </div>
            
            {/* 3rd Place */}
            <div className="mt-12">
              <h3 className="bracket-stage-title">3RD PLACE</h3>
              <div className="bracket-match mt-6">
                {thirdPlaceTime && <div className="match-time">{thirdPlaceTime}</div>}
                {thirdPlaceField && <div className="match-field">{thirdPlaceField}</div>}
                <div className={`match-team ${thirdPlaceWinner === 'team1' ? 'winner' : thirdPlaceWinner ? 'loser' : ''}`}>
                  <span className="text-sm">{bracket.thirdPlace?.team1 || 'Loser SF1'}</span>
                  <span className="match-score">{thirdPlaceScore1}</span>
                </div>
                <div className={`match-team ${thirdPlaceWinner === 'team2' ? 'winner' : thirdPlaceWinner ? 'loser' : ''}`}>
                  <span className="text-sm">{bracket.thirdPlace?.team2 || 'Loser SF2'}</span>
                  <span className="match-score">{thirdPlaceScore2}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
    );
  };


  return (
    <div className="space-y-16">
      {renderBracketSection({
        title: 'ELITE BRACKET',
        bracket: eliteBracket,
        times: eliteTimes,
        qfDefaults: eliteQfDefaults,
      })}

      {renderBracketSection({
        title: 'DEVELOPMENT BRACKET',
        bracket: devBracket,
        times: devTimes,
        qfDefaults: devQfDefaults,
      })}
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
                {(data.elite?.[pool] && data.elite[pool].length > 0 ? data.elite[pool] : ['1', '2', '3', '4'].map(n => `${pool}${n}`)).map((team, i) => (
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
                {(data.development?.[pool] && data.development[pool].length > 0 ? data.development[pool] : ['1', '2', '3', '4'].map(n => `${pool}${n}`)).map((team, i) => (
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
