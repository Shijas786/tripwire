// Two ways for the agents to remember.
//   SiloMemory: each agent keeps its own notes in process and never sees another agent's.
//   MekoMemory: every signal, pattern and decision lives in Meko datapacks that all agents share.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tool, rest } from './meko.js';
import { AGENTS, ARBITER, WINDOW, describe, tokens } from './agents.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT_MATCH = Number(process.env.TRIPWIRE_SCRIPT_MATCH || 0.5);
const SCRIPT_PREFIX = 'Confirmed social-engineering script: ';

export class SiloMemory {
  constructor() {
    this.kind = 'silo';
    this.notes = new Map(); // agent|account -> [{t, factors, text}]
    this.learned = new Map(); // agent -> Map(entity -> text)
  }
  async init() { return {}; }
  async recall(agent, e) {
    const mine = (this.notes.get(`${agent}|${e.account}`) || []).filter((n) => n.t >= e.t - WINDOW);
    const factors = mine.flatMap((n) => n.factors.map((f) => ({ ...f, from: agent, t: n.t })));
    const evidence = mine.map((n) => ({ text: n.text, agent, t: n.t }));
    const known = this.learned.get(agent) || new Map();
    if (agent === 'login-sentry' && known.has(e.device)) factors.push({ k: 'pattern.device', s: 0.9, why: `device ${e.device} is on this agent's own blocklist`, from: agent });
    if (agent === 'payments-hawk' && known.has(e.payee)) factors.push({ k: 'pattern.payee', s: 0.9, why: `payee ${e.payee} is on this agent's own blocklist`, from: agent });
    if (agent === 'support-listener' && known.has(e.text)) factors.push({ k: 'pattern.script', s: 0.5, why: 'wording is identical to a confirmed script', from: agent });
    return { factors, evidence, tokens: evidence.reduce((n, x) => n + tokens(x.text), 0), calls: [] };
  }
  async write(agent, e, local, text) {
    const key = `${agent}|${e.account}`;
    if (!this.notes.has(key)) this.notes.set(key, []);
    this.notes.get(key).push({ t: e.t, factors: local, text });
  }
  async decide() { return {}; }
  // Fraud-ops feedback returns only to the agent that owns the evidence.
  async confirm(c) {
    const learn = (agent, entity, text) => {
      if (!entity) return;
      if (!this.learned.has(agent)) this.learned.set(agent, new Map());
      this.learned.get(agent).set(entity, text);
    };
    const out = [];
    if (c.raisedBy === 'payments-hawk' || c.chargeback) { learn('payments-hawk', c.payee, 'mule'); if (c.payee) out.push({ agent: 'payments-hawk', text: `Payments Hawk blocklisted ${c.payee} (private to this agent)` }); }
    if (c.raisedBy === 'login-sentry') { learn('login-sentry', c.device, 'device'); out.push({ agent: 'login-sentry', text: `Login Sentry blocklisted ${c.device} (private to this agent)` }); }
    if (c.raisedBy === 'support-listener') { learn('support-listener', c.script, 'script'); }
    return out;
  }
  async summary() { return null; }
}

export class MekoMemory {
  constructor(runId) {
    this.kind = 'shared';
    this.runId = runId;
    this.handles = new Map();
  }

  async init(log = () => {}) {
    const boot = await tool('conversation_create', { session_id: `tripwire:${this.runId}:boot`, agent_id: ARBITER, title: `Tripwire run ${this.runId}` });
    this.signals = (await tool('datapack_create', { name: `tripwire-signals-${this.runId}`, conversation_id: boot.id })).datapack_id;
    this.patterns = (await tool('datapack_create', { name: `tripwire-patterns-${this.runId}`, conversation_id: boot.id })).datapack_id;
    this.desk = await this.conv(this.patterns, 'fraud-desk', 'Fraud desk: confirmed attacker patterns');
    log('Created datapacks: raw signals and confirmed patterns');
    for (const f of ['account-takeover-response.md', 'false-positive-policy.md']) {
      await tool('knowledgebase_upload_file', { path: path.join(ROOT, 'playbooks', f), conversation_id: this.desk, datapack_id: this.patterns, agent_id: ARBITER });
    }
    for (let i = 0; i < 40; i++) {
      const s = await rest(`/datapacks/${this.patterns}/knowledge-bases/documents`).catch(() => null);
      const docs = s?.documents || s?.items || s || [];
      if (Array.isArray(docs) && docs.length >= 2 && docs.every((d) => /complete|indexed|ready/i.test(d.status || d.state || ''))) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    log('Indexed fraud playbooks into the knowledge base');
    return { signals: this.signals, patterns: this.patterns };
  }

  async conv(datapack, key, title) {
    const k = `${datapack}|${key}`;
    if (!this.handles.has(k)) {
      const c = await tool('conversation_create', { session_id: `tripwire:${this.runId}:${key}`, datapack_id: datapack, agent_id: ARBITER, title });
      this.handles.set(k, c.id);
    }
    return this.handles.get(k);
  }
  caseOf(account) { return this.conv(this.signals, `case:${account}`, `Case file ${account}`); }

  async recall(agent, e) {
    const calls = [];
    const timed = async (label, name, args) => {
      const t0 = performance.now();
      const out = await tool(name, args);
      calls.push({ label, tool: name, ms: Math.round(performance.now() - t0) });
      return out;
    };
    const factors = [];
    const evidence = [];
    const cid = await this.caseOf(e.account);
    const q = describe(e);

    // 1. What has any agent already noticed on this account?
    const hits = await timed('case file', 'memory_search', { query: q, run_id: cid, conversation_id: cid, datapack_id: this.signals, agent_id: agent, limit: 25 });
    for (const h of hits.results || []) {
      const m = h.metadata || {};
      if (m.kind !== 'signal' || m.t < e.t - WINDOW || m.t > e.t) continue;
      evidence.push({ id: h.id, text: h.memory, agent: h.agent_id, t: m.t, source: 'case file' });
      for (const f of m.factors || []) factors.push({ ...f, from: h.agent_id, t: m.t });
    }

    // 2. Has this device been seen on other accounts?
    if (e.device && e.newDevice) {
      const ic = await this.conv(this.signals, `infra:${e.device}`, `Device ${e.device}`);
      const seen = await timed('device sightings', 'memory_search', { query: q, run_id: ic, conversation_id: ic, datapack_id: this.signals, agent_id: agent, limit: 25 });
      const others = (seen.results || []).filter((h) => h.metadata?.account && h.metadata.account !== e.account);
      const accts = [...new Set(others.map((h) => h.metadata.account))];
      if (accts.length) {
        factors.push({ k: 'infra.device_shared', s: 0.55, why: `device ${e.device} was also used on ${accts.slice(0, 3).join(', ')}`, from: others[0].agent_id });
        evidence.push({ id: others[0].id, text: others[0].memory, agent: others[0].agent_id, t: others[0].metadata.t, source: 'device sightings' });
      }
    }

    // 3. Does anything match a confirmed attacker pattern, and what does the playbook say?
    const ctx = await timed('confirmed patterns + playbooks', 'context_search', { query: e.type === 'support' ? e.text : q, conversation_id: cid, datapack_id: this.patterns, agent_id: agent, limit: 30 });
    let playbook = null;
    // Confirmed patterns are promoted memories, which Meko serves from the knowledge base (hybrid
    // keyword + vector search), next to the playbook chunks. Until promotion they are plain memories.
    const cands = [
      ...(ctx.results?.knowledge_base || []).map((h) => ({ id: h.metadata_filters?.memory_id || h.id, text: h.chunk_text || '', sim: 1 - (h.distance ?? 1), promoted: h.metadata_filters?.source === 'memory', agent: h.metadata_filters?.agent_id })),
      ...(ctx.results?.memory || []).map((h) => ({ id: h.id, text: h.memory || '', sim: h.raw_similarity_score ?? h.score ?? 0, promoted: true, agent: h.agent_id })),
    ];
    let bestScript = null;
    for (const h of cands) {
      if (!h.promoted) { if (!playbook && h.text.startsWith('Document:')) playbook = { text: h.text.replace(/^Document:.*\nSection: /, '').slice(0, 360) }; continue; }
      let f = null;
      if (e.device && h.text.startsWith(`Confirmed attacker device ${e.device}:`)) f = { k: 'pattern.device', s: 0.9, why: `device ${e.device} is a confirmed attacker device` };
      else if (e.payee && h.text.startsWith(`Confirmed mule payee ${e.payee}:`)) f = { k: 'pattern.payee', s: 0.9, why: `payee ${e.payee} is a confirmed mule` };
      else if (e.type === 'support' && h.text.startsWith(SCRIPT_PREFIX)) {
        if (process.env.TRIPWIRE_DEBUG) console.error('script-sim', h.sim.toFixed(3), e.attack || 'legit', '|', e.text.slice(0, 40), '|', h.text.slice(SCRIPT_PREFIX.length, SCRIPT_PREFIX.length + 40));
        if (h.sim >= SCRIPT_MATCH && (!bestScript || bestScript.sim < h.sim)) bestScript = h;
        continue;
      }
      if (f) { factors.push({ ...f, from: ARBITER }); evidence.push({ id: h.id, text: h.text, agent: ARBITER, source: 'confirmed patterns' }); }
    }
    if (bestScript) {
      factors.push({ k: 'pattern.script', s: 0.5, why: `wording matches a confirmed social-engineering script (similarity ${bestScript.sim.toFixed(2)})`, from: ARBITER });
      evidence.push({ id: bestScript.id, text: bestScript.text, agent: ARBITER, source: 'confirmed patterns' });
    }

    return { factors, evidence, playbook, calls, tokens: evidence.reduce((n, x) => n + tokens(x.text), 0), savings: ctx.token_savings };
  }

  async write(agent, e, local, text) {
    const cid = await this.caseOf(e.account);
    const meta = { kind: 'signal', t: e.t, event: e.id, account: e.account, factors: local.map(({ k, s, why }) => ({ k, s, why })) };
    const jobs = [tool('memory_add', { text, conversation_id: cid, datapack_id: this.signals, agent_id: agent, metadata: JSON.stringify(meta) })];
    if (e.device && e.newDevice) {
      const ic = await this.conv(this.signals, `infra:${e.device}`, `Device ${e.device}`);
      jobs.push(tool('memory_add', { text: `Device ${e.device} used on ${e.account} (${e.type}) via ${e.asn || 'unknown network'}`, conversation_id: ic, datapack_id: this.signals, agent_id: agent, metadata: JSON.stringify({ kind: 'sighting', t: e.t, account: e.account }) }));
    }
    await Promise.all(jobs);
  }

  // The decision itself is a conversation turn in the account's case file, so its trace is stored with it.
  async decide(d) {
    const cid = await this.caseOf(d.account);
    const r = await tool('conversation_add_message', {
      conversation_id: cid, datapack_id: this.signals, agent_id: ARBITER,
      input: d.input, output: d.output, plan: d.plan, reasoning: d.reasoning, seed: d.id,
      metadata: JSON.stringify({ decision: d.id, action: d.action, risk: d.risk, factors: d.factors, evidence: d.evidence.map((x) => x.id).filter(Boolean), tokens: d.tokens }),
    });
    return { conversation: cid, message: r.message_id, datapack: this.signals };
  }

  async confirm(c) {
    const src = `takeover of ${c.account}, ${c.chargeback ? 'confirmed by chargeback' : 'confirmed by analyst review'}`;
    const items = [];
    if (c.device) items.push({ entityType: 'device', entity: c.device, text: `Confirmed attacker device ${c.device}: used in the ${src}. Hold any session from this device.` });
    if (c.payee) items.push({ entityType: 'payee', entity: c.payee, text: `Confirmed mule payee ${c.payee}: destination in the ${src}. Block for every customer.` });
    if (c.script) items.push({ entityType: 'script', entity: c.script, text: `${SCRIPT_PREFIX}"${c.script}"` });
    const ids = [];
    const out = [];
    for (const it of items) {
      const dup = this.handles.get(`pattern|${it.entity}`);
      if (dup) continue;
      this.handles.set(`pattern|${it.entity}`, true);
      const r = await tool('memory_add', { text: it.text, conversation_id: this.desk, datapack_id: this.patterns, agent_id: ARBITER, metadata: JSON.stringify({ kind: 'pattern', entityType: it.entityType, entity: it.entity, source: c.account, t: c.t }) });
      const id = r.results?.[0]?.id;
      if (id) ids.push(id);
      out.push({ agent: ARBITER, entityType: it.entityType, text: it.text });
    }
    // Promote confirmed patterns to collective memory so they outlive the case that produced them.
    if (ids.length && process.env.TRIPWIRE_PROMOTE !== '0') {
      await tool('memory_promote', { conversation_id: this.desk, datapack_id: this.patterns, agent_id: ARBITER, memory_ids: ids }).then(() => { this.promoted = (this.promoted || 0) + ids.length; }).catch((err) => { this.promoteError = err.message; });
    }
    const report = [`# Incident ${c.account}`, '', `- Outcome: ${c.chargeback ? 'takeover completed, reported by customer' : 'held and confirmed as fraud by analyst'}`,
      `- Device: ${c.device || 'n/a'}`, `- Payee: ${c.payee || 'not reached'}`, `- Script: ${c.script || 'not reached'}`, '', '## Signals', ...(c.evidence || []).map((x) => `- [${AGENTS[x.agent]?.name || x.agent}] ${x.text}`)].join('\n');
    const cid = await this.caseOf(c.account);
    await tool('artifact_put', { filename: `incident-${c.account}.md`, content_base64: Buffer.from(report).toString('base64'), content_type: 'text/markdown', conversation_id: cid, datapack_id: this.signals, agent_id: ARBITER }).catch(() => {});
    await tool('conversation_add_message', { conversation_id: this.desk, datapack_id: this.patterns, agent_id: ARBITER, input: `Outcome for ${c.account}: fraud confirmed`, output: `Stored ${items.length} confirmed pattern(s) for every agent.`, plan: ['Read the case file', 'Extract reusable attacker infrastructure and wording', 'Store as confirmed patterns'], reasoning: 'Only analyst- or chargeback-confirmed indicators go into the patterns datapack, so raw noise never becomes a rule.' }).catch(() => {});
    return out;
  }

  async trace(ref) {
    const data = await rest(`/datapacks/${ref.datapack}/conversations/${ref.conversation}`);
    const thread = data.conversation?.thread || [];
    return thread.find((t) => t.message_id === ref.message) || null;
  }

  async summary() {
    const [s, p] = await Promise.all([rest(`/datapacks/${this.signals}/metrics`), rest(`/datapacks/${this.patterns}/metrics`)]);
    return { signals: s, patterns: p, promoted: this.promoted || 0, promoteError: this.promoteError, ids: { signals: this.signals, patterns: this.patterns } };
  }
}
