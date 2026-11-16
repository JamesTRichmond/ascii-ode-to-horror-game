import test from 'node:test';
import assert from 'node:assert/strict';
import { createExposure, meter, adapt } from '../src/render/exposure.js';
import { specimen } from './helpers.mjs';

const field = (w, h, f) => { const r = new Float32Array(w * h * 3); for (let i = 0; i < w * h; i++) { const v = f(i); r[i * 3] = r[i * 3 + 1] = r[i * 3 + 2] = v; } return r; };
test('metering reads the scene, divides out the current exposure, and ignores a few hot pixels', () => {
  const ae = createExposure(), W = 120, H = 60;
  assert.ok(Math.abs(meter(ae, field(W, H, () => 0.1), W, H, 1) - Math.log2(0.1)) < 0.25);
  assert.ok(Math.abs(meter(ae, field(W, H, () => 0.2), W, H, 2) - Math.log2(0.1)) < 0.25, 'exposure divided out');
  const hot = meter(ae, field(W, H, i => (i % 50 === 0 ? 40 : 0.1)), W, H, 1); assert.ok(Math.abs(hot - Math.log2(0.1)) < 0.3, `2% flames must not drive the meter: ${hot}`);
});
test('partial adaptation: dark scenes brighten, bright scenes dim, within the clamps', () => {
  const ae = createExposure(); adapt(ae, Math.log2(0.04), 99); assert.ok(Math.abs(ae.ev - 2) < 1e-6, `(0.16/0.04)^0.5 = 2, got ${ae.ev}`);
  adapt(ae, Math.log2(0.64), 99); assert.ok(Math.abs(ae.ev - 0.5) < 1e-6); adapt(ae, Math.log2(1e-4), 99); assert.equal(ae.ev, 2.2);
});
test('the eye adapts to darkness slowly and to light quickly', () => {
  const t90 = (from, to) => { const ae = createExposure(); adapt(ae, Math.log2(from), 99); const start = ae.ev; let t = 0; while (Math.abs(ae.ev - ae.target) > 0.1 * Math.abs(ae.target - start) || t === 0) { adapt(ae, Math.log2(to), 1 / 60); t += 1 / 60; } return t; };
  const intoDark = t90(0.64, 0.04), intoLight = t90(0.04, 0.64); assert.ok(intoDark > 4 * intoLight, `${intoDark.toFixed(2)} s vs ${intoLight.toFixed(2)} s`);
});
test('in the pipeline: on by option only, starts adapted, and the meter sees the final frame', () => {
  const off = specimen('low', 2); assert.equal(off.pl.stats.exposure, undefined, 'default pipelines are unchanged');
  const on = specimen('low', 1, (sim, pl) => { pl.opts.autoExposure = true; }); const e0 = on.pl.ae.ev; on.frame(); on.frame();
  assert.ok(on.pl.ae.ev >= 0.5 && on.pl.ae.ev <= 2.2); assert.ok(Math.abs(on.pl.ae.ev - e0) < 0.05, 'a static scene holds its exposure (started adapted)');
});
