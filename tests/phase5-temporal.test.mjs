// Nocturne phase 5 acceptance — temporal coherence and combat physicality.
// Fixture: "Compare one second of decay at 30 and 120 Hz. A .01 score improvement must not
//           cross a .025 switch margin; a .10 improvement must."
import test from 'node:test';
import assert from 'node:assert/strict';
import { specimen, quantile } from './helpers.mjs';
import { decayDensity, responseAlpha, shouldSwitch, historyValid, densityGlyph, DecayField, SWITCH_MARGIN } from '../src/render/temporal.js';
import { motionBiasAmount } from '../src/render/select.js';
import { burst } from '../src/render/pipeline.js';
import { packInput, IN } from '../src/sim/sim.js';

test('density decay is frame-rate invariant: one second at 30, 60 and 120 Hz', () => {
  const run = hz => { let d = 1; for (let i = 0; i < hz; i++) d = decayDensity(d, 0, 1 / hz, 0.3); return d; }, a = run(30), b = run(60), c = run(120);
  assert.ok(Math.abs(a - c) < 1e-12 && Math.abs(a - b) < 1e-12, `${a} ${b} ${c}`); assert.ok(Math.abs(a - Math.exp(-1 / 0.3)) < 1e-12);
  const blend = hz => { let v = 0; for (let i = 0; i < hz; i++) v += (1 - v) * responseAlpha(1 / hz, 0.12); return v; }; assert.ok(Math.abs(blend(30) - blend(120)) < 1e-12, 'vector response is frame-rate invariant too');
});
test('trails: same lifetime at 30/60/120 Hz; paused scenes stop evolving; new emission overrides decay', () => {
  const life = hz => { const f = new DecayField(8); f.emit(0, 0, 0, 1, 0, 0, 1, 0.5, [1, 1, 1]); let t = 0; while (f.n > 0 && t < 10) { f.update(1 / hz); t += 1 / hz; } return t; };
  const l30 = life(30), l60 = life(60), l120 = life(120); assert.ok(Math.abs(l30 - l120) <= 1 / 30 + 1e-9 && Math.abs(l60 - l120) <= 1 / 60 + 1e-9, `${l30} ${l60} ${l120}`);
  const f = new DecayField(8); f.emit(1, 2, 3, 1, 0, 0, 0.8, 0.5, [1, 1, 1]); const before = [f.density[0], f.pos[0]]; f.update(0); assert.deepEqual([f.density[0], f.pos[0]], before, 'dt = 0 changes nothing');
  assert.equal(decayDensity(0.2, 0.9, 0.016, 0.3), 0.9);
});
test('density quantises through @ -> % -> * -> . -> empty', () => {
  assert.deepEqual([0.9, 0.5, 0.2, 0.08, 0.01].map(d => densityGlyph(d)), ['@', '%', '*', '.', '']);
  let d = 1; const seen = []; for (let i = 0; i < 400; i++) { d = decayDensity(d, 0, 1 / 60, 0.7); const g = densityGlyph(d); if (seen.at(-1) !== g) seen.push(g); } assert.deepEqual(seen, ['@', '%', '*', '.', '']);
});
test('hysteresis acts on the selection score: .01 does not cross the .025 margin, .10 does, invalid history always switches', () => {
  assert.equal(SWITCH_MARGIN, 0.025);
  assert.equal(shouldSwitch(true, 0.19, 0.2, SWITCH_MARGIN), false); assert.equal(shouldSwitch(true, 0.1, 0.2, SWITCH_MARGIN), true); assert.equal(shouldSwitch(false, 0.19, 0.2, SWITCH_MARGIN), true);
});
test('history rejection: object/material change, depth mismatch, normal discontinuity, incompatible leaf level', () => {
  assert.equal(historyValid(0x102, 0x102, 3, 3, 5.0, 5.05, 0.99), true);
  assert.equal(historyValid(0x102, 0x202, 3, 3, 5.0, 5.0, 1), false, 'different object'); assert.equal(historyValid(0x102, 0x101, 3, 3, 5.0, 5.0, 1), false, 'different material');
  assert.equal(historyValid(0x102, 0x102, 3, 3, 5.0, 7.0, 1), false, 'depth'); assert.equal(historyValid(0x102, 0x102, 3, 3, 5.0, 5.0, 0.5), false, 'normal'); assert.equal(historyValid(0x102, 0x102, 2, 3, 5.0, 5.0, 1), false, 'leaf level');
});
test('motion bias: only renderer object motion rotates strokes; static background under camera motion has zero bias', () => {
  assert.equal(motionBiasAmount(900, false, 0.75), 0); assert.equal(motionBiasAmount(10, true, 0.75), 0); assert.ok(motionBiasAmount(120, true, 0.75) > 0.3); assert.equal(motionBiasAmount(5000, true, 0.75), 0.75);
});

test('static scene stabilises: glyph switch rate with temporal history is far below the unfiltered rate', t => {
  const on = specimen('high', 30), off = specimen('high', 30, (sim, pl) => { pl.sel.opts.temporal = false; });
  const diff = s => { const before = new Map(); for (let i = 0; i < s.pl.sel.stats.emitted; i++) before.set((s.pl.sel.inst[i * 11] | 0) + ',' + (s.pl.sel.inst[i * 11 + 1] | 0), s.pl.sel.inst[i * 11 + 6]); s.frame(); let ch = 0, n = 0; for (let i = 0; i < s.pl.sel.stats.emitted; i++) { const k = (s.pl.sel.inst[i * 11] | 0) + ',' + (s.pl.sel.inst[i * 11 + 1] | 0); if (before.has(k)) { n++; if (before.get(k) !== s.pl.sel.inst[i * 11 + 6]) ch++; } } return ch / n; };
  const a = [], b = []; for (let f = 0; f < 20; f++) { a.push(diff(on)); b.push(diff(off)); }
  const pa = quantile(a, 0.95), pb = quantile(b, 0.95); t.diagnostic(`glyph changes per frame, static camera, p95: with history ${(pa * 100).toFixed(2)}%, without ${(pb * 100).toFixed(2)}%; reported switch rate ${(on.pl.sel.stats.switchRate * 100).toFixed(2)}%`);
  assert.ok(pa < 0.03, 'static scene is stable'); assert.ok(pa <= pb, 'history never makes it worse'); assert.ok(on.pl.sel.stats.valid / on.pl.sel.stats.matched > 0.95, 'history is reused');
});
test('camera motion: p95 switch rate is recorded; a disocclusion rejects history at once (ghost duration 0 frames)', t => {
  const s = specimen('high', 10), rates = []; let rejected = 0;
  for (let f = 0; f < 60; f++) { s.tick(packInput(IN.TURNR | (f > 30 ? IN.FWD : 0))); s.frame(1 / 60); rates.push(s.pl.sel.stats.switchRate); rejected += s.pl.sel.stats.rejected; }
  t.diagnostic(`turning/walking: switch rate p50 ${(quantile(rates, 0.5) * 100).toFixed(1)}%, p95 ${(quantile(rates, 0.95) * 100).toFixed(1)}%; history rejections ${rejected}`);
  assert.ok(quantile(rates, 0.95) < 0.2, 'carried variety identity keeps moving surfaces stable'); assert.ok(rejected > 0, 'newly exposed surfaces reject history');
  // teleport the creature: every leaf that now shows background where the creature was must not reuse creature history
  const sel = s.pl.sel, spider = s.sim.ents.at(-1); s.frame(1 / 60); s.frame(1 / 60); const calm = sel.stats.rejected; spider.x -= 2500; spider.z += 1500; s.frame(1 / 60);
  t.diagnostic(`history rejections: ${calm} in a still frame, ${sel.stats.rejected} in the frame the creature jumps`);
  assert.ok(sel.stats.rejected > calm * 3, `${sel.stats.rejected} leaves rejected stale history in the frame of the change`);
});
test('reduced-motion mode removes shockwaves and persistent trails', () => {
  const { pl } = specimen('low', 1); burst(pl, 0, 1, 0, 60, 9, [1, 1, 1], 1.2); assert.equal(pl.trails.n, 60); assert.ok(Math.hypot(pl.trails.vel[0], pl.trails.vel[2]) > 0);
  pl.trails.clear(); pl.opts.reducedMotion = true; burst(pl, 0, 1, 0, 60, 9, [1, 1, 1], 1.2);
  assert.ok(pl.trails.n <= 6); for (let i = 0; i < pl.trails.n; i++) { assert.equal(Math.hypot(pl.trails.vel[i * 3], pl.trails.vel[i * 3 + 1], pl.trails.vel[i * 3 + 2]), 0); assert.ok(pl.trails.tau[i] <= 0.4); }
});
