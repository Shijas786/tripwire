// Runs the event stream through the agents. The rules and the hold threshold are the same in both
// modes: the only thing that changes is what the agents can remember.
import { generate } from './sim.js';
import { AGENTS, ARBITER, HOLD_AT, WINDOW, agentFor, combine, describe, scoreLocal, tokens } from './agents.js';
import { SiloMemory, MekoMemory } from './memory.js';

const REVIEW_AFTER = 8;
const CHARGEBACK_AFTER = 60;

export async function run({ mode = 'shared', seed = 7, delay = 0, emit = () => {}, signal } = {}) {
  const world = generate(seed);
  const runId = `${mode === 'shared' ? 'm' : 's'}${Date.now().toString(36)}`;
  const mem = mode === 'shared' ? new MekoMemory(runId) : new SiloMemory();
  emit({ k: 'start', mode, runId, events: world.events.length, attacks: world.attacks.length, accounts: Object.keys(world.accounts).length });
  const packs = await mem.init((text) => emit({ k: 'setup', text }));
  emit({ k: 'ready', packs });

  const attacks = new Map(world.attacks.map((a) => [a.id, { ...a, state: 'active', stage: 0, seen: {} }]));
  const recentPayees = new Map(); // account -> Map(payee -> t)
  const due = [];
  const decisions = [];
  const rawTok = [0];
  const st = { mode, runId, events: 0, routine: 0, signals: 0, holds: 0, falseHolds: 0, stopped: 0, takeovers: 0, compromised: 0, lost: 0, saved: 0,
    stageSum: 0, mekoCalls: 0, mekoMs: 0, ctxTokens: 0, rawTokens: 0, decisionsWithContext: 0, attacks: world.attacks.length, total: world.events.length, patterns: 0 };

  const settle = async (t) => {
    due.sort((a, b) => a.at - b.at);
    while (due.length && due[0].at <= t) {
      const job = due.shift();
      const learned = await mem.confirm(job.case);
      st.patterns += learned.length;
      for (const l of learned) emit({ k: 'pattern', t: job.at, ...l });
    }
  };

  for (const e of world.events) {
    if (signal?.aborted) break;
    const atk = e.attack ? attacks.get(e.attack) : null;
    if (atk && atk.state !== 'active') continue; // account frozen: the rest of the kill chain never happens
    await settle(e.t);

    const acct = world.accounts[e.account];
    const agent = agentFor(e.type);
    e.newDevice = !!e.device && e.device !== acct.device;
    const line = describe(e);
    rawTok.push(rawTok[rawTok.length - 1] + tokens(line));
    st.events++;

    if (!recentPayees.has(e.account)) recentPayees.set(e.account, new Map());
    const rp = recentPayees.get(e.account);
    const local = scoreLocal(e, acct, new Map([...rp].filter(([, t]) => t >= e.t - WINDOW)));
    if (e.type === 'payee_add') rp.set(e.payee, e.t);
    if (atk) { atk.stage = e.stage; if (e.type === 'support') atk.seen.script = e.text; if (e.payee) atk.seen.payee = e.payee; atk.seen.device = atk.device; }

    const pub = { id: e.id, t: e.t, type: e.type, account: e.account, agent, text: line, n: st.events };
    if (!local.length) {
      st.routine++;
      emit({ k: 'event', e: pub, risk: 0 });
    } else {
      const t0 = performance.now();
      const ctx = await mem.recall(agent, e);
      const { risk, factors } = combine([...local.map((f) => ({ ...f, from: agent, t: e.t })), ...ctx.factors]);
      const localRisk = combine(local).risk;
      const text = `${AGENTS[agent].name}: ${line}. ${local.map((f) => f.why).join('; ')}. Local risk ${localRisk.toFixed(2)}.`;
      await mem.write(agent, e, local, text);
      st.signals++;
      st.mekoCalls += ctx.calls.length + (mode === 'shared' ? 1 + (e.newDevice ? 1 : 0) : 0);
      const windowRaw = rawTok[rawTok.length - 1] - (rawTok[Math.max(0, rawTok.length - 1 - WINDOW)] || 0);
      if (mode === 'shared') { st.ctxTokens += ctx.tokens + tokens(line); st.rawTokens += windowRaw; st.decisionsWithContext++; }
      emit({ k: 'event', e: pub, risk, localRisk, recalled: ctx.evidence.length, from: [...new Set(ctx.evidence.map((x) => x.agent))], calls: ctx.calls });

      if (risk >= HOLD_AT) {
        const contributors = [...new Set(factors.map((f) => f.from))];
        const d = {
          id: `dec_${String(decisions.length + 1).padStart(3, '0')}`, t: e.t, event: e.id, account: e.account, agent, action: 'hold', risk, factors,
          evidence: ctx.evidence, playbook: ctx.playbook || null, calls: ctx.calls, tokens: { context: ctx.tokens + tokens(line), raw: windowRaw },
          input: line,
          output: `HOLD ${e.account}: combined risk ${risk.toFixed(2)} from ${contributors.length} agent(s).`,
          plan: [
            `${AGENTS[agent].name} scored the event locally at ${localRisk.toFixed(2)}.`,
            mode === 'shared' ? `Recalled ${ctx.evidence.length} stored signal(s) and pattern(s) from Meko, written by ${[...new Set(ctx.evidence.map((x) => AGENTS[x.agent]?.name || 'Arbiter'))].join(', ') || 'no one'}.` : `Checked this agent's private notes only (${ctx.evidence.length} found).`,
            `Combined ${factors.length} distinct factor(s) into risk ${risk.toFixed(2)}, at or above the hold threshold ${HOLD_AT}.`,
            'Froze the action and queued the case for analyst review.',
          ],
          reasoning: factors.map((f) => `${f.why} [${AGENTS[f.from]?.name || 'Arbiter'}, +${f.s}]`).join('. ') + '.',
          truth: atk ? { attack: atk.id, crew: atk.crew, wave: atk.wave, stage: e.stage } : null,
          ms: Math.round(performance.now() - t0),
        };
        d.ref = await mem.decide(d);
        if (mode === 'shared') st.mekoCalls++;
        decisions.push(d);
        st.holds++;
        if (atk) {
          atk.state = 'stopped'; atk.stoppedAt = e.stage;
          st.stopped++; st.stageSum += e.stage; st.saved += atk.amount;
          if (e.stage > 3) st.compromised++;
          due.push({ at: e.t + REVIEW_AFTER, case: { account: e.account, t: e.t, raisedBy: agent, device: atk.seen.device, payee: atk.seen.payee, script: atk.seen.script, evidence: ctx.evidence } });
        } else st.falseHolds++;
        emit({ k: 'decision', d });
      } else if (atk && e.type === 'transfer') {
        atk.state = 'lost'; st.takeovers++; st.lost += atk.amount; st.compromised++;
        due.push({ at: e.t + CHARGEBACK_AFTER, case: { account: e.account, t: e.t, chargeback: true, raisedBy: 'payments-hawk', device: atk.seen.device, payee: atk.seen.payee, script: atk.seen.script, evidence: ctx.evidence } });
        emit({ k: 'takeover', t: e.t, account: e.account, amount: atk.amount, attack: atk.id, crew: atk.crew, wave: atk.wave, risk });
      }
    }
    if (st.events % 10 === 0) emit({ k: 'stats', st: { ...st } });
    if (delay) await new Promise((r) => setTimeout(r, delay));
  }
  await settle(Infinity);
  st.meanStage = st.stopped ? st.stageSum / st.stopped : null;
  const meko = await mem.summary().catch(() => null);
  const result = { st, meko, decisions, attacks: [...attacks.values()].map(({ seen, ...a }) => a) };
  emit({ k: 'done', result });
  return { result, mem };
}
