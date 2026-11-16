import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { exportSave, importSave, validateSave, loadSave } = await import('../src/game/save.js');
import { createSim, step, serialize } from '../src/sim/sim.js';

const sample = () => { const sim = createSim(2, 102); for (let i = 0; i < 300; i++) step(sim, 1); return { ...loadSave(), unlocked: 5, endings: [2], best: { 1: 3010, 4: 2926 }, endlessBest: 7, checkpoint: { chapter: 2, state: Array.from(serialize(sim)) }, settings: { ...loadSave().settings, volume: 0.4, textScale: 1.5 }, futureKey: 'kept' }; };

test('a save survives export and import exactly, including a mid-chapter checkpoint', () => {
  const s = sample(), code = exportSave(s); assert.match(code, /^ODE1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
  const { save, summary } = importSave(code); assert.deepEqual(save, s);
  assert.equal(summary, 'Chapters unlocked 5 of 9 · endings 2 · best times for 2 chapters · a saved game in Chapter 3 · deepest Endless verse 7');
  assert.deepEqual(importSave(code.replace(/(.{60})/g, '$1\n  ')).save, s, 'whitespace and line breaks from chat apps are ignored');
});
test('unicode in a save survives (base64url over UTF-8)', () => { const s = { ...sample(), note: 'Nineveh — ☾ ✶' }; assert.equal(importSave(exportSave(s)).save.note, 'Nineveh — ☾ ✶'); });
test('a damaged, truncated or foreign code is refused with a readable reason', () => {
  const code = exportSave(sample());
  assert.throws(() => importSave(code.slice(0, -10)), /damaged or incomplete/);
  const i = 30, flipped = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1); assert.throws(() => importSave(flipped), /checksum/);
  assert.throws(() => importSave('hello'), /not an ODE save/);
});
test('validation rejects out-of-range or mistyped fields before they reach the game', () => {
  const s = sample();
  assert.deepEqual(validateSave(s), []);
  assert.match(validateSave({ ...s, unlocked: 12 }).join(), /1-9/);
  assert.match(validateSave({ ...s, endings: [3] }).join(), /endings/);
  assert.match(validateSave({ ...s, best: { 10: 5 } }).join(), /best times/);
  assert.match(validateSave({ ...s, settings: { ...s.settings, volume: 'loud' } }).join(), /volume/);
  assert.match(validateSave({ ...s, checkpoint: { chapter: 2, state: [1, 2.5] } }).join(), /32-bit/);
  assert.match(validateSave({ ...s, checkpoint: { chapter: 40, state: [1] } }).join(), /out of range/);
  const forged = exportSave({ ...s, unlocked: 99 }); assert.throws(() => importSave(forged), /cannot be used: unlocked chapters must be 1-9/);
});
