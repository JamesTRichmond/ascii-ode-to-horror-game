// Performance policy: automatic tier selection responds to measured frame time with hysteresis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoQuality, sampleFrame } from '../src/game/quality.js';

const feed = (aq, ms, n) => { let last = null; for (let i = 0; i < n; i++) { const r = sampleFrame(aq, typeof ms === 'function' ? ms(i) : ms); if (r) last = r; } return last; };
test('steps down after one slow window, never below low', () => {
  const aq = createAutoQuality({ start: 'high', window: 10 }); assert.equal(feed(aq, 50, 10), 'medium'); feed(aq, 50, 40); assert.equal(aq.tier, 'low'); feed(aq, 80, 100); assert.equal(aq.tier, 'low');
});
test('steps up only after two consecutive fast windows', () => {
  const aq = createAutoQuality({ start: 'low', window: 10 }); feed(aq, 8, 10); assert.equal(aq.tier, 'low'); feed(aq, 8, 10); assert.equal(aq.tier, 'medium');
});
test('a frame-time spike in 4% of frames does not trigger a change; p95 does', () => {
  const aq = createAutoQuality({ start: 'medium', window: 100 }); feed(aq, i => (i % 25 === 0 ? 90 : 20), 100); assert.equal(aq.tier, 'medium');
  feed(aq, i => (i % 10 === 0 ? 90 : 20), 100); assert.equal(aq.tier, 'low');
});
test('no oscillation in the dead band between budgets', () => { const aq = createAutoQuality({ start: 'medium', window: 10 }); feed(aq, 25, 500); assert.equal(aq.changes, 0); });
