import { useState, useEffect, useRef, useCallback, useMemo } from "react";

const POOL_TEAMS = [
  { team: "Angels",       owner: "JARED-WED"   },
  { team: "Astros",       owner: "BORG"         },
  { team: "Blue Jays",    owner: "JOE-WED"     },
  { team: "Braves",       owner: "DAN A."       },
  { team: "Brewers",      owner: "ANDREW SR"   },
  { team: "Cardinals",    owner: "K-YOUNG-WED"  },
  { team: "Cubs",         owner: "SCOTT L."    },
  { team: "Diamondbacks", owner: "K-YOUNG-WED"  },
  { team: "Dodgers",      owner: "GARY B"      },
  { team: "Giants",       owner: "FRANK-WED"   },
  { team: "Guardians",    owner: "MATT-WED"    },
  { team: "Mariners",     owner: "BORG"         },
  { team: "Marlins",      owner: "APRIL"       },
  { team: "Mets",         owner: "RODNEY"      },
  { team: "Nationals",    owner: "ROB-WED"     },
  { team: "Athletics",    owner: "MATT F"      },
  { team: "Orioles",      owner: "MATT-WED"    },
  { team: "Padres",       owner: "TJ"          },
  { team: "Phillies",     owner: "MARC"        },
  { team: "Pirates",      owner: "JARED-WED"   },
  { team: "Rangers",      owner: "MIKE C"      },
  { team: "Red Sox",      owner: "FRANKIE"     },
  { team: "Reds",         owner: "JOE-WED"     },
  { team: "Rockies",      owner: "ROB-WED"     },
  { team: "Royals",       owner: "MURPH/RICK"  },
  { team: "Rays",         owner: "BORG"         },
  { team: "Tigers",       owner: "MIKE C"      },
  { team: "Twins",        owner: "PETER"       },
  { team: "White Sox",    owner: "ADAM-WED"    },
  { team: "Yankees",      owner: "MURPH/RICK"  },
];

const INITIAL_SCORES = {};

const ALL_RUNS  = Array.from({ length: 14 }, (_, i) => i);
const POLL_MS   = 60_000;

const TEAM_COLORS = {
  Angels: "#BA0021", Astros: "#EB6E1F", "Blue Jays": "#134A8E",
  Braves: "#CE1141", Brewers: "#FFC52F", Cardinals: "#C41E3A",
  Cubs: "#0E3386", Diamondbacks: "#A71930", Dodgers: "#005A9C",
  Giants: "#FD5A1E", Guardians: "#00385D", Mariners: "#0C2C56",
  Marlins: "#00A3E0", Mets: "#002D72", Nationals: "#AB0003",
  Athletics: "#003831", Orioles: "#DF4601", Padres: "#7B3F00",
  Phillies: "#E81828", Pirates: "#27251F", Rangers: "#003278",
  "Red Sox": "#BD3039", Reds: "#C6011F", Rockies: "#33006F",
  Royals: "#004687", Rays: "#092C5C", Tigers: "#0C2340",
  Twins: "#002B5C", "White Sox": "#555555", Yankees: "#003087",
};

// ── Run frequency: empirical prob of scoring exactly N runs in a game ──
// Source: Fangraphs/Retrosheet historical data, ~4.5 R/G era (2000-2024)
// Most common: 3 runs (13.4%), then 4 (12.9%), then 2 (12.1%)
// Rarest in pool: 13 (~0.4%) → expect ~250 games to hit it
const RUN_FREQ = {
  0: 0.073, 1: 0.103, 2: 0.122, 3: 0.134, 4: 0.129,
  5: 0.108, 6: 0.083, 7: 0.062, 8: 0.044, 9: 0.029,
  10: 0.018, 11: 0.011, 12: 0.006, 13: 0.004,
};

const EXP_GAMES = {}; // expected games to first hit each run value
ALL_RUNS.forEach(r => { EXP_GAMES[r] = Math.round(1 / RUN_FREQ[r]); });

// ── Deterministic win probability ────────────────────────────────────
// For each team, P(complete within G games) = product over missing values of
// (1 - (1-p)^G)  — the CDF of the max of independent geometric RVs.
// Win probability = integral over G of:
//   P(team completes on game G) * P(every other team NOT complete by game G)
// We sum this over G = 1..GAMES_LEFT discretely. Exact, no randomness.
const GAMES_LEFT = 145;

function pCompleteBy(missing, G) {
  // Probability ALL missing values have been hit at least once in G games
  let p = 1;
  for (const r of missing) {
    const pHit = RUN_FREQ[r] ?? 0.004;
    p *= (1 - Math.pow(1 - pHit, G));
  }
  return p;
}


// ── Expected games to complete ────────────────────────────────────────
// E[max of independent geometrics] via the formula:
// E[max] = sum_{G=0}^{inf} P(max > G) = sum_{G=0}^{inf} (1 - P(all done by G))
// We truncate at 500 games (well beyond any realistic season).
function expectedGamesToComplete(missing) {
  if (missing.length === 0) return 0;
  let expected = 0;
  // Sum P(not all done by G) for G = 0, 1, 2, ...
  // = sum (1 - product_r (1-(1-p_r)^G))
  // Truncate when contribution becomes negligible
  for (let G = 0; G < 600; G++) {
    const pDone = pCompleteBy(missing, G);
    expected += (1 - pDone);
    if (G > 50 && (1 - pDone) < 1e-6) break;
  }
  return Math.round(expected);
}


// ── Pool-level: expected games until SOMEONE wins ─────────────────────
// P(pool has a winner by game G) = 1 - P(NO team complete by G)
//   = 1 - product over all teams of (1 - P(team complete by G))
// E[days to winner] = sum_{G=0}^{inf} P(no winner yet by G)
function expectedDaysToWinner(scoresMap) {
  const allMissing = POOL_TEAMS.map(({ team }) => {
    const hit = scoresMap[team] || new Set();
    return ALL_RUNS.filter(r => !hit.has(r));
  });

  // Check if already won
  if (allMissing.some(m => m.length === 0)) return 0;

  let expected = 0;
  for (let G = 0; G < 600; G++) {
    // P(no team done by G) = product of (1 - P(team done by G))
    let pNoWinner = 1;
    for (const missing of allMissing) {
      pNoWinner *= (1 - pCompleteBy(missing, G));
    }
    expected += pNoWinner;
    if (G > 30 && pNoWinner < 1e-6) break;
  }
  return Math.round(expected);
}

function calcWinProbs(scoresMap) {
  // Pre-compute missing list per team
  const teamMissing = {};
  for (const { team } of POOL_TEAMS) {
    const hit = scoresMap[team] || new Set();
    teamMissing[team] = ALL_RUNS.filter(r => !hit.has(r));
  }

  const winProb = {};
  POOL_TEAMS.forEach(({ team }) => { winProb[team] = 0; });

  // For already-complete teams
  const doneTeams = POOL_TEAMS.filter(({ team }) => teamMissing[team].length === 0);
  if (doneTeams.length > 0) {
    // Split evenly among done teams (tiebreak — first to finish wins, but we don't track order)
    const share = 100 / doneTeams.length;
    doneTeams.forEach(({ team }) => { winProb[team] = Math.round(share * 10) / 10; });
    return winProb;
  }

  // Discrete sum: for each game G, compute P(team i finishes exactly on G AND leads all others)
  // P(finish on exactly G) = P(complete by G) - P(complete by G-1)
  // P(team wins on game G) = P(i finishes on G) * P(all others NOT done by G-1)
  // We accumulate over G = 1..GAMES_LEFT
  const prevComplete = {};
  POOL_TEAMS.forEach(({ team }) => { prevComplete[team] = 0; });

  for (let G = 1; G <= GAMES_LEFT; G++) {
    const curComplete = {};
    for (const { team } of POOL_TEAMS) {
      curComplete[team] = pCompleteBy(teamMissing[team], G);
    }

    for (const { team } of POOL_TEAMS) {
      // P(this team finishes on exactly game G)
      const pFinishOnG = curComplete[team] - prevComplete[team];
      if (pFinishOnG < 1e-10) continue;

      // P(all other teams not yet done by game G-1)
      let pOthersNotDone = 1;
      for (const { team: other } of POOL_TEAMS) {
        if (other === team) continue;
        pOthersNotDone *= (1 - prevComplete[other]);
      }

      winProb[team] += pFinishOnG * pOthersNotDone;
    }

    POOL_TEAMS.forEach(({ team }) => { prevComplete[team] = curComplete[team]; });
  }

  // Normalize to percentages, round to 1 decimal
  const total = Object.values(winProb).reduce((a, b) => a + b, 0);
  const out = {};
  POOL_TEAMS.forEach(({ team }) => {
    out[team] = total > 0 ? Math.round((winProb[team] / total) * 1000) / 10 : 0;
  });
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────
const allOwners = [...new Set(POOL_TEAMS.map(t => t.owner))].sort();
const ownerHues = {};
allOwners.forEach((o, i) => { ownerHues[o] = Math.round((i / allOwners.length) * 360); });

function buildMap(raw) {
  const m = {};
  POOL_TEAMS.forEach(({ team }) => { m[team] = new Set(raw[team] || []); });
  return m;
}

function resolveTeam(name) {
  if (!name) return null;
  const l = name.toLowerCase();
  return POOL_TEAMS.find(t => l.includes(t.team.toLowerCase()) || t.team.toLowerCase().includes(l))?.team ?? null;
}

function isGameHours() {
  const h = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);
  return h >= 12 || h <= 1;
}

function etToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// All dates from pool start (April 17) through today in ET
// Use string arithmetic to avoid timezone shifting issues with Date parsing
function poolDates() {
  const POOL_START = "2026-04-17";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const dates = [];
  // Walk day by day using UTC dates (plain YYYY-MM-DD strings, no timezone shift)
  let cur = new Date(POOL_START + "T12:00:00Z"); // noon UTC = safe from any TZ shift
  const end = new Date(today     + "T12:00:00Z");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

async function fetchMLB(date) {
  // In artifact: try the MLB API directly (will likely fail due to sandbox restrictions)
  // In Vercel deployment: change this to `/api/scores?date=${date}`
  const res = await fetch(`/api/scores?date=${date}`);
  if (!res.ok) { const b = await res.json().catch(()=>({})); throw new Error(b.error ?? `Proxy ${res.status}`); }
  const data = await res.json();
  // Proxy returns {finals, live, totalGames} with raw MLB team names - resolve to our names
  const finals = {}, live = {};
  Object.entries(data.finals ?? {}).forEach(([name, score]) => {
    const team = resolveTeam(name); if (team) finals[team] = score;
  });
  Object.entries(data.live ?? {}).forEach(([name, info]) => {
    const team = resolveTeam(name); if (team) live[team] = info;
  });
  return { finals, live, totalGames: data.totalGames ?? 0 };
}

// ── Win prob display helpers ──────────────────────────────────────────
function probBg(p)   { return p <= 0 ? "#1e293b" : p < 3 ? "#2d1515" : p < 8 ? "#2d1f0a" : p < 15 ? "#1a2d0a" : "#0d2d12"; }
function probFg(p)   { return p <= 0 ? "#334155" : p < 3 ? "#fca5a5" : p < 8 ? "#fcd34d" : p < 15 ? "#bef264" : "#86efac"; }
function probLabel(p){ return p <= 0 ? "<0.1%" : `${p}%`; }

function WinBadge({ prob, large }) {
  const bg = probBg(prob), fg = probFg(prob);
  return (
    <span style={{
      display: "inline-block", background: bg, color: fg,
      padding: large ? "3px 9px" : "2px 6px",
      borderRadius: 4, fontSize: large ? 12 : 11,
      fontWeight: 700, whiteSpace: "nowrap",
      border: `1px solid ${fg}22`,
      minWidth: large ? 52 : 44, textAlign: "center",
    }}>
      {large ? "🎯 " : ""}{probLabel(prob)}
    </span>
  );
}

// ── App ───────────────────────────────────────────────────────────────
export default function App() {
  const [scores,    setScores]    = useState(() => buildMap(INITIAL_SCORES));
  const [liveNow,   setLiveNow]   = useState({});
  const [tab,       setTab]       = useState("leaderboard");
  const [filter,    setFilter]    = useState("ALL");
  const [mTeam,     setMTeam]     = useState(POOL_TEAMS[0].team);
  const [mRun,      setMRun]      = useState("");
  const [toast,     setToast]     = useState(null);
  const [autoOn,    setAutoOn]    = useState(true);
  const [fetching,  setFetching]  = useState(false);
  const [lastFetch, setLastFetch] = useState(null);
  const [pollErr,   setPollErr]   = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [flash,     setFlash]     = useState(new Set());

  const timerRef = useRef(null);
  const cdRef    = useRef(null);
  const nextAt   = useRef(null);

  const showToast = useCallback((msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const doFetch = useCallback(async (silent = false) => {
    setFetching(true); setPollErr(null);
    try {
      const { finals, live, totalGames } = await fetchMLB(etToday());
      setLiveNow(live);
      const newHits = [];
      setScores(prev => {
        const next = {};
        POOL_TEAMS.forEach(({ team }) => { next[team] = new Set(prev[team]); });
        Object.entries(finals).forEach(([team, score]) => {
          if (next[team] && score <= 13 && !next[team].has(score)) { next[team].add(score); newHits.push({ team, score }); }
        });
        return next;
      });
      setLastFetch(new Date());
      if (newHits.length > 0) {
        setFlash(new Set(newHits.map(h => h.team)));
        setTimeout(() => setFlash(new Set()), 5000);
        showToast(`🆕 ${newHits.map(h => `${h.team} → ${h.score}`).join(" · ")}`, "ok");
      } else if (!silent) {
        const lc = Object.keys(live).length, fc = Object.keys(finals).length;
        showToast(totalGames === 0 ? "No games today" : `${fc} finals · ${lc} live · no new scores`, "info");
      }
    } catch (e) {
      setPollErr(e.message);
      if (!silent) showToast(`⚠ ${e.message} — use Manual Entry to add scores`, "err");
    } finally { setFetching(false); }
  }, [showToast]);

  const schedule = useCallback(() => {
    clearTimeout(timerRef.current); clearInterval(cdRef.current);
    nextAt.current = Date.now() + POLL_MS;
    setCountdown(Math.round(POLL_MS / 1000));
    cdRef.current  = setInterval(() => setCountdown(Math.max(0, Math.round((nextAt.current - Date.now()) / 1000))), 1000);
    timerRef.current = setTimeout(async () => {
      clearInterval(cdRef.current);
      if (isGameHours()) await doFetch(true);
      schedule();
    }, POLL_MS);
  }, [doFetch]);

  // On startup: fetch all dates since pool start to catch up on missed days
  useEffect(() => {
    const catchUp = async () => {
      setFetching(true);
      const dates = poolDates();
      // Fetch all dates in parallel
      const results = await Promise.allSettled(dates.map(d => fetchMLB(d)));
      const allFinals = {};
      results.forEach(r => {
        if (r.status === "fulfilled") {
          Object.entries(r.value.finals).forEach(([team, score]) => {
            if (!allFinals[team]) allFinals[team] = new Set();
            if (score <= 13) allFinals[team].add(score);
          });
          // Set live from today's result (last date)
          if (r === results[results.length - 1]) setLiveNow(r.value.live);
        }
      });
      setScores(prev => {
        const next = {};
        POOL_TEAMS.forEach(({ team }) => {
          next[team] = new Set([...(prev[team] || []), ...(allFinals[team] || [])]);
        });
        return next;
      });
      setLastFetch(new Date());
      setFetching(false);
    };
    catchUp().catch(() => setFetching(false));
    schedule();
    return () => { clearTimeout(timerRef.current); clearInterval(cdRef.current); };
  }, []); // eslint-disable-line

  const toggleAuto = () => {
    if (autoOn) { clearTimeout(timerRef.current); clearInterval(cdRef.current); setCountdown(null); setAutoOn(false); }
    else { setAutoOn(true); schedule(); }
  };

  const addManual = () => {
    const s = parseInt(mRun);
    if (isNaN(s) || s < 0 || s > 13) { showToast("Must be 0–13", "err"); return; }
    setScores(prev => ({ ...prev, [mTeam]: new Set([...prev[mTeam], s]) }));
    showToast(`✓ ${mTeam} scored ${s}`); setMRun("");
  };

  const removeScore = (team, run) =>
    setScores(prev => { const n = new Set(prev[team]); n.delete(run); return { ...prev, [team]: n }; });

  // ── Derived ───────────────────────────────────────────────────────
  const winProbs = useMemo(() => calcWinProbs(scores), [scores]);

  const teamStats = useMemo(() => {
    return POOL_TEAMS.map(({ team, owner }) => {
      const hit     = scores[team] || new Set();
      const missing = ALL_RUNS.filter(r => !hit.has(r));
      return {
        team, owner, hit, missing,
        pct:     Math.round((hit.size / 14) * 100),
        done:    missing.length === 0,
        winProb:  winProbs[team] ?? 0,
        expGames: expectedGamesToComplete(missing),
      };
    }).sort((a, b) => {
      if (a.done !== b.done) return a.done ? -1 : 1;
      return b.winProb - a.winProb || b.hit.size - a.hit.size;
    });
  }, [scores, winProbs]);

  const runCoverage    = ALL_RUNS.map(r => ({ run: r, teams: POOL_TEAMS.filter(({ team }) => scores[team]?.has(r)) }));
  const daysToWinner   = useMemo(() => expectedDaysToWinner(scores), [scores]);
  const winner       = teamStats.find(t => t.done);
  const liveList     = Object.entries(liveNow);
  const displayTeams = filter === "ALL" ? POOL_TEAMS : POOL_TEAMS.filter(t => t.owner === filter);
  const cdPct        = (POLL_MS / 1000 - (countdown ?? 0)) / (POLL_MS / 1000) * 100;
  const fmtTime      = d => d?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }) ?? "—";
  const totalWinProb = Object.values(winProbs).reduce((a, b) => a + b, 0);

  return (
    <div style={S.wrap}>

      {/* HEADER */}
      <header style={S.hdr}>
        <div style={S.hdrL}>
          <span style={{ fontSize: 28 }}>⚾</span>
          <div>
            <div style={S.ttl}>13-Run Pool</div>
            <div style={S.sub}>MLB 2026 · Started April 17{daysToWinner > 0 ? ` · ${daysToWinner}g est. to win` : ""}</div>
          </div>
        </div>
        <div style={S.hdrR}>
          {winner && <div style={S.winBanner}>🏆 {winner.owner} · {winner.team}</div>}
          {liveList.length > 0 && <div style={S.livePill}><span style={S.liveDot}/>LIVE {liveList.length}</div>}
        </div>
      </header>

      {/* POLL BAR */}
      <div style={S.pollBar}>
        <div style={S.pollL}>
          <button style={{ ...S.autoBtn, ...(autoOn ? S.autoBtnOn : {}) }} onClick={toggleAuto}>
            {autoOn ? "⏸ Auto" : "▶ Auto"}
          </button>
          <button style={S.syncBtn} onClick={() => { doFetch(false); if (autoOn) schedule(); }} disabled={fetching}>
            <span style={fetching ? S.spin : {}}>{fetching ? "⟳" : "⟳"}</span>{fetching ? " …" : " Sync"}
          </button>
          {autoOn && countdown !== null && (
            <div style={S.cdWrap}>
              <span style={{ color: "#475569", fontSize: 11 }}>Next: <b style={{ color: "#60a5fa" }}>{countdown}s</b></span>
              <div style={S.cdTrack}><div style={{ ...S.cdFill, width: `${cdPct}%` }} /></div>
            </div>
          )}
        </div>
        <div style={S.pollR}>
          {pollErr && <span style={{ color: "#f87171", fontSize: 10 }}>⚠ {pollErr}</span>}
          {lastFetch && <span style={{ color: "#334155", fontSize: 10 }}>↻ {fmtTime(lastFetch)}</span>}
        </div>
      </div>

      {/* LIVE TICKER */}
      {liveList.length > 0 && (
        <div style={S.ticker}>
          <span style={S.tickLbl}>LIVE</span>
          {liveList.map(([team, g]) => (
            <span key={team} style={S.tickItem}>
              <span style={{ ...S.dot, background: TEAM_COLORS[team] || "#888" }} />
              <b>{team}</b> {g.score}
              <span style={{ color: "#64748b", fontSize: 10 }}> {g.half?.slice(0,3)}{g.inning}</span>
            </span>
          ))}
        </div>
      )}

      {/* TABS */}
      <div style={S.tabRow}>
        {[["leaderboard","🏅 Leaderboard"],["grid","📊 Grid"],["manual","✏️ Manual"]].map(([id, lbl]) => (
          <button key={id} style={{ ...S.tabBtn, ...(tab === id ? S.tabOn : {}) }} onClick={() => setTab(id)}>{lbl}</button>
        ))}
      </div>

      {/* ══ LEADERBOARD ══ */}
      {tab === "leaderboard" && (
        <div style={S.body}>
          <div style={S.modelNote}>
            📊 <strong>Win %</strong> uses exact math from historical MLB run frequencies. Scores of 3–5 are most common (~13% each). Scores of 0, 11, 12, 13 are rare. Header shows estimated games until the pool has a winner across all 30 teams.
          </div>
          <div style={S.cardGrid}>
            {teamStats.map((t, idx) => {
              const hue     = ownerHues[t.owner];
              const lg      = liveNow[t.team];
              const isFlash = flash.has(t.team);
              return (
                <div key={t.team} style={{
                  ...S.
