import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Arena from './Arena.jsx';
import Trace from './Trace.jsx';
import { useRace } from './useRace.js';
import { AGENTS, STAGES, money } from './agents.js';
import { sfx } from './sound.js';

const Chip = ({ agent }) => {
  const A = AGENTS[agent] || AGENTS.arbiter;
  return <span className="chip" style={{ '--c': A.color }}>{A.glyph} {A.name}</span>;
};

function Stat({ label, value, tone, sub }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <motion.div key={String(value)} className="stat-value" initial={{ scale: 1.25, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 18 }}>{value}</motion.div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function Lanes({ side, onPick }) {
  const lanes = Object.values(side.lanes);
  return (
    <div className="lanes">
      <div className="lanes-head"><span>Planted takeover</span>{STAGES.map((s) => <span key={s}>{s}</span>)}</div>
      {lanes.map((l) => (
        <button key={l.id} className={`lane ${l.state}`} onClick={() => l.decision && onPick(side.decisions.find((d) => d.id === l.decision))} disabled={!l.decision}>
          <span className="lane-name"><i className={`crew ${l.crew}`} />{l.account}<em>w{l.wave}</em></span>
          {STAGES.map((s, i) => {
            const n = i + 1;
            const cls = l.state === 'stopped' && n === l.stage ? 'dot shield' : l.state === 'lost' ? 'dot lost' : n <= l.stage ? 'dot hit' : 'dot';
            return <span key={s} className="cell"><span className={cls}>{cls === 'dot shield' ? '✓' : cls === 'dot lost' && n === 5 ? '✕' : ''}</span></span>;
          })}
        </button>
      ))}
    </div>
  );
}

function Side({ title, tag, side, shared, running, onPick }) {
  const st = side.st || {};
  const lanes = Object.values(side.lanes);
  const hijacked = lanes.filter((l) => l.stage >= 3 && !(l.state === 'stopped' && l.stage === 3)).length;
  const stopped = lanes.filter((l) => l.state === 'stopped');
  const mean = stopped.length ? (stopped.reduce((n, l) => n + l.stage, 0) / stopped.length).toFixed(1) : '–';
  return (
    <section className={`side ${shared ? 'shared' : 'silo'}`}>
      <header className="side-head">
        <div><span className="side-tag">{tag}</span><h2>{title}</h2></div>
        <div className="side-progress"><span>{st.events || 0}</span> / {st.total || '…'} events</div>
      </header>
      <div className="stats">
        <Stat label="Accounts hijacked" value={hijacked} tone={hijacked ? 'bad' : 'good'} sub="contact details replaced" />
        <Stat label="Money stolen" value={money(st.lost)} tone={st.lost ? 'bad' : 'good'} sub={`${st.takeovers || 0} completed takeovers`} />
        <Stat label="Caught at step" value={mean} tone={shared ? 'good' : 'warn'} sub="of 5 in the kill chain" />
        <Stat label="False holds" value={st.falseHolds || 0} tone="plain" sub="honest customers frozen" />
      </div>
      <div className="arena">
        <Arena side={side} shared={shared} running={running} />
        <div className="ticker">
          <AnimatePresence initial={false}>
            {side.ticker.slice(0, 4).map((e) => (
              <motion.div key={e.id} layout initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="tick" style={{ '--c': AGENTS[e.agent]?.color }}>
                <b>{e.risk.toFixed(2)}</b><span>{e.text}</span>{shared && e.recalled > 0 && <i>+{e.recalled} recalled</i>}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
      <Lanes side={side} onPick={onPick} />
    </section>
  );
}

function Feed({ state, onPick }) {
  return (
    <div className="panel feed">
      <h3>Decisions and outcomes</h3>
      <div className="feed-list">
        {!state.feed.length && <p className="muted">Every hold and every completed takeover lands here. Click a hold to open its stored trace.</p>}
        <AnimatePresence initial={false}>
          {state.feed.slice(0, 40).map((f) => f.kind === 'hold' ? (
            <motion.button layout key={f.mode + f.d.id} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className={`feed-item hold ${f.mode}`} onClick={() => onPick(f.d)}>
              <span className={`pill ${f.mode}`}>{f.mode === 'shared' ? 'MEKO' : 'SILO'}</span>
              <span className="feed-main"><b>Hold {f.d.account}</b> at step {f.d.truth?.stage ?? '?'} · risk {f.d.risk.toFixed(2)}{!f.d.truth && <em className="fp"> false hold</em>}</span>
              <span className="feed-agents">{[...new Set(f.d.factors.map((x) => x.from))].map((a) => <i key={a} style={{ background: (AGENTS[a] || AGENTS.arbiter).color }} title={(AGENTS[a] || AGENTS.arbiter).name} />)}</span>
            </motion.button>
          ) : (
            <motion.div layout key={f.mode + f.m.attack} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="feed-item takeover">
              <span className={`pill ${f.mode}`}>{f.mode === 'shared' ? 'MEKO' : 'SILO'}</span>
              <span className="feed-main"><b>Takeover {f.m.account}</b> · {money(f.m.amount)} gone · no single agent saw enough (risk {f.m.risk.toFixed(2)})</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Memory({ state }) {
  const sh = state.shared;
  const st = sh.st || {};
  const m = sh.done?.meko;
  const perDecision = st.decisionsWithContext ? Math.round(st.ctxTokens / st.decisionsWithContext) : 0;
  const rawPer = st.decisionsWithContext ? Math.round(st.rawTokens / st.decisionsWithContext) : 0;
  const pct = rawPer ? Math.round((1 - perDecision / rawPer) * 100) : 0;
  return (
    <div className="panel memory">
      <h3>What Meko holds</h3>
      <div className="mem-grid">
        <div><b>{st.signals || 0}</b><span>signals written by 4 agents</span></div>
        <div><b>{sh.patterns.length}</b><span>confirmed patterns promoted</span></div>
        <div><b>{st.mekoCalls || 0}</b><span>Meko calls{sh.calls ? ` · ${Math.round(sh.callMs / sh.calls)} ms avg recall` : ''}</span></div>
        <div><b>{m ? m.signals.artifact_count : '…'}</b><span>incident reports stored as artifacts</span></div>
      </div>
      <div className="tokens">
        <div className="tokens-row"><span>Context per decision with Meko</span><b>{perDecision.toLocaleString()} tokens</b></div>
        <div className="bar"><motion.i animate={{ width: `${rawPer ? Math.max(2, (perDecision / rawPer) * 100) : 0}%` }} className="fill meko" /></div>
        <div className="tokens-row"><span>Raw event window an agent would need without it</span><b>{rawPer.toLocaleString()} tokens</b></div>
        <div className="bar"><motion.i animate={{ width: rawPer ? '100%' : '0%' }} className="fill raw" /></div>
        <p className="muted">{pct ? `${pct}% fewer tokens to reach each decision (4 characters per token estimate).` : 'Measured as the race runs.'}</p>
      </div>
      <h4>Confirmed patterns, visible to every agent</h4>
      <div className="patterns">
        {!sh.patterns.length && <p className="muted">Nothing confirmed yet.</p>}
        <AnimatePresence initial={false}>
          {sh.patterns.slice(0, 8).map((p, i) => (
            <motion.div layout key={p.text} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className={`pattern ${p.entityType}`}>
              <span>{p.entityType}</span>{p.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function App() {
  const race = useRace();
  const { state, status, source } = race;
  const [speed, setSpeedState] = useState(1);
  const [sound, setSound] = useState(true);
  const [picked, setPicked] = useState(null);
  const running = status === 'running';
  useEffect(() => { sfx.setEnabled(sound); }, [sound]);
  const pick = (d) => { if (d) { sfx.click(); setPicked(d); } };
  const progress = Math.min(100, (state.clock / state.ticks) * 100);
  const siloLanes = Object.values(state.silo.lanes);
  const verdict = status === 'done' ? {
    silo: siloLanes.filter((l) => l.stage >= 3 && !(l.state === 'stopped' && l.stage === 3)).length,
    lost: state.silo.st?.lost || 0,
    shared: state.shared.st?.stopped || 0,
    total: state.attacks.length,
  } : null;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 64 32" className="logo"><path d="M2 16h16l6-12 8 24 6-12h24" /></svg>
          <div><h1>Tripwire</h1><p>Four fraud agents. One memory. Same rules on both sides.</p></div>
        </div>
        <div className="controls">
          <span className={`source ${source}`}>{source === 'live' ? '● Live on Meko' : source === 'replay' ? '● Replay of a recorded Meko run' : '○ Connecting'}</span>
          <div className="seg">{[1, 2, 4].map((s) => <button key={s} className={speed === s ? 'on' : ''} onClick={() => { setSpeedState(s); race.setSpeed(s); sfx.click(); }}>{s}×</button>)}</div>
          <button className="ghost" onClick={() => setSound(!sound)} aria-label="Toggle sound">{sound ? '🔊 Sound on' : '🔇 Sound off'}</button>
          <button className="go" disabled={source === 'checking' || running} onClick={() => race.start(speed)}>{running ? 'Race running…' : status === 'done' ? '↻ Run again' : '▶ Start the race'}</button>
        </div>
      </header>
      <div className="progress"><motion.i animate={{ width: `${progress}%` }} transition={{ ease: 'linear', duration: 0.2 }} /></div>

      {status === 'idle' && (
        <motion.div className="hero" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h2>An account takeover is five quiet steps. <span>No single agent sees more than one.</span></h2>
          <p>1,795 synthetic banking events, 19 planted takeovers by three crews. Both sides run the same four agents with the same scoring rules and the same hold threshold. The only difference is whether they share memory through Meko.</p>
          <button className="go big" disabled={source === 'checking'} onClick={() => race.start(speed)}>▶ Start the race</button>
        </motion.div>
      )}
      {race.error && <div className="error">{race.error}</div>}
      <AnimatePresence>
        {verdict && (
          <motion.div className="verdict" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
            <div><b className="bad">{verdict.silo}/{verdict.total}</b><span>accounts hijacked and {money(verdict.lost)} stolen without shared memory</span></div>
            <i>vs</i>
            <div><b className="good">{verdict.shared}/{verdict.total}</b><span>takeovers stopped before any contact detail changed, with Meko</span></div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="race">
        <Side title="Agents in silos" tag="WITHOUT SHARED MEMORY" side={state.silo} running={running} onPick={pick} />
        <Side title="Agents on Meko" tag="WITH SHARED MEMORY" side={state.shared} shared running={running} onPick={pick} />
      </main>
      <div className="lower">
        <Feed state={state} onPick={pick} />
        <Memory state={state} />
      </div>
      <footer>Synthetic data only. Built for ContextCon on the Meko Context Engine by Yugabyte. Click any green shield or hold to see the stored decision trace.</footer>
      <AnimatePresence>{picked && <Trace d={picked} load={race.trace} onClose={() => setPicked(null)} Chip={Chip} />}</AnimatePresence>
    </div>
  );
}
