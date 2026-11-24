// Records one full race, with every stored decision trace, to web/public/recording.json so the
// hosted demo can replay a real run without a Meko server behind it.
import { writeFileSync, mkdirSync } from 'node:fs';
import { run } from './engine.js';

const seed = Number(process.env.SEED || 7);
const log = [];
const t0 = Date.now();
const rec = (mode) => (msg) => log.push({ mode, ...msg });
const silo = await run({ mode: 'silo', seed, emit: rec('silo') });
const shared = await run({ mode: 'shared', seed, emit: rec('shared') });
const traces = {};
for (const d of shared.result.decisions) traces[d.id] = { turn: await shared.mem.trace(d.ref), ref: d.ref };
void silo;
mkdirSync('web/public', { recursive: true });
writeFileSync('web/public/recording.json', JSON.stringify({ seed, recordedAt: new Date().toISOString(), seconds: (Date.now() - t0) / 1000, log, traces }));
console.log(`Recorded ${log.length} messages and ${Object.keys(traces).length} traces.`);
