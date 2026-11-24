// Drives the race. Live: Server-Sent Events from the API, which runs both modes against Meko.
// Replay: a recorded real run (recording.json), used when no API is reachable (the hosted demo).
// Both sides are released on one clock of simulation ticks, so they stay in step on screen.
import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from './sound.js';

const blank = () => ({
  st: null, ticker: [], lanes: {}, decisions: [], takeovers: [], patterns: [], setup: [], done: null, runId: null, packs: null,
  fx: [], calls: 0, callMs: 0,
});

export function useRace() {
  const [source, setSource] = useState('checking'); // checking | live | replay
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [error, setError] = useState(null);
  const [, bump] = useState(0);
  const S = useRef({ silo: blank(), shared: blank(), attacks: [], ticks: 1, clock: 0, feed: [], traces: {} });
  const Q = useRef({ silo: [], shared: [], lastT: { silo: 0, shared: 0 }, liveClock: 0, replay: null, raf: 0, es: null, speed: 1, finished: false });

  useEffect(() => {
    fetch('api/health').then((r) => r.json()).then((h) => setSource(h.ok ? 'live' : 'replay')).catch(() => setSource('replay'));
  }, []);

  const apply = (m) => {
    const st = S.current;
    const side = st[m.mode];
    if (!side) return;
    switch (m.k) {
      case 'start':
        side.runId = m.runId;
        st.attacks = m.attacks; st.ticks = m.ticks;
        for (const a of m.attacks) side.lanes[a.id] = { ...a, stage: 0, state: 'pending' };
        break;
      case 'setup': side.setup.push(m.text); break;
      case 'ready': side.packs = m.packs; break;
      case 'event': {
        const e = m.e;
        if (m.risk > 0 || e.truth) {
          side.ticker.unshift({ ...e, risk: m.risk, recalled: m.recalled });
          if (side.ticker.length > 7) side.ticker.pop();
        }
        if (e.truth) { const l = side.lanes[e.truth.id]; if (l && l.state !== 'stopped') { l.stage = e.truth.stage; l.state = 'active'; } }
        if (m.risk > 0) {
          side.fx.push({ k: 'signal', agent: e.agent, from: m.from || [], recalled: m.recalled || 0 });
          if (m.mode === 'shared') { (m.recalled ? sfx.recall : sfx.signal)(); }
        } else if (e.n % 3 === 0) side.fx.push({ k: 'routine', agent: e.agent });
        for (const c of m.calls || []) { side.calls++; side.callMs += c.ms; }
        break;
      }
      case 'decision': {
        const d = { ...m.d, mode: m.mode };
        side.decisions.unshift(d);
        st.feed.unshift({ kind: 'hold', mode: m.mode, d, t: d.t });
        if (d.truth) { const l = side.lanes[d.truth.attack]; if (l) { l.state = 'stopped'; l.stage = d.truth.stage; l.decision = d.id; } }
        side.fx.push({ k: 'hold', agent: d.agent, label: d.account, fp: !d.truth });
        (m.mode === 'shared' ? sfx.hold : sfx.siloHold)();
        break;
      }
      case 'takeover': {
        side.takeovers.unshift(m);
        st.feed.unshift({ kind: 'takeover', mode: m.mode, t: m.t, m });
        const l = side.lanes[m.attack]; if (l) { l.state = 'lost'; l.stage = 5; }
        side.fx.push({ k: 'takeover', label: m.account });
        sfx.takeover();
        break;
      }
      case 'pattern':
        side.patterns.unshift(m);
        if (m.mode === 'shared') { side.fx.push({ k: 'pattern' }); sfx.pattern(); }
        break;
      case 'stats': side.st = m.st; break;
      case 'done': side.done = m.result; side.st = m.result.st; break;
      default:
    }
  };

  const loop = useCallback(() => {
    const q = Q.current;
    const st = S.current;
    let clock;
    if (q.replay) {
      const now = performance.now();
      q.replay.clock += ((now - q.replay.last) / 1000) * 34 * q.speed;
      q.replay.last = now;
      clock = q.replay.clock;
    } else clock = q.finished ? Infinity : q.liveClock;
    let changed = false;
    for (const mode of ['silo', 'shared']) {
      const list = q[mode];
      let i = 0;
      while (i < list.length && list[i]._t <= clock) { apply(list[i]); i++; changed = true; }
      if (i) list.splice(0, i);
    }
    st.clock = Math.min(clock, st.ticks);
    if (changed || q.replay) bump((n) => (n + 1) % 1e9);
    const drained = !q.silo.length && !q.shared.length && (q.finished || q.replay);
    if (drained && st.shared.done && st.silo.done) {
      setStatus('done'); sfx.finish();
      return;
    }
    q.raf = requestAnimationFrame(loop);
  }, []);

  const ingest = (m) => {
    const q = Q.current;
    if (m.mode === 'race') {
      if (m.k === 'finished') q.finished = true;
      if (m.k === 'error') { setError(m.error); setStatus('error'); }
      return;
    }
    const t = m.e?.t ?? m.d?.t ?? m.t;
    if (t != null) q.lastT[m.mode] = t;
    // Live: results wait for the race to end. Replay: they follow the side's last recorded event.
    m._t = m.k === 'done' ? (q.replay ? q.lastT[m.mode] + 1 : 1e12) : m.k === 'start' || m.k === 'setup' || m.k === 'ready' ? -1 : q.lastT[m.mode];
    if (m.mode === 'shared' && m._t < 1e12) q.liveClock = Math.max(q.liveClock, m._t);
    q[m.mode].push(m);
  };

  const start = useCallback(async (speed = 1) => {
    const q = Q.current;
    cancelAnimationFrame(q.raf);
    q.es?.close();
    Object.assign(q, { silo: [], shared: [], lastT: { silo: 0, shared: 0 }, liveClock: 0, replay: null, es: null, speed, finished: false });
    S.current = { silo: blank(), shared: blank(), attacks: [], ticks: 1, clock: 0, feed: [], traces: {} };
    setError(null); setStatus('running');
    sfx.unlock(); sfx.start();
    if (source === 'live') {
      const delay = Math.round(26 / speed);
      const es = new EventSource(`api/race?delay=${delay}`);
      q.es = es;
      es.onmessage = (ev) => { const m = JSON.parse(ev.data); ingest(m); if (m.mode === 'race') es.close(); };
      es.onerror = () => { es.close(); if (!Q.current.finished) { setError('Lost the connection to the Tripwire API.'); setStatus('error'); } };
    } else {
      try {
        const rec = await (await fetch('recording.json')).json();
        S.current.traces = rec.traces || {};
        q.replay = { clock: -1, last: performance.now() };
        for (const m of rec.log) ingest({ ...m });
        q.replay.last = performance.now();
      } catch (err) { setError(`Could not load the recorded run: ${err.message}`); setStatus('error'); return; }
    }
    q.raf = requestAnimationFrame(loop);
  }, [source, loop]);

  const setSpeed = useCallback((s) => { Q.current.speed = s; }, []);

  const trace = useCallback(async (d) => {
    const st = S.current;
    if (d.mode !== 'shared') return null;
    if (st.traces[d.id]) return st.traces[d.id];
    if (source !== 'live') return null;
    const r = await fetch(`api/trace/${st.shared.runId}/${d.id}`);
    if (!r.ok) return null;
    const j = await r.json();
    st.traces[d.id] = j;
    return j;
  }, [source]);

  useEffect(() => () => { cancelAnimationFrame(Q.current.raf); Q.current.es?.close(); }, []);

  return { source, status, error, state: S.current, start, setSpeed, trace };
}
