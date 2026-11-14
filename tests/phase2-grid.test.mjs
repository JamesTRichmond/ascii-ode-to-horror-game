// Nocturne phase 2 acceptance — G-buffer contract and budgeted adaptive subdivision.
// Fixture: "Rasterize the leaf rectangles into a coverage counter. Every viewport pixel must
//           equal one; foreground and background must receive different leaf sizes."
import test from 'node:test';
import assert from 'node:assert/strict';
import { specimen } from './helpers.mjs';
import { createGBuffer, makeCamera, setCamera, traceWorld, worldVelocity, octEncode, octDecode, project, unproject, FAR, CELL } from '../src/render/gbuffer.js';
import { createQuadtree, subdivide, MAX_LEVEL } from '../src/render/quadtree.js';
import { step, packInput, IN } from '../src/sim/sim.js';

const flatWorld = (w, h, wallZ) => { const n = w * h, W = { w, h, floorH: new Float32Array(n), ceilH: new Float32Array(n).fill(FAR), floorMat: new Uint8Array(n).fill(7), wallMat: new Uint8Array(n).fill(2), ceilMat: new Uint8Array(n).fill(2) }; for (let x = 0; x < w; x++) W.floorH[wallZ * w + x] = 3; return W; };
function coverage(qt, w, h) { const c = new Uint8Array(w * h); for (let l = 0; l < qt.count; l++) for (let y = qt.ly[l]; y < qt.ly[l] + qt.lh[l]; y++) for (let x = qt.lx[l]; x < qt.lx[l] + qt.lw[l]; x++) c[y * w + x]++; return c; }

test('octahedral normal encoding round-trips within 0.1 degrees', () => {
  const enc = new Int16Array(2), out = [0, 0, 0]; let worst = 1;
  for (let i = 0; i < 4000; i++) { const z = 1 - (2 * (i + 0.5)) / 4000, r = Math.sqrt(1 - z * z), a = i * 2.39996323, v = [Math.cos(a) * r, z, Math.sin(a) * r]; octEncode(v[0], v[1], v[2], enc, 0); octDecode(enc, 0, out); worst = Math.min(worst, v[0] * out[0] + v[1] * out[1] + v[2] * out[2]); }
  assert.ok(Math.acos(Math.min(1, worst)) * 57.3 < 0.1, `worst error ${Math.acos(worst) * 57.3} deg`);
});
test('depth is metric: a wall 7 m ahead reads 7 m; the floor matches the analytic plane', () => {
  const gb = createGBuffer(320, 180), cam = makeCamera(320, 180), W = flatWorld(8, 12, 8); // wall face at z = 16 m
  setCamera(cam, 8, 1.6, 9, Math.PI / 2); traceWorld(gb, W, cam);
  const c = 90 * 320 + 160; assert.ok(Math.abs(gb.depth[c - 320 * 10] - 7) < 1e-4, `wall depth ${gb.depth[c - 3200]}`); assert.equal(gb.material[c - 3200], 2);
  const y = 150, i = y * 320 + 160, expected = (1.6 * cam.f) / (y + 0.5 - cam.cy); assert.ok(Math.abs(gb.depth[i] - expected) < 1e-4); assert.equal(gb.material[i], 7);
  const P = unproject(cam, 160.5, y + 0.5, gb.depth[i], [0, 0, 0]); assert.ok(Math.abs(P[1]) < 1e-4, 'floor pixel unprojects onto y = 0');
  const S = project(cam, P[0], P[1], P[2], [0, 0, 0]); assert.ok(Math.abs(S[0] - 160.5) < 1e-3 && Math.abs(S[1] - (y + 0.5)) < 1e-3);
  assert.equal(gb.depth[0], FAR, 'sky is far'); assert.equal(gb.material[0], 0);
});
test('velocity is current minus previous screen position: moving-camera reprojection matches static geometry', () => {
  const gb = createGBuffer(320, 180), prevGb = createGBuffer(320, 180), cam = makeCamera(320, 180), prev = makeCamera(320, 180), W = flatWorld(8, 12, 8);
  setCamera(prev, 8, 1.6, 9, Math.PI / 2 - 0.03); traceWorld(prevGb, W, prev);
  setCamera(cam, 8.25, 1.6, 9.3, Math.PI / 2 + 0.02); traceWorld(gb, W, cam); worldVelocity(gb, cam, prev);
  let ok = 0, n = 0; const P = [0, 0, 0], Q = [0, 0, 0];
  for (let y = 4; y < 176; y += 3) for (let x = 4; x < 316; x += 3) {
    const i = y * 320 + x; if (gb.depth[i] >= FAR) continue; const px = x + 0.5 - gb.velocity[i * 2], py = y + 0.5 - gb.velocity[i * 2 + 1]; if (px < 1 || py < 1 || px >= 319 || py >= 179) continue;
    const j = (py | 0) * 320 + (px | 0); if (prevGb.material[j] !== gb.material[i]) continue; // disoccluded or edge
    unproject(cam, x + 0.5, y + 0.5, gb.depth[i], P); unproject(prev, px, py, prevGb.depth[j], Q); n++;
    if (Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]) < 0.05 * gb.depth[i] + 0.05) ok++;
  }
  assert.ok(n > 2000 && ok / n > 0.97, `${ok}/${n} reprojected pixels land on the same world point`);
});
test('scene buffers: every channel is finite; radiance is linear HDR (unclamped); memory is reported', t => {
  const { pl } = specimen('high', 2), gb = pl.gb; let maxR = 0;
  for (const ch of ['depth', 'radiance', 'velocity', 'lum']) assert.ok(gb[ch].every(Number.isFinite), ch);
  for (let i = 0; i < gb.radiance.length; i++) { assert.ok(gb.radiance[i] >= 0); if (gb.radiance[i] > maxR) maxR = gb.radiance[i]; }
  assert.ok(maxR > 1, `HDR values above 1 survive (max ${maxR.toFixed(2)})`);
  assert.ok(new Set(gb.material).size >= 5, 'several materials'); assert.ok(new Set(gb.object).size >= 3, 'object identity');
  t.diagnostic(`G-buffer ${gb.w}x${gb.h}: ${(gb.bytes / 1048576).toFixed(2)} MiB (${gb.bytes / (gb.w * gb.h)} B/pixel)`);
});

test('reference fixture: quadtree covers the viewport exactly and the subject gets finer leaves', () => {
  const w = 96, h = 80, gb = createGBuffer(w, h); gb.depth.fill(9); gb.lum.fill(0.1); gb.material.fill(7);
  for (let y = 20; y < 60; y++) for (let x = 20; x < 70; x++) gb.material[y * w + x] = 1;
  const qt = subdivide(createQuadtree(w, h, 4000), gb), cov = coverage(qt, w, h);
  assert.ok(cov.every(v => v === 1), 'every pixel belongs to exactly one leaf');
  const sizes = new Set(); for (let l = 0; l < qt.count; l++) sizes.add(qt.lw[l]); assert.ok(sizes.has(2) && sizes.has(4), 'micro-cells on the subject, coarser cells on the ground');
  for (let l = 0; l < qt.count; l++) if (gb.material[(qt.ly[l] + 1) * w + qt.lx[l]] === 1 && qt.lx[l] > 22 && qt.lx[l] < 66 && qt.ly[l] > 24 && qt.ly[l] < 56) assert.equal(qt.level[l], MAX_LEVEL);
});
test('real scene: exact partition, all subject pixels on micro-leaves (thin legs stay readable)', t => {
  const { pl } = specimen('high', 3), { qt, gb } = pl, cov = coverage(qt, gb.w, gb.h);
  assert.ok(cov.every(v => v === 1)); let subj = 0, fine = 0;
  const levelAt = new Uint8Array(gb.w * gb.h); for (let l = 0; l < qt.count; l++) for (let y = qt.ly[l]; y < qt.ly[l] + qt.lh[l]; y++) levelAt.fill(qt.level[l], y * gb.w + qt.lx[l], y * gb.w + qt.lx[l] + qt.lw[l]);
  for (let i = 0; i < gb.w * gb.h; i++) if (gb.object[i]) { subj++; if (levelAt[i] === MAX_LEVEL) fine++; }
  assert.ok(subj > 3000); assert.equal(fine, subj);
  assert.ok(qt.stats.byLevel[2] > 500 && qt.stats.byLevel[3] > 500, 'two populated leaf scales');
  const keys = new Set(qt.key.subarray(0, qt.count)); assert.equal(keys.size, qt.count, 'Morton keys are unique leaf identities');
  t.diagnostic(`leaves ${qt.count} by level ${JSON.stringify(qt.stats.byLevel)}, capacity ${qt.capacity}`);
});
test('an exhausted leaf budget degrades gracefully: parents are retained, the partition stays exact', () => {
  const { pl } = specimen('high', 1), gb = pl.gb, small = createQuadtree(gb.w, gb.h, 1500);
  subdivide(small, gb); assert.ok(small.count <= 1500); assert.ok(small.stats.overflow > 0, 'overflow is recorded'); assert.ok(coverage(small, gb.w, gb.h).every(v => v === 1));
  for (let f = 0; f < 30; f++) subdivide(small, gb); assert.ok(small.pressure > 1, 'thresholds rise under sustained pressure'); assert.ok(small.count <= 1500);
});
test('split/merge hysteresis: a static camera is stable; slow camera motion does not flicker', t => {
  const s = specimen('high', 12), { pl } = s, nodes = pl.qt.levels.reduce((a, L) => a + L.nx * L.ny, 0); let worst = 0, still = 0;
  for (let f = 0; f < 20; f++) { s.frame(); still = Math.max(still, pl.qt.stats.flips / nodes); }
  t.diagnostic(`static camera, animated scene (fog drift, sway, pulses): worst ${(still * 100).toFixed(3)}% of nodes flip per frame`);
  assert.ok(still < 0.001, 'static camera is stable');
  for (let f = 0; f < 40; f++) { s.tick(packInput(IN.TURNR)); s.frame(); worst = Math.max(worst, pl.qt.stats.flips / nodes); }
  t.diagnostic(`worst per-frame split/merge flips while turning: ${(worst * 100).toFixed(2)}% of nodes`);
  assert.ok(worst < 0.06);
});
