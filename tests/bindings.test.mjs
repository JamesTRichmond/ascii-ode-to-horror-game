import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BINDINGS, normalise, keymap, rebind, keyName, describe } from '../src/game/bindings.js';
import { IN } from '../src/sim/sim.js';

test('the defaults reproduce the original fixed layout exactly', () => {
  const { keys, pause } = keymap(normalise(null));
  assert.deepEqual(keys, { KeyW: IN.FWD, ArrowUp: IN.FWD, KeyS: IN.BACK, ArrowDown: IN.BACK, KeyA: IN.LEFT, KeyD: IN.RIGHT, ArrowLeft: IN.TURNL, KeyQ: IN.TURNL, ArrowRight: IN.TURNR, Space: IN.HUM, KeyF: IN.CHORD, ShiftLeft: IN.HOLD, ShiftRight: IN.HOLD, KeyE: IN.USE, Enter: IN.USE });
  assert.deepEqual([...pause].sort(), ['Escape', 'KeyP']);
});
test('rebinding replaces the primary key, keeps the secondary, and takes the key from its old action', () => {
  const r = rebind(normalise(null), 'HUM', 'KeyF'); assert.deepEqual(r.bindings.HUM, ['KeyF']); assert.deepEqual(r.bindings.CHORD, []); assert.equal(r.moved, 'CHORD');
  const s = rebind(normalise(null), 'FWD', 'KeyI'); assert.deepEqual(s.bindings.FWD, ['KeyI', 'ArrowUp']); assert.equal(s.moved, null);
  assert.equal(keymap(s.bindings).keys.KeyW, undefined, 'the old primary is released');
});
test('Esc and Tab can never be bound, so the player cannot lock themselves out', () => {
  assert.throws(() => rebind(normalise(null), 'HUM', 'Escape'), /reserved/); assert.throws(() => rebind(normalise(null), 'USE', 'Tab'), /reserved/);
  assert.deepEqual(normalise({ HUM: ['Escape', 'Tab', 'KeyH'] }).HUM, ['KeyH'], 'stored reserved keys are dropped');
  assert.ok(keymap(normalise({ PAUSE: [] })).pause.has('Escape'), 'Esc pauses even with no pause key bound');
});
test('stored bindings are validated and merged over the defaults', () => {
  const b = normalise({ HUM: ['KeyH'], CHORD: 'bogus', NOPE: ['KeyZ'], USE: [42, '<script>'] });
  assert.deepEqual(b.HUM, ['KeyH']); assert.deepEqual(b.CHORD, DEFAULT_BINDINGS.CHORD); assert.equal(b.NOPE, undefined); assert.deepEqual(b.USE, []);
});
test('key names read naturally', () => {
  assert.deepEqual(['KeyW', 'ArrowUp', 'Space', 'ShiftLeft', 'Digit3', 'Numpad5', 'Semicolon'].map(keyName), ['W', '↑', 'Space', 'Left Shift', '3', 'Num 5', 'Semicolon']);
  assert.equal(describe(normalise(null), 'FWD'), 'W / ↑');
});
