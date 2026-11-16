// Performance policy: automatic tier selection responds to measured frame time with hysteresis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoQuality, sampleFrame } from '../src/game/quality.js';
import { assets, SPECIMEN } from './helpers.mjs';
import { createPipeline, setScene, adoptScene, renderFrame, burst } from '../src/render/pipeline.js';
import { createSim } from '../src/sim/sim.js';
import { viewOf } from '../src/game/view.js';

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
test('a tier change mid-play keeps world, light, clocks and effects instead of restarting them', () => {
  const { atlas, noise } = assets(), sim = createSim(SPECIMEN, 100), low = createPipeline(atlas, noise, 'low'); setScene(low, sim);
  for (let f = 0; f < 5; f++) renderFrame(low, viewOf(sim, sim, 1), 1 / 30);
  burst(low, 10, 1, 10, 30, 2, [1, 1, 1], 2); low.flash = 0.7; low.world.floorH[3] = 1.234; // a wall mid-animation
  const med = adoptScene(createPipeline(atlas, noise, 'medium'), low);
  assert.equal(med.world, low.world); assert.equal(med.world.floorH[3], Math.fround(1.234)); assert.equal(med.time, low.time); assert.equal(med.flash, 0.7);
  assert.equal(med.trails, low.trails); assert.equal(med.trails.n, 30); assert.equal(med.cascades, low.cascades);
  renderFrame(med, viewOf(sim, sim, 1), 1 / 30); assert.equal(med.w, 400); assert.ok(med.sel.count > 500 && med.time > low.time - 1e-9);
});
