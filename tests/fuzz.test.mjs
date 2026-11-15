// Property-based fuzzing: random held-input programs on every chapter and on Endless verses. Each tick must keep
// every documented invariant; a mid-run snapshot restored with deserialize() must reach the same final state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzRun, inputProgram, checkInvariants } from '../tools/lib/fuzz.mjs';
import { CHAPTERS } from '../src/sim/chapters.js';
import { endlessVerse } from '../src/sim/endless.js';
import { createSim } from '../src/sim/sim.js';

test('input programs are reproducible from their seed', () => {
  assert.deepEqual(inputProgram(42, 500), inputProgram(42, 500)); assert.notDeepEqual(inputProgram(42, 500), inputProgram(43, 500));
});
test('the invariant checker catches a planted violation', () => {
  const s = createSim(0, 1); s.p.hp = 101; assert.match(checkInvariants(s).join(), /hp 101/);
  const t = createSim(0, 1); t.p.x = -5; assert.match(checkInvariants(t).join(), /outside/);
});
for (const [i, c] of CHAPTERS.entries()) test(`fuzz chapter ${c.id}: 12 programs x 1500 ticks keep every invariant and restore exactly`, () => {
  let ended = 0; for (let seed = 1; seed <= 12; seed++) { const r = fuzzRun(i, seed, 1500); assert.ok(r.ok, `seed ${seed}: ${r.violations?.join('; ')}`); if (r.dead || r.done) ended++; }
  test.diagnostic?.(`chapter ${c.id}: ${ended}/12 programs ended in death or exit`);
});
test('fuzz Endless verses (seed 7, depths 1-6): 6 programs x 1500 ticks each', () => {
  for (let d = 1; d <= 6; d++) for (let seed = 1; seed <= 6; seed++) { const r = fuzzRun(endlessVerse(7, d), seed, 1500); assert.ok(r.ok, `depth ${d} seed ${seed}: ${r.violations?.join('; ')}`); }
});

test('saves carry the path fields exactly; the state hash and older saves are unaffected', async () => {
  const { createSim, step, serialize, deserialize, hashState } = await import('../src/sim/sim.js');
  const s = createSim(5, 5), inputs = inputProgram(5 * 2654435761, 800); for (let t = 0; t < 751; t++) { step(s, inputs[t]); s.events.length = 0; }
  const full = serialize(s), core = serialize(s, false), r = deserialize(full);
  assert.deepEqual([...r.fieldP], [...s.fieldP]); assert.deepEqual([...r.fieldN], [...s.fieldN]);
  assert.equal(hashState(r), hashState(s)); assert.ok(full.length > core.length && full.length - core.length <= 2 + s.fieldP.length, 'extension block is at most one int per two cells per field + 2');
  const legacy = deserialize(core); assert.equal(hashState(legacy), hashState(s), 'a save without the block still loads (path fields recomputed, best effort)');
  for (let t = 751; t < 800; t++) { step(s, inputs[t]); step(r, inputs[t]); s.events.length = 0; r.events.length = 0; }
  assert.equal(hashState(r), hashState(s), 'the restored run stays in lockstep');
});
