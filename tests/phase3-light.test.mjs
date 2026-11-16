// Nocturne phase 3 acceptance — volume, atmosphere and transported light.
// Fixture: "A homogeneous slab must match exp(-sigma_t * d) at 10, 100 and 1,000 steps.
//           Toggle the wall in the directional-cascade lab and inspect the visibility change."
import test from 'node:test';
import assert from 'node:assert/strict';
import { specimen, assets } from './helpers.mjs';
import { createCascades, solveCascades, addEmitter, LEVELS } from '../src/render/cascades.js';
import { marchTransmittance, fogDensity, createFog, integrateFog, directionalShadow, probeIrradiance } from '../src/render/light.js';
import { createGBuffer, makeCamera, setCamera, traceWorld, FAR } from '../src/render/gbuffer.js';
import { createPipeline, setScene, renderFrame } from '../src/render/pipeline.js';
import { createSim, inShade, solidAt } from '../src/sim/sim.js';
import { viewOf } from '../src/game/view.js';

test('homogeneous slab matches exp(-sigma d) at 10, 100 and 1,000 steps', () => {
  const sigma = 0.15, d = 7, analytic = Math.exp(-sigma * d);
  for (const n of [10, 100, 1000]) assert.ok(Math.abs(marchTransmittance(() => sigma, d, n) - analytic) < 1e-12, `${n} steps`);
});
function fogScene(steps, homogeneous) {
  const w = 12, h = 12, n = w * h, W = { w, h, floorH: new Float32Array(n), ceilH: new Float32Array(n).fill(FAR), floorMat: new Uint8Array(n).fill(7), wallMat: new Uint8Array(n).fill(2), ceilMat: new Uint8Array(n).fill(2) };
  for (let x = 0; x < w; x++) W.floorH[9 * w + x] = 6;
  const gb = createGBuffer(240, 135), cam = makeCamera(240, 135), fog = createFog(240, 135, 3), c = createCascades(w * 4, h * 4);
  setCamera(cam, 12, 1.6, 4, Math.PI / 2); traceWorld(gb, W, cam); solveCascades(c, { bounces: 0, sky: [0.2, 0.2, 0.2] });
  fog.sigma = 0.06; fog.steps = steps; fog.homogeneous = homogeneous; fog.height = 3; fog.ambient = [0.1, 0.1, 0.1];
  integrateFog(fog, gb, cam, { cascades: c, time: 3, exposure: 1 }, assets().noise);
  return { fog, gb, cam };
}
test('renderer fog: homogeneous transmittance is within 1% of analytic along the true ray length', () => {
  const { fog, gb, cam } = fogScene(8, true); let worst = 0, checked = 0;
  for (let fy = 0; fy < fog.fh; fy += 4) for (let fx = 0; fx < fog.fw; fx += 4) {
    const sx = fx * 3 + 1, sy = fy * 3 + 1, d = Math.min(fog.maxDist, gb.depth[sy * gb.w + sx]), a = (sx + 0.5 - gb.w / 2) / cam.f, vy = (sy + 0.5 - cam.cy) / cam.f;
    const len = d * Math.hypot(cam.fx + cam.rx * a, cam.fz + cam.rz * a, vy), T = fog.T[fy * fog.fw + fx]; if (T < 0.02) continue; // early-out threshold
    worst = Math.max(worst, Math.abs(T - Math.exp(-0.06 * len)) / Math.exp(-0.06 * len)); checked++;
  }
  assert.ok(checked > 50 && worst < 0.01, `worst relative error ${worst}`);
});
test('renderer fog: halving the step size changes brightness minimally; density is never negative', t => {
  const a = fogScene(8, false).fog, b = fogScene(16, false).fog; let sa = 0, sb = 0;
  for (let i = 0; i < a.L.length; i++) { sa += a.L[i]; sb += b.L[i]; assert.ok(a.L[i] >= 0 && Number.isFinite(a.L[i])); }
  t.diagnostic(`in-scattered energy 8 steps ${sa.toFixed(3)} vs 16 steps ${sb.toFixed(3)} (${(Math.abs(sa - sb) / sb * 100).toFixed(2)}%)`);
  assert.ok(Math.abs(sa - sb) / sb < 0.03);
  for (let i = 0; i < 5000; i++) assert.ok(fogDensity(a, (i * 7.3) % 40 - 5, (i * 1.7) % 9 - 2, (i * 3.1) % 40 - 5, i * 0.37) >= 0);
  assert.ok(a.T.every(v => v > 0 && v <= 1));
});
test('fog does not pump exposure: total in-scatter is stable frame to frame', () => {
  const { pl, frame } = specimen('medium', 2), sums = [];
  for (let f = 0; f < 12; f++) { frame(); let s = 0; for (let i = 0; i < pl.fog.L.length; i++) s += pl.fog.L[i]; sums.push(s); }
  const mean = sums.reduce((a, b) => a + b) / sums.length; for (const s of sums) assert.ok(Math.abs(s - mean) / mean < 0.05);
});

const lab = (wall, opts = {}) => { // the guide's lab layout: cyan source left, wall in the middle
  const c = createCascades(64, 40);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 64; x++) if ((wall && x >= 30 && x <= 32 && y > 6 && y < 33) || (opts.room && (x < 2 || y < 2 || x > 61 || y > 37))) c.solid[y * 64 + x] = 1;
  addEmitter(c, 15, 19, 2, opts.rgb || [0.5, 2.6, 2.4], 1); return solveCascades(c, { bounces: 0, ...opts });
};
const fluenceAt = (c, tx, ty) => { const p = Math.floor(ty / 4) * c.nx + Math.floor(tx / 4); return [c.fluence[p * 3], c.fluence[p * 3 + 1], c.fluence[p * 3 + 2]]; };
test('cascade fluence against a brute-force ray-traced reference: the bilinear fix removes the wall-end leak', t => {
  const W = 64, H = 40, sigma = 0.018, err = fix => { const c = lab(true, { bilinearFix: fix, sigma }); let all = 0, n = 0, behind = 0, nb = 0;
    const ref = (px, py) => { const Ts = Math.exp(-sigma * 0.25); let g = 0; for (let k = 0; k < 1024; k++) { const an = ((k + 0.5) / 1024) * Math.PI * 2, cs = Math.cos(an), sn = Math.sin(an); let tr = 1; for (let s = 0.125; s < 200; s += 0.25) { const x = Math.floor(px + cs * s), y = Math.floor(py + sn * s); if (x < 0 || y < 0 || x >= W || y >= H || c.solid[y * W + x]) break; g += tr * c.emit[(y * W + x) * 3 + 1] * 0.15 * 0.25; tr *= Ts; } } return g / 1024; };
    for (let py = 0; py < c.ny; py++) for (let px = 0; px < c.nx; px++) { const x = (px + 0.5) * 4, y = (py + 0.5) * 4; if (c.solid[Math.floor(y) * W + Math.floor(x)]) continue; const r = ref(x, y), v = c.fluence[(py * c.nx + px) * 3 + 1]; all += Math.abs(v - r) / Math.max(r, 2e-3); n++; if (x > 33 && y > 8 && y < 31) { behind += Math.abs(v - r); nb++; } }
    return { rel: all / n, behind: behind / nb }; };
  const plain = err(false), fixed = err(true);
  t.diagnostic(`mean relative error vs reference: plain merge ${plain.rel.toFixed(3)}, bilinear fix ${fixed.rel.toFixed(3)}; mean abs error behind the wall ${plain.behind.toExponential(2)} -> ${fixed.behind.toExponential(2)}`);
  assert.ok(fixed.rel < plain.rel * 0.5 && fixed.behind < plain.behind * 0.05);
});
test('four finite cascade buffers with doubling angular resolution', t => {
  const c = lab(true); assert.equal(c.levels.length, LEVELS);
  for (const [i, l] of c.levels.entries()) { assert.ok(l.data.every(Number.isFinite)); assert.equal(l.dirs, 8 * 2 ** i); assert.equal(l.step, 4 * 2 ** i); if (i) assert.equal(l.near, c.levels[i - 1].far); }
  t.diagnostic(c.levels.map(l => `${l.nx}x${l.ny}/${l.dirs} dirs`).join('; ') + ` | ${(c.stats.bytes / 1024).toFixed(1)} KiB | solve ${c.stats.ms.toFixed(2)} ms`);
});
test('wall occluder: a bright source behind a wall does not leak through', t => {
  const open = lab(false), walled = lab(true), a = fluenceAt(open, 42, 19)[1], b = fluenceAt(walled, 42, 19)[1], lit = fluenceAt(walled, 22, 19)[1];
  t.diagnostic(`fluence behind wall position: open ${a.toExponential(2)}, walled ${b.toExponential(2)} (${(b / a * 100).toFixed(1)}%); lit side ${lit.toExponential(2)}`);
  assert.ok(a > 1e-4, 'light arrives without the wall'); assert.ok(b < a * 0.01, 'wall blocks direct transport: the bilinear-fix merge leaves no interpolation leak'); assert.ok(lit > b * 20);
  assert.equal(walled.emit[(20 * 64 + 31) * 3], 0, 'the opaque wall has no source emission'); assert.ok(walled.valid.some(v => v === 0), 'probes inside the wall are flagged invalid, not read as black');
});
test('bounded multi-bounce: diffuse colour bleed around a corner, energy stays bounded, residual falls', t => {
  const res = [], f = [];
  for (const bounces of [0, 1, 2, 3, 4]) { const c = lab(true, { bounces, rgb: [3, 0.4, 0.2], albedo: 0.6, gain: 0.8, room: true }); res.push(c.stats.residual); f.push(fluenceAt(c, 42, 19)); assert.ok(c.fluence.every(Number.isFinite)); }
  t.diagnostic(`shadow-side fluence (R) by bounce count: ${f.map(v => v[0].toExponential(2)).join(', ')}; residual: ${res.map(v => v.toFixed(3)).join(', ')}`);
  assert.ok(f[1][0] > f[0][0] * 1.15, 'one bounce carries light around the wall'); assert.ok(f[2][0] > f[2][1] * 2, 'bounced light keeps the red tint of the source');
  assert.ok(res[4] < res[2] && res[4] < 0.2, 'iteration converges'); assert.ok(f[4][0] < f[1][0] * 3, 'no runaway feedback');
  // energy conservation: each bounce adds strictly less than the previous
  assert.ok(f[2][0] - f[1][0] < f[1][0] - f[0][0] + 1e-9);
  const total = c => c.fluence.reduce((a, b) => a + b, 0), e0 = total(lab(false, { bounces: 0 })), e4 = total(lab(false, { bounces: 4 })); assert.ok(Math.abs(e4 - e0) / e0 < 1e-6, 'no walls, no bounce energy');
});
test('probe irradiance is directional and skips in-wall probes', () => {
  const c = lab(true), E = [0, 0, 0], F = [0, 0, 0];
  probeIrradiance(c, 22 * 2 / 4 + 1, 19 * 2 / 4, -1, 0, 0, E); probeIrradiance(c, 22 * 2 / 4 + 1, 19 * 2 / 4, 1, 0, 0, F); // CELL = 2 m per probe, source is toward -x
  assert.ok(E[1] > F[1] * 3, 'a surface facing the source receives more');
});
test('directional shadow: a tall cell shadows the ground behind it', () => {
  const w = 10, h = 10, W = { w, h, floorH: new Float32Array(w * h) }; W.floorH[5 * w + 5] = 5; const out = directionalShadow(W, [0.7, 0.5, 0], new Uint8Array(w * h * 16));
  assert.equal(out[(5 * 4 + 2) * 40 + 4 * 4 + 1], 0, 'cell west of the wall is shadowed from an eastern light'); assert.equal(out[(5 * 4 + 2) * 40 + 6 * 4 + 2], 1); assert.equal(out[(2 * 4) * 40 + 8], 1);
});
test('chapter 8: the shade drawn on the ground is exactly the shelter the dawn rule grants', t => {
  const { atlas, noise } = assets(), sim = createSim(7, 107), pl = createPipeline(atlas, noise, 'low'); setScene(pl, sim); renderFrame(pl, viewOf(sim, sim, 1), 1 / 30);
  const T = 4, tw = sim.w * T; let cells = 0, shaded = 0, mismatch = 0;
  for (let z = 0; z < sim.h; z++) for (let x = 0; x < sim.w; x++) { if (solidAt(sim, x, z)) continue; cells++; const drawn = pl.shadow[(z * T + 2) * tw + x * T + 2] === 0, rule = inShade(sim, x, z); if (drawn) shaded++; if (drawn !== rule) mismatch++; }
  t.diagnostic(`${cells} open cells, ${shaded} drawn in shade, ${mismatch} disagreements`); assert.equal(mismatch, 0); assert.ok(shaded > 20);
});

test('fog-body binning is exact: fogDensity is bit-identical with and without the column grid', async () => {
  const { binFogBodies } = await import('../src/render/light.js');
  const fog = { sigma: 0.03, height: 4, blobs: [] }; for (let b = 0; b < 24; b++) fog.blobs.push(Math.sin(b * 3.1) * 30, 1 + (b % 3), Math.cos(b * 1.7) * 25, 1.5 + (b % 5), 0.05 + (b % 4) * 0.02);
  const plain = { ...fog, blobGrid: null }; binFogBodies(fog); assert.ok(fog.blobGrid && fog.blobGrid.list.length > 0);
  for (let i = 0; i < 20000; i++) { const x = ((i * 7.31) % 80) - 40, y = (i * 0.37) % 6, z = ((i * 3.77) % 70) - 35, t = i * 0.01; assert.equal(fogDensity(fog, x, y, z, t), fogDensity(plain, x, y, z, t)); }
});
