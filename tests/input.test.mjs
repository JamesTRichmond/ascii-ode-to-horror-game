import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IN } from '../src/sim/sim.js';

// Minimal DOM for input.js: window/document listeners, no touch buttons.
function fakeDom() {
  const win = {}, doc = {};
  globalThis.addEventListener = (t, f) => { (win[t] ||= []).push(f); };
  globalThis.document = { addEventListener: (t, f) => { (doc[t] ||= []).push(f); }, querySelectorAll: () => [], pointerLockElement: null };
  return { fire: (t, e) => (win[t] || []).forEach(f => f(e)), lock: canvas => { document.pointerLockElement = canvas; (doc.pointerlockchange || []).forEach(f => f()); } };
}

test('a pointer-locked left click is a chord tap (regression: IN was used but not imported)', async () => {
  const dom = fakeDom(), canvas = { addEventListener() {} };
  const { createInput } = await import('../src/game/input.js');
  const st = createInput(canvas); st.enabled = true; dom.lock(canvas);
  assert.doesNotThrow(() => dom.fire('mousedown', { button: 0 }));
  assert.equal(st.taps & IN.CHORD, IN.CHORD);
  assert.equal(st.poll() & IN.CHORD, IN.CHORD, 'the tap reaches the next tick word');
});
