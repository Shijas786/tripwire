// Decision trace drawer: why an account was held, who contributed what, and the turn as Meko stored it.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AGENTS, FACTOR_LABEL, STAGES } from './agents.js';

export default function Trace({ d, load, onClose, Chip }) {
  const [stored, setStored] = useState(undefined);
  useEffect(() => { let on = true; setStored(undefined); load(d).then((t) => on && setStored(t)).catch(() => on && setStored(null)); return () => { on = false; }; }, [d, load]);
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  const shared = d.mode === 'shared';
  const agents = [...new Set(d.factors.map((f) => f.from))];
  const turn = stored?.turn;
  return (
    <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside className="drawer" initial={{ x: 520 }} animate={{ x: 0 }} exit={{ x: 520 }} transition={{ type: 'spring', stiffness: 300, damping: 32 }} onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">✕</button>
        <span className={`pill ${d.mode}`}>{shared ? 'MEKO' : 'SILO'}</span>
        <h2>Hold {d.account}</h2>
        <p className="drawer-sub">{d.input}</p>
        <div className="risk"><div className="risk-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${d.risk * 100}%` }} /><em style={{ left: '70%' }} /></div><b>{d.risk.toFixed(2)}</b><span>risk · hold at 0.70</span></div>
        {d.truth
          ? <div className="truth ok">Ground truth: planted takeover by crew {d.truth.crew} (wave {d.truth.wave}), stopped at step {d.truth.stage} of 5, {STAGES[d.truth.stage - 1].toLowerCase()}.</div>
          : <div className="truth fp">Ground truth: this was an honest customer. A false hold.</div>}

        <h4>Why: {d.factors.length} factors from {agents.length} agent{agents.length > 1 ? 's' : ''}</h4>
        <div className="factors">
          {d.factors.map((f) => (
            <div key={f.k} className="factor">
              <div className="factor-top"><b>{FACTOR_LABEL[f.k] || f.k}</b><Chip agent={f.from} /><span>+{f.s.toFixed(2)}</span></div>
              <div className="bar"><motion.i initial={{ width: 0 }} animate={{ width: `${f.s * 100}%` }} className="fill" style={{ background: (AGENTS[f.from] || AGENTS.arbiter).color }} /></div>
              <p>{f.why}</p>
            </div>
          ))}
        </div>

        <h4>{shared ? 'What the agents recalled from Meko' : 'What this agent had in its own notes'}</h4>
        {!d.evidence.length && <p className="muted">{shared ? 'Nothing stored yet for this account.' : 'Nothing. Signals other agents saw on this account never reached it.'}</p>}
        {d.evidence.map((x, i) => (
          <div key={i} className="evidence"><Chip agent={x.agent} />{x.source && <em>{x.source}</em>}<p>{x.text}</p></div>
        ))}
        {d.playbook && <><h4>Playbook section retrieved from the knowledge base</h4><div className="playbook">{d.playbook.text}</div></>}

        {shared && (
          <>
            {!!d.calls?.length && (
              <>
                <h4>Meko calls made to reach this decision</h4>
                <div className="calls">{d.calls.map((c, i) => <span key={i} className="call ro">{c.tool}<i>{c.label}</i><b>{c.ms} ms</b></span>)}</div>
              </>
            )}
            <h4>The decision as stored in Meko</h4>
            {stored === undefined && <p className="muted">Reading the conversation turn back from Meko…</p>}
            {stored === null && <p className="muted">Stored trace not available in this session.</p>}
            {turn && (
              <div className="stored">
                <ol>{(turn.plan || []).map((p, i) => <li key={i}>{p}</li>)}</ol>
                <p className="reason"><b>Reasoning</b> {turn.reasoning}</p>
                <div className="calls">
                  {(turn.calls || []).map((c, i) => <span key={i} className={c.read_only ? 'call ro' : 'call'}>{c.tool}<i>{AGENTS[c.agent_id]?.short || c.agent_id}</i>{c.ms != null && <b>{c.ms} ms</b>}</span>)}
                </div>
                <p className="muted mono">conversation {stored.ref.conversation.slice(0, 12)}… · turn {stored.ref.message.slice(0, 12)}… · {(turn.calls || []).length} Meko calls recorded on this turn</p>
              </div>
            )}
            <div className="tok"><span>Context used: <b>{d.tokens.context} tokens</b></span><span>Raw event window instead: <b>{d.tokens.raw.toLocaleString()} tokens</b></span><span>Decided in <b>{d.ms} ms</b></span></div>
          </>
        )}
      </motion.aside>
    </motion.div>
  );
}
