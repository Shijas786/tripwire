import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../server/sim.js';
import { combine, HOLD_AT } from '../server/agents.js';
import { run } from '../server/engine.js';

test('the stream is deterministic for a seed', () => {
  const a = generate(7);
  const b = generate(7);
  assert.deepEqual(a.events, b.events);
  assert.equal(a.attacks.length, 19);
  assert.notDeepEqual(generate(8).events, a.events);
});

test('one weak signal never reaches the hold threshold', () => {
  assert.ok(combine([{ k: 'login.new_device', s: 0.25 }]).risk < HOLD_AT);
  assert.ok(combine([{ k: 'a', s: 0.4 }, { k: 'a', s: 0.4 }]).risk < HOLD_AT, 'the same factor twice counts once');
  assert.ok(combine([{ k: 'a', s: 0.5 }, { k: 'b', s: 0.5 }, { k: 'c', s: 0.3 }]).risk >= HOLD_AT);
});

test('siloed agents let takeovers through and never hold honest customers', async () => {
  const { result } = await run({ mode: 'silo', seed: 7 });
  assert.equal(result.st.falseHolds, 0);
  assert.ok(result.st.takeovers > 0);
  assert.ok(result.st.stopped + result.st.takeovers === 19);
});
