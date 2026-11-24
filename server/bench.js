// Headless run of both modes over the same seeded stream. Writes docs/RESULTS.md and docs/results.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { run } from './engine.js';

const seed = Number(process.env.SEED || 7);
const out = {};
for (const mode of ['silo', 'shared']) {
  const t0 = Date.now();
  const { result } = await run({ mode, seed });
  out[mode] = { ...result.st, seconds: (Date.now() - t0) / 1000, meko: result.meko, attacks: result.attacks, holds: result.decisions.map((d) => ({ id: d.id, account: d.account, risk: +d.risk.toFixed(2), truth: d.truth, factors: d.factors.map((f) => f.k) })) };
  const s = result.st;
  console.log(`${mode.padEnd(6)} stopped ${s.stopped}/${s.attacks}  takeovers ${s.takeovers}  lost $${s.lost.toFixed(0)}  compromised ${s.compromised}  false holds ${s.falseHolds}  mean stage ${s.meanStage?.toFixed(2)}  meko calls ${s.mekoCalls}  ${out[mode].seconds}s`);
}
mkdirSync('docs', { recursive: true });
writeFileSync('docs/results.json', JSON.stringify(out, null, 2));
