import { useState, useEffect, useRef, useCallback } from "react";

// ── Pool roster ───────────────────────────────────────────────────────
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

// Pre-seeded from the April 17 sheet
const INITIAL_SCORES = {
  Angels: [7], Astros: [4], "Blue Jays": [3], Braves: [9],
  Brewers: [7], Cardinals: [9], Cubs: [11], Diamondbacks: [6],
  Dodgers: [7], Giants: [11], Guardians: [4], Mariners: [0],
  Marlins: [5], Mets: [4], Nationals: [5], Athletics: [2],
  Orioles: [6], Padres: [0], Phillies: [0], Pirates: [5],
  Rangers: [5], "Red Sox": [1], Reds: [3], Rockies: [1],
  Royals: [3], Rays: [1], Tigers: [0], Twins: [1],
  "White Sox": [9], Yankees: [4],
};

const ALL_RUNS = Array.from({ length: 14 }, (_, i) => i); // 0–13
const POLL_MS  = 60_000; // 60 seconds

const TEAM_COLORS = {
  Angels: "#BA0021", Astros: "#EB6E1F", "Blue Jays": "#134A8E",
  Braves: "#CE1141", Brewers: "#FFC52F", Cardinals: "#C41E3A",
  Cubs: "#0E3386", Diamondbacks: "#A71930", Dodgers: "#005A9C",
  Giants: "#FD5A1E", Guardians: "#00385D", Mariners: "#0C2C56",
  Marlins: "#00A3E0", Mets: "#002D72", Nationals: "#AB0003",
  Athletics: "#003831", Orioles: "#DF4601", Padres: "#2F241D",
  Phillies: "#E81828", Pirates: "#27251F", Rangers: "#003278",
  "Red Sox": "#BD3039", Reds: "#C6011F", Rockies: "#33006F",
  Royals: "#004687", Rays: "#092C5C", Tigers: "#0C2340",
  Twins: "#002B5C", "White Sox": "#27251F", Yankees: "#003087",
};

const allOwners = [...new Set(POOL_TEAMS.map(t => t.owner))].sort();
const ownerHues = {};
allOwners.forEach((o, i) => { ownerHues[o] = Math.round((i / allOwners.length) * 360); });

// ── Helpers ───────────────────────────────────────────────────────────
function buildScoreMap(raw) {
  const m = {};
  POOL_TEAMS.forEach(({ team }) => { m[team] = new Set(raw[team] || []); });
  return m;
}

// Match MLB Stats API team name → our internal short name
function resolveTeam(apiName) {
  if (!apiName) return null;
  const lower = apiName.toLowerCase().trim();
  return POOL_TEAMS.find(t =>
    lower.includes(t.team.toLowerCase()) ||
    t.team.toLowerCase().includes(lower)
  )?.team ?? null;
}

function isGameHours() {
  const et = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false });
  const h = parseInt(et, 10);
  return h >= 12 || h <= 1;
}

function etToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ── THE KEY CHANGE: fetch via our Vercel proxy instead of MLB directly ──
async function fetchMLB(dateStr) {
  const url = `/api/scores?date=${dateStr}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Proxy returned ${res.status}`);
  }
  const data = await res.json();

  // Proxy already separated finals/live with raw MLB names — resolve to our names
  const finals = {};
  const live   = {};
  Object.entries(data.finals ?? {}).forEach(([name, score]) => {
    const team = resolveTeam(name);
    if (team) finals[team] = score;
  });
  Object.entries(data.live ?? {}).forEach(([name, info]) => {
    const team = resolveTeam(name);
    if (team) live[team] = info;
  });

  return { finals, live, totalGames: data.totalGames ?? 0 };
}

// ── App ───────────────────────────────────────────────────────────────
export default function App() {
  const [scores,     setScores]     = useState(() => buildScoreMap(INITIAL_SCORES));
  const [liveNow,    setLiveNow]    = useState({});
  const [tab,        setTab]        = useState("grid");
  const [ownerFilter,setFilter]     = useState("ALL");
  const [manualTeam, setMTeam]      = useState(POOL_TEAMS[0].team);
  const [manualRun,  setMRun]       = useState("");
  const [toast,      setToast]      = useState(null);
  const [autoOn,     setAutoOn]     = useState(true);
  const [fetching,   setFetching]   = useState(false);
  const [lastFetch,  setLastFetch]  = useState(null);
  const [pollErr,    setPollErr]    = useState(null);
  const [countdown,  setCountdown]  = useState(null);
  const [flashTeams, setFlash]      = useState(new Set());

  const timerRef = useRef(null);
  const cdRef    = useRef(null);
  const nextAt   = useRef(null);

  const toast$ = useCallback((msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  }, []);

  // ── Fetch & merge ─────────────────────────────────────────────────
  const doFetch = useCallback(async (silent = false) => {
    setFetching(true);
    setPollErr(null);
    try {
      const { finals, live, totalGames } = await fetchMLB(etToday());
      setLiveNow(live);

      const newlyHit = [];
      setScores(prev => {
        const next = {};
        POOL_TEAMS.forEach(({ team }) => { next[team] = new Set(prev[team]); });
        Object.entries(finals).forEach(([team, score]) => {
          if (next[team] && !next[team].has(score)) {
            next[team].add(score);
            newlyHit.push({ team, score });
          }
        });
        return next;
      });

      setLastFetch(new Date());

      if (newlyHit.length > 0) {
        const names = new Set(newlyHit.map(h => h.team));
        setFlash(names);
        setTimeout(() => setFlash(new Set()), 6000);
        toast$(`🆕 ${newlyHit.map(h => `${h.team} → ${h.score}`).join(" · ")}`, "ok");
      } else if (!silent) {
        const lc = Object.keys(live).length;
        const fc = Object.keys(finals).length;
        toast$(
          totalGames === 0 ? "No games scheduled today" :
          `${fc} final${fc !== 1 ? "s" : ""} · ${lc} live · no new pool scores`,
          "info"
        );
      }
    } catch (e) {
      setPollErr(e.message);
      if (!silent) toast$(`⚠ ${e.message}`, "err");
    } finally {
      setFetching(false);
    }
  }, [toast$]);

  // ── Scheduler ────────────────────────────────────────────────────
  const schedule = useCallback(() => {
    clearTimeout(timerRef.current);
    clearInterval(cdRef.current);
    nextAt.current = Date.now() + POLL_MS;
    setCountdown(Math.round(POLL_MS / 1000));

    cdRef.current = setInterval(() => {
      setCountdown(Math.max(0, Math.round((nextAt.current - Date.now()) / 1000)));
    }, 1000);

    timerRef.current = setTimeout(async () => {
      clearInterval(cdRef.current);
      if (isGameHours()) await doFetch(true);
      schedule();
    }, POLL_MS);
  }, [doFetch]);

  useEffect(() => {
    doFetch(true);
    schedule();
    return () => { clearTimeout(timerRef.current); clearInterval(cdRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAuto = () => {
    if (autoOn) {
      clearTimeout(timerRef.current); clearInterval(cdRef.current);
      setCountdown(null); setAutoOn(false);
    } else {
      setAutoOn(true); schedule();
    }
  };

  const syncNow = () => { doFetch(false); if (autoOn) schedule(); };

  const addManual = () => {
    const s = parseInt(manualRun);
    if (isNaN(s) || s < 0 || s > 13) { toast$("Must be 0–13", "err"); return; }
    setScores(prev => ({ ...prev, [manualTeam]: new Set([...prev[manualTeam], s]) }));
    toast$(`✓ ${manualTeam} +${s}`);
    setMRun("");
  };

  const removeScore = (team, run) =>
    setScores(prev => { const n = new Set(prev[team]); n.delete(run); return { ...prev, [team]: n }; });

  // ── Derived ──────────────────────────────────────────────────────
  const runCoverage = ALL_RUNS.map(r => ({
    run: r, teams: POOL_TEAMS.filter(({ team }) => scores[team]?.has(r)),
  }));

  const teamStats = POOL_TEAMS.map(({ team, owner }) => {
    const hit     = scores[team] || new Set();
    const missing = ALL_RUNS.filter(r => !hit.has(r));
    return { team, owner, hit, missing, pct: Math.round((hit.size / 14) * 100), done: missing.length === 0 };
  }).sort((a, b) => b.hit.size - a.hit.size || a.missing.length - b.missing.length);

  const winner      = teamStats.find(t => t.done);
  const liveList    = Object.entries(liveNow);
  const displayTeams = ownerFilter === "ALL" ? POOL_TEAMS : POOL_TEAMS.filter(t => t.owner === ownerFilter);
  const fmtTime     = d => d?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }) ?? "—";
  const pct         = (POLL_MS / 1000 - (countdown ?? 0)) / (POLL_MS / 1000) * 100;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div style={css.wrap}>

      {/* HEADER */}
      <header style={css.hdr}>
        <div style={css.hdrL}>
          <span style={{ fontSize: 30 }}>⚾</span>
          <div>
            <div style={css.ttl}>13-Run Pool</div>
            <div style={css.sub}>MLB 2026 · Started April 17</div>
          </div>
        </div>
        <div style={css.hdrR}>
          {winner && <div style={css.winBadge}>🏆 {winner.owner} wins with {winner.team}!</div>}
          {liveList.length > 0 && (
            <div style={css.liveBadge}>
              <span style={css.liveDot} />
              {liveList.length} LIVE
            </div>
          )}
        </div>
      </header>

      {/* POLL CONTROLS */}
      <div style={css.pollBar}>
        <div style={css.pollL}>
          <button style={{ ...css.autoBtn, ...(autoOn ? css.autoBtnOn : {}) }} onClick={toggleAuto}>
            {autoOn ? "⏸ Auto ON" : "▶ Auto OFF"}
          </button>
          <button style={css.syncBtn} onClick={syncNow} disabled={fetching}>
            <span style={fetching ? css.spin : {}}>{fetching ? "⟳" : "⟳"}</span>
            {fetching ? " Fetching…" : " Sync Now"}
          </button>
          {autoOn && countdown !== null && (
            <div style={css.cdWrap}>
              <span style={css.cdLabel}>Next: <strong style={{ color: "#60a5fa" }}>{countdown}s</strong></span>
              <div style={css.cdTrack}><div style={{ ...css.cdFill, width: `${pct}%` }} /></div>
            </div>
          )}
          {!isGameHours() && autoOn && (
            <span style={css.sleepNote}>💤 Outside game hours — polling paused</span>
          )}
        </div>
        <div style={css.pollR}>
          {pollErr && <span style={{ color: "#f87171", fontSize: 11 }}>⚠ {pollErr}</span>}
          {lastFetch && <span style={{ color: "#334155", fontSize: 11 }}>Updated {fmtTime(lastFetch)}</span>}
        </div>
      </div>

      {/* LIVE TICKER */}
      {liveList.length > 0 && (
        <div style={css.ticker}>
          <span style={css.tickHd}>LIVE</span>
          {liveList.map(([team, g]) => (
            <span key={team} style={css.tickItem}>
              <span style={{ ...css.dot, background: TEAM_COLORS[team] || "#888" }} />
              <b>{team}</b>&nbsp;{g.score}
              <span style={{ color: "#64748b", fontSize: 10 }}> {g.half?.slice(0,3)}{g.inning}</span>
            </span>
          ))}
        </div>
      )}

      {/* COVERAGE BAR */}
      <div style={css.covBar}>
        {ALL_RUNS.map(r => {
          const ok = runCoverage[r].teams.length > 0;
          return (
            <div key={r}
              style={{ ...css.covPill, background: ok ? "#166534" : "#1e293b", border: `1px solid ${ok ? "#22c55e" : "#334155"}` }}
              title={ok ? runCoverage[r].teams.map(t => `${t.team} (${t.owner})`).join(", ") : "Not yet hit"}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>{r}</span>
              {ok && <span style={{ fontSize: 8, color: "#86efac" }}>✓</span>}
            </div>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#475569" }}>
          {runCoverage.filter(r => r.teams.length > 0).length}/14 covered
        </span>
      </div>

      {/* TABS */}
      <div style={css.tabRow}>
        {[["grid","📊 Grid"],["leaderboard","🏅 Leaderboard"],["manual","✏️ Manual"]].map(([id, lbl]) => (
          <button key={id} style={{ ...css.tabBtn, ...(tab === id ? css.tabOn : {}) }} onClick={() => setTab(id)}>{lbl}</button>
        ))}
      </div>

      {/* ═══ GRID ═══ */}
      {tab === "grid" && (
        <div style={css.body}>
          <div style={css.filterRow}>
            <span style={{ fontSize: 11, color: "#475569" }}>Owner:</span>
            {["ALL", ...allOwners].map(o => (
              <button key={o} style={{ ...css.chip, ...(ownerFilter === o ? css.chipOn : {}) }}
                onClick={() => setFilter(o)}>{o}</button>
            ))}
          </div>
          <div style={css.tblWrap}>
            <table style={css.tbl}>
              <thead>
                <tr>
                  <th style={{ ...css.th, textAlign: "left", minWidth: 115 }}>Team</th>
                  <th style={{ ...css.th, textAlign: "left", minWidth: 100 }}>Owner</th>
                  {ALL_RUNS.map(r => <th key={r} style={css.th}>{r}</th>)}
                  <th style={css.th}>✓</th>
                  <th style={{ ...css.th, minWidth: 60 }}>Live</th>
                </tr>
              </thead>
              <tbody>
                {displayTeams.map(({ team, owner }) => {
                  const hit      = scores[team] || new Set();
                  const hue      = ownerHues[owner];
                  const lg       = liveNow[team];
                  const isFlash  = flashTeams.has(team);
                  return (
                    <tr key={team} style={{ ...css.tr, background: isFlash ? "rgba(34,197,94,0.07)" : "transparent" }}>
                      <td style={{ ...css.td, textAlign: "left" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ ...css.dot, background: TEAM_COLORS[team] || "#555" }} />
                          <span style={{ whiteSpace: "nowrap" }}>{team}</span>
                          {isFlash && <span style={css.newTag}>NEW</span>}
                        </div>
                      </td>
                      <td style={{ ...css.td, textAlign: "left" }}>
                        <span style={{ ...css.ownerTag, background: `hsl(${hue},48%,24%)`, border: `1px solid hsl(${hue},48%,38%)` }}>{owner}</span>
                      </td>
                      {ALL_RUNS.map(r => (
                        <td key={r} style={css.td}>
                          {hit.has(r)
                            ? <span style={css.chk}>✓</span>
                            : lg?.score === r
                              ? <span style={css.liveCell}>●</span>
                              : <span style={css.dot2}>·</span>}
                        </td>
                      ))}
                      <td style={{ ...css.td, fontWeight: 700, color: "#facc15" }}>{hit.size}</td>
                      <td style={css.td}>
                        {lg
                          ? <span style={css.liveScore}>{lg.score} <span style={{ color: "#64748b", fontSize: 10 }}>{lg.half?.slice(0,3)}{lg.inning}</span></span>
                          : <span style={{ color: "#1e293b" }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ LEADERBOARD ═══ */}
      {tab === "leaderboard" && (
        <div style={css.body}>
          <p style={{ fontSize: 11, color: "#475569", marginBottom: 16 }}>
            Each team must individually score all 14 run totals (0–13). First team to complete all wins.
          </p>
          <div style={css.cardGrid}>
            {teamStats.map((t, idx) => {
              const hue     = ownerHues[t.owner];
              const lg      = liveNow[t.team];
              const isFlash = flashTeams.has(t.team);
              return (
                <div key={t.team} style={{
                  ...css.card,
                  borderLeftColor: t.done ? "#22c55e" : `hsl(${hue},55%,42%)`,
                  background: isFlash ? "rgba(34,197,94,0.05)" : "#0c1525",
                }}>
                  <div style={css.cardHdr}>
                    <span style={css.rankN}>#{idx + 1}</span>
                    <span style={{ ...css.dot, background: TEAM_COLORS[t.team] || "#555", width: 11, height: 11 }} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", flex: 1 }}>{t.team}</span>
                    <span style={{ ...css.ownerTag, background: `hsl(${hue},48%,24%)`, border: `1px solid hsl(${hue},48%,38%)`, fontSize: 10 }}>{t.owner}</span>
                    {lg && <span style={css.liveScore}>{lg.score}<span style={{ color: "#64748b", fontSize: 9 }}> {lg.half?.slice(0,3)}{lg.inning}</span></span>}
                    {isFlash && <span style={css.newTag}>NEW</span>}
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#facc15" }}>{t.pct}%</span>
                  </div>
                  <div style={css.prog}><div style={{ ...css.progFill, width: `${t.pct}%`, background: t.done ? "#22c55e" : `hsl(${hue},60%,46%)` }} /></div>
                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 10 }}>
                    {ALL_RUNS.map(r => {
                      const isHit  = t.hit.has(r);
                      const isLive = lg && lg.score === r && !isHit;
                      return (
                        <span key={r} style={{
                          ...css.mpill,
                          background: isHit ? `hsl(${hue},55%,34%)` : isLive ? "#451a03" : "#1a2235",
                          color:      isHit ? "#fff" : isLive ? "#fde68a" : "#334155",
                          border:     isLive ? "1px solid #f59e0b" : "1px solid transparent",
                        }}>{r}</span>
                      );
                    })}
                  </div>
                  {!t.done && <div style={{ color: "#f87171", fontSize: 11, marginTop: 8 }}>Need: {t.missing.join(", ")}</div>}
                  {t.done  && <div style={{ color: "#22c55e", fontSize: 12, fontWeight: 700, marginTop: 8 }}>🏆 COMPLETE!</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ MANUAL ═══ */}
      {tab === "manual" && (
        <div style={css.body}>
          <h3 style={css.secHd}>Add Score</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 32 }}>
            <select style={css.sel} value={manualTeam} onChange={e => setMTeam(e.target.value)}>
              {POOL_TEAMS.map(({ team }) => <option key={team}>{team}</option>)}
            </select>
            <input style={css.inp} type="number" min={0} max={13} placeholder="0–13"
              value={manualRun} onChange={e => setMRun(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addManual()} />
            <button style={css.addBtn} onClick={addManual}>Add</button>
          </div>
          <h3 style={css.secHd}>Recorded Scores</h3>
          <div style={css.tblWrap}>
            <table style={css.tbl}>
              <thead>
                <tr>
                  <th style={{ ...css.th, textAlign: "left" }}>Team</th>
                  <th style={{ ...css.th, textAlign: "left" }}>Owner</th>
                  <th style={{ ...css.th, textAlign: "left" }}>Scores</th>
                </tr>
              </thead>
              <tbody>
                {POOL_TEAMS.map(({ team, owner }) => {
                  const hit = [...(scores[team] || [])].sort((a, b) => a - b);
                  return (
                    <tr key={team} style={css.tr}>
                      <td style={{ ...css.td, textAlign: "left" }}>
                        <span style={{ ...css.dot, background: TEAM_COLORS[team] || "#555" }} /> {team}
                      </td>
                      <td style={{ ...css.td, textAlign: "left" }}>
                        <span style={{ ...css.ownerTag, background: `hsl(${ownerHues[owner]},48%,24%)`, border: `1px solid hsl(${ownerHues[owner]},48%,38%)` }}>{owner}</span>
                      </td>
                      <td style={{ ...css.td, textAlign: "left" }}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {hit.map(r => (
                            <span key={r} style={css.ePill}>
                              {r}
                              <button style={css.rmX} onClick={() => removeScore(team, r)}>×</button>
                            </span>
                          ))}
                          {hit.length === 0 && <span style={{ color: "#334155" }}>—</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{
          ...css.toast,
          background: toast.type === "err" ? "#7f1d1d" : toast.type === "info" ? "#1e3a5f" : "#14532d",
        }}>
          {toast.msg}
        </div>
      )}

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        body { margin: 0; }
      `}</style>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────
const css = {
  wrap:      { fontFamily:"'IBM Plex Mono','Courier New',monospace", background:"#07101e", minHeight:"100vh", color:"#e2e8f0", paddingBottom:60 },
  hdr:       { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px", background:"#0b1828", borderBottom:"1px solid #1e293b", flexWrap:"wrap", gap:10 },
  hdrL:      { display:"flex", alignItems:"center", gap:12 },
  hdrR:      { display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" },
  ttl:       { fontSize:20, fontWeight:700, color:"#f1f5f9", letterSpacing:"-0.5px" },
  sub:       { fontSize:11, color:"#334155", marginTop:2 },
  winBadge:  { background:"linear-gradient(90deg,#854d0e,#b45309)", color:"#fef08a", padding:"5px 12px", borderRadius:5, fontWeight:700, fontSize:12 },
  liveBadge: { display:"flex", alignItems:"center", gap:5, background:"#1a0a0a", border:"1px solid #dc2626", color:"#f87171", padding:"4px 10px", borderRadius:5, fontSize:12, fontWeight:700 },
  liveDot:   { width:7, height:7, borderRadius:"50%", background:"#ef4444", animation:"pulse 1.2s ease-in-out infinite" },
  pollBar:   { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 20px", background:"#090f1b", borderBottom:"1px solid #0f172a", flexWrap:"wrap", gap:8 },
  pollL:     { display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" },
  pollR:     { display:"flex", alignItems:"center", gap:12 },
  autoBtn:   { color:"#94a3b8", background:"#1e293b", border:"1px solid #334155", padding:"5px 11px", borderRadius:5, cursor:"pointer", fontSize:12, fontFamily:"inherit", fontWeight:600 },
  autoBtnOn: { color:"#86efac", background:"#0f2b1a", border:"1px solid #16a34a" },
  syncBtn:   { color:"#93c5fd", background:"#0f2040", border:"1px solid #2563eb", padding:"5px 11px", borderRadius:5, cursor:"pointer", fontSize:12, fontFamily:"inherit", fontWeight:600 },
  spin:      { display:"inline-block", animation:"spin 0.8s linear infinite" },
  cdWrap:    { display:"flex", alignItems:"center", gap:6, fontSize:11 },
  cdLabel:   { color:"#475569" },
  cdTrack:   { width:70, height:3, background:"#1e293b", borderRadius:2, overflow:"hidden" },
  cdFill:    { height:3, background:"#3b82f6", borderRadius:2, transition:"width 1s linear" },
  sleepNote: { fontSize:11, color:"#334155" },
  ticker:    { display:"flex", alignItems:"center", gap:12, padding:"6px 20px", background:"#0a1520", borderBottom:"1px solid #1e293b", overflowX:"auto" },
  tickHd:    { fontSize:9, fontWeight:700, color:"#ef4444", border:"1px solid #ef4444", padding:"1px 5px", borderRadius:3, whiteSpace:"nowrap" },
  tickItem:  { display:"flex", alignItems:"center", gap:5, fontSize:12, whiteSpace:"nowrap", color:"#cbd5e1" },
  covBar:    { display:"flex", alignItems:"center", gap:5, padding:"9px 20px", background:"#090f1b", borderBottom:"1px solid #0f172a", flexWrap:"wrap" },
  covPill:   { width:32, height:32, borderRadius:5, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" },
  tabRow:    { display:"flex", borderBottom:"1px solid #1e293b", padding:"0 20px", background:"#0b1828" },
  tabBtn:    { background:"none", border:"none", color:"#334155", padding:"10px 16px", cursor:"pointer", fontSize:13, fontFamily:"inherit", fontWeight:600, borderBottom:"2px solid transparent" },
  tabOn:     { color:"#60a5fa", borderBottom:"2px solid #3b82f6" },
  body:      { padding:"16px 20px" },
  filterRow: { display:"flex", alignItems:"center", gap:5, flexWrap:"wrap", marginBottom:12 },
  chip:      { background:"#1e293b", border:"1px solid #334155", color:"#64748b", padding:"2px 9px", borderRadius:20, cursor:"pointer", fontSize:11, fontFamily:"inherit" },
  chipOn:    { background:"#1d4ed8", color:"#bfdbfe", borderColor:"#3b82f6" },
  tblWrap:   { overflowX:"auto", borderRadius:7, border:"1px solid #1e293b" },
  tbl:       { width:"100%", borderCollapse:"collapse", fontSize:12 },
  th:        { background:"#0b1828", color:"#334155", padding:"6px 8px", textAlign:"center", fontWeight:700, borderBottom:"1px solid #1e293b", whiteSpace:"nowrap", fontSize:11 },
  tr:        { borderBottom:"1px solid #0f172a" },
  td:        { padding:"5px 8px", textAlign:"center", verticalAlign:"middle" },
  dot:       { width:9, height:9, borderRadius:"50%", display:"inline-block", flexShrink:0 },
  ownerTag:  { padding:"1px 7px", borderRadius:3, fontSize:11, fontWeight:600, color:"#cbd5e1", whiteSpace:"nowrap" },
  chk:       { color:"#22c55e", fontWeight:700, fontSize:13 },
  dot2:      { color:"#1e293b", fontSize:16 },
  liveCell:  { color:"#f59e0b", fontSize:11 },
  liveScore: { color:"#fbbf24", fontWeight:700, fontSize:11, whiteSpace:"nowrap" },
  newTag:    { background:"#14532d", color:"#86efac", fontSize:9, padding:"1px 4px", borderRadius:3, fontWeight:700 },
  cardGrid:  { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(310px,1fr))", gap:12 },
  card:      { background:"#0c1525", border:"1px solid #1e293b", borderLeftWidth:3, borderRadius:8, padding:14 },
  cardHdr:   { display:"flex", alignItems:"center", gap:7, marginBottom:7, flexWrap:"wrap" },
  rankN:     { fontSize:14, fontWeight:700, color:"#1e293b", minWidth:26 },
  prog:      { background:"#1e293b", borderRadius:3, height:4 },
  progFill:  { height:4, borderRadius:3, transition:"width 0.6s ease" },
  mpill:     { width:22, height:22, borderRadius:4, fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" },
  secHd:     { fontSize:12, fontWeight:700, color:"#334155", marginBottom:10, letterSpacing:1, textTransform:"uppercase" },
  sel:       { background:"#1e293b", border:"1px solid #334155", color:"#e2e8f0", padding:"6px 10px", borderRadius:5, fontSize:12, fontFamily:"inherit" },
  inp:       { background:"#1e293b", border:"1px solid #334155", color:"#e2e8f0", padding:"6px 10px", borderRadius:5, fontSize:12, fontFamily:"inherit", width:100 },
  addBtn:    { background:"#14532d", border:"1px solid #16a34a", color:"#86efac", padding:"6px 14px", borderRadius:5, cursor:"pointer", fontSize:12, fontFamily:"inherit", fontWeight:600 },
  ePill:     { background:"#1e293b", border:"1px solid #334155", padding:"2px 6px", borderRadius:3, fontSize:11, display:"flex", alignItems:"center", gap:3 },
  rmX:       { background:"none", border:"none", color:"#f87171", cursor:"pointer", fontSize:12, padding:0, fontFamily:"inherit" },
  toast:     { position:"fixed", bottom:18, right:18, padding:"10px 16px", borderRadius:7, color:"#fff", fontSize:13, fontWeight:600, zIndex:999, boxShadow:"0 4px 20px rgba(0,0,0,.6)", maxWidth:440 },
};
