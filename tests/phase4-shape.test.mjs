// Nocturne phase 4 acceptance — shape matching and surface flow.
// Fixture: "Verify a vertical edge produces a vertical tangent, opposite directions align, and an
//           isotropic tensor yields zero confidence. Inspect the scene's tangent and normal views."
import test from 'node:test';
import assert from 'node:assert/strict';
import { specimen, assets } from './helpers.mjs';
import { tensorTangent, signAlign, createFlow, computeFlow, clampJacobian, singularValues, projectDirection, CELL_W, CELL_H } from '../src/render/flow.js';
import { createGBuffer, makeCamera, setCamera, octEncode } from '../src/render/gbuffer.js';
import { shapeError } from '../src/render/select.js';
import { optimizeFrame } from '../src/render/optimize.js';
import { debugImage } from '../src/render/output_cpu.js';
import { DESCRIPTOR_DIMS } from '../src/shared/descriptor.js';
import { MATERIALS } from '../src/shared/materials.js';

test('vertical edge -> vertical tangent; antiparallel tangents align; isotropic tensor has zero coherence', () => {
  const v = tensorTangent(4, 0, 0, [0, 0, 0]); assert.ok(Math.abs(v[0]) < 1e-10 && Math.abs(Math.abs(v[1]) - 1) < 1e-10, 'tangent is orthogonal to the gradient'); assert.ok(v[2] > 0.999);
  const hEdge = tensorTangent(0, 0, 4, [0, 0, 0]); assert.ok(Math.abs(hEdge[1]) < 1e-10);
  assert.equal(signAlign(1, 0, -1, 0), -1); assert.equal(signAlign(1, 0, 0.9, 0.1), 1);
  assert.ok(tensorTangent(1, 0, 1, [0, 0, 0])[2] < 1e-5); assert.equal(tensorTangent(0, 0, 0, [0, 0, 0])[2], 0);
});
// Synthetic surface facing the camera. tanFn(x, y) gives the authored tangent as a screen direction [sx, sy];
// with this camera (yaw 0) world tangent (0, -sy, sx) projects to screen (sx, sy). Default: screen +x everywhere.
function synthetic(lumFn, w = 160, h = 120, tanFn = () => [1, 0]) {
  const gb = createGBuffer(w, h), cam = setCamera(makeCamera(w, h), 0, 1.6, 0, 0); gb.depth.fill(6); gb.material.fill(1);
  for (let i = 0; i < w * h; i++) { const x = i % w, y = (i / w) | 0, [sx, sy] = tanFn(x, y), l = Math.hypot(sx, sy) || 1; gb.lum[i] = lumFn(x, y); octEncode(1, 0, 0, gb.normal, i * 2); octEncode(0, -sy / l, sx / l, gb.tangent, i * 2); }
  return { gb, cam, fl: createFlow(w, h) };
}
test('scene encoder: a vertical luminance edge yields vertical flow at the edge; flat regions fall back to the authored tangent', () => {
  const { gb, cam, fl } = synthetic(x => (x < 80 ? 0.1 : 0.9)); computeFlow(fl, gb, cam, { etfIterations: 0, tensorWeight: 1 });
  const at = (px, py) => Math.min(fl.gh - 1, (py / CELL_H) | 0) * fl.gw + (px >> 1), e = at(80, 60), f = at(20, 60);
  assert.ok(Math.abs(fl.ty[e]) > 0.99 && fl.coh[e] > 0.9, 'tensor tangent is vertical on the edge'); assert.ok(Math.abs(fl.fy[e]) > 0.9, 'blended flow follows it');
  assert.ok(fl.coh[f] < 0.05, 'flat region has no confidence'); assert.ok(Math.abs(fl.fx[f]) > 0.99 && Math.abs(fl.fy[f]) < 0.05, 'stable authored fallback');
});
test('ETF on a rotating field (concentric rings): no 180-degree sign seams, and smoother than Sobel-only', t => {
  const rings = (x, y) => 0.5 + 0.4 * Math.sin(Math.hypot(x - 80, y - 60) * 0.55), ccw = (x, y) => [-(y - 60), x - 80], run = iters => { const s = synthetic(rings, 160, 120, ccw); /* authored tangents oriented consistently around the rings, as on a real surface */ computeFlow(s.fl, s.gb, s.cam, { etfIterations: iters, tensorWeight: 1 }); return s.fl; };
  const measure = fl => { let seams = 0, n = 0, rough = 0, tang = 0; for (let cy = 4; cy < fl.gh - 4; cy++) for (let cx = 4; cx < fl.gw - 4; cx++) {
    const i = cy * fl.gw + cx, rx = cx * CELL_W + 1 - 80, ry = cy * CELL_H + 1 - 60, r = Math.hypot(rx, ry); if (r < 12) continue;
    const dotX = fl.fx[i] * fl.fx[i + 1] + fl.fy[i] * fl.fy[i + 1], dotY = fl.fx[i] * fl.fx[i + fl.gw] + fl.fy[i] * fl.fy[i + fl.gw], d = Math.abs(dotX); if (dotX < -0.5 || dotY < -0.5) seams++; rough += 1 - d; tang += Math.abs((fl.fx[i] * -ry + fl.fy[i] * rx) / r); n++; }
    return { seams: seams / n, rough: rough / n, tangential: tang / n }; };
  const sobel = measure(run(0)), etf = measure(run(3)); t.diagnostic(`Sobel-only ${JSON.stringify(sobel)} | ETF x3 ${JSON.stringify(etf)}`);
  assert.ok(etf.seams < 0.01, 'unoriented lines never flip against their neighbours'); assert.ok(etf.rough <= sobel.rough + 1e-9, 'ETF does not roughen the field'); assert.ok(etf.tangential > 0.9, 'flow runs along the rings');
});
test('LIC integrates noise along the flow: correlation is higher along the tangent than across it', () => {
  const { gb, cam, fl } = synthetic(() => 0.5); computeFlow(fl, gb, cam, { noise: assets().noise, licSteps: 6 });
  let along = 0, across = 0, n = 0; for (let cy = 8; cy < fl.gh - 8; cy++) for (let cx = 8; cx < fl.gw - 8; cx++) { const i = cy * fl.gw + cx; along += Math.abs(fl.lic[i] - fl.lic[i + 1]); across += Math.abs(fl.lic[i] - fl.lic[i + fl.gw]); n++; }
  assert.ok(along / n < (across / n) * 0.75, `along ${along / n} vs across ${across / n}`); assert.ok(fl.lic.every(v => v >= 0 && v <= 1));
});

test('6/12/24-D descriptors: self-match rate, error and selection cost', t => {
  const { atlas } = assets(), rows = [];
  for (const d of DESCRIPTOR_DIMS) {
    const table = atlas.desc[d], cand = atlas.dict[2], v = new Float32Array(d); let self = 0, err = 0; const t0 = performance.now();
    for (let rep = 0; rep < 60; rep++) for (const g of cand) { for (let k = 0; k < d; k++) v[k] = table[g * d + k] + (((g * 31 + k * 17 + rep * 7) % 13) - 6) * 0.004; let best = 1e9, bi = -1; for (const c of cand) { const e = shapeError(v, table, c, d); if (e < best) { best = e; bi = c; } } if (bi === g) self++; err += best; }
    const n = 60 * cand.length; rows.push({ dims: d, selfMatch: +(self / n).toFixed(3), meanError: +(err / n).toExponential(2), usPerLeaf: +(((performance.now() - t0) * 1000) / n).toFixed(2), candidates: cand.length });
  }
  t.diagnostic(JSON.stringify(rows));
  assert.ok(rows[2].selfMatch >= rows[0].selfMatch, 'more dimensions never identify glyphs worse'); assert.ok(rows[2].selfMatch > 0.9); assert.ok(rows[0].selfMatch > 0.5);
});
test('thin legs stay connected: leg leaves emit glyphs in every micro-cell along the limb', () => {
  const { pl } = specimen('high', 3), gb = pl.gb, sel = pl.sel, has = new Uint8Array(pl.flow.gw * pl.flow.gh);
  for (let n = 0; n < sel.stats.emitted; n++) if (sel.matOf[n] === 1) has[Math.min(pl.flow.gh - 1, (sel.inst[n * 11 + 1] / CELL_H) | 0) * pl.flow.gw + Math.min(pl.flow.gw - 1, sel.inst[n * 11] >> 1)] = 1;
  let fur = 0, covered = 0; for (let cy = 1; cy < pl.flow.gh - 1; cy++) for (let cx = 1; cx < pl.flow.gw - 1; cx++) {
    let all = true; for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) if (gb.material[(cy * 3 + y) * gb.w + cx * 2 + x] !== 1) all = false; if (!all) continue; fur++;
    let near = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near |= has[(cy + dy) * pl.flow.gw + cx + dx]; if (near) covered++; }
  assert.ok(fur > 800 && covered / fur > 0.97, `${covered}/${fur} fur cells have a glyph within one cell`);
});
test('limb edges and tips: partially covered micro-cells keep a creature glyph (low and high tiers)', t => {
  const rows = [];
  for (const q of ['low', 'high']) {
    const { pl } = specimen(q, 3), gb = pl.gb, sel = pl.sel, gw = pl.flow.gw, gh = pl.flow.gh, has = new Uint8Array(gw * gh);
    for (let n = 0; n < sel.count; n++) if (sel.matOf[n] === 1) has[Math.min(gh - 1, (sel.inst[n * 11 + 1] / CELL_H) | 0) * gw + Math.min(gw - 1, sel.inst[n * 11] >> 1)] = 1;
    let partial = 0, own = 0, near = 0;
    for (let cy = 1; cy < gh - 1; cy++) for (let cx = 1; cx < gw - 1; cx++) {
      let f = 0; for (let y = 0; y < CELL_H; y++) for (let x = 0; x < CELL_W; x++) if (gb.material[(cy * CELL_H + y) * gb.w + cx * CELL_W + x] === 1) f++;
      if (f === 0 || f === CELL_W * CELL_H) continue; partial++; if (has[cy * gw + cx]) own++;
      let nb = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) nb |= has[(cy + dy) * gw + cx + dx]; if (nb) near++;
    }
    rows.push(`${q}: ${partial} partial cells, own ${(own / partial * 100).toFixed(1)}%, within one ${(near / partial * 100).toFixed(1)}%`);
    assert.ok(partial > 200, 'the specimen has limb edges'); assert.equal(near, partial, 'no gap along a limb: every partial cell has a creature glyph within one cell'); assert.ok(own / partial > 0.95, 'nearly every partial cell carries its own glyph');
  }
  t.diagnostic(rows.join(' | '));
});

test('Jacobian warp: singular values are clamped at grazing angles; well-conditioned frames are untouched', () => {
  for (let i = 0; i < 500; i++) { const a = i * 0.713, m = [Math.cos(a) * (0.01 + (i % 7) * 0.4), -Math.sin(a) * ((i % 5) * 0.5), Math.sin(a) * (0.01 + (i % 7) * 0.4), Math.cos(a) * ((i % 5) * 0.5)]; clampJacobian(m, 0.45, 1.25); const [s1, s2] = singularValues(m); assert.ok(s1 <= 1.25 + 1e-9 && s2 >= 0.45 - 1e-9 && m.every(Number.isFinite), `sv ${s1}, ${s2}`); }
  const ok = [0.9, -0.2, 0.25, 0.8], copy = ok.slice(); clampJacobian(ok, 0.45, 1.25); for (let k = 0; k < 4; k++) assert.ok(Math.abs(ok[k] - copy[k]) < 1e-9);
  const cam = setCamera(makeCamera(480, 270), 0, 1.6, 0, 0), D = projectDirection(cam, 240, 135, 5, 0, 0, 1, [0, 0]); assert.ok(Math.abs(D[0] - cam.f / 5) < 1e-6 && Math.abs(D[1]) < 1e-9, 'fronto-parallel: f/d pixels per metre');
  const G = projectDirection(cam, 240, 200, 5, 1, 0, 0, [0, 0]); assert.ok(Math.hypot(G[0], G[1]) < cam.f / 5 * 0.5, 'a direction receding from the camera is foreshortened');
});
test('surface attachment in the real scene: floor glyphs are foreshortened but bounded; glyph sizes stay finite', t => {
  const { pl } = specimen('high', 3), sel = pl.sel; let minR = 9, maxR = 0, n = 0;
  for (let i = 0; i < sel.stats.emitted; i++) { const o = i * 11, mt = MATERIALS[sel.matOf[i]]; if (!mt.warp || sel.matOf[i] === 0) continue; const ax = Math.hypot(sel.inst[o + 2], sel.inst[o + 3]), by = Math.hypot(sel.inst[o + 4], sel.inst[o + 5]); assert.ok(Number.isFinite(ax) && Number.isFinite(by) && ax > 0.3 && by > 0.3); const r = by / ax; minR = Math.min(minR, r); maxR = Math.max(maxR, r); n++; }
  t.diagnostic(`${n} warped glyphs, height/width axis ratio ${minR.toFixed(2)}..${maxR.toFixed(2)}`); assert.ok(n > 1000 && maxR / minR < 12);
});
test('tangent and normal debug views are populated', () => {
  const { pl } = specimen('medium', 2), img = new Uint8ClampedArray(pl.w * pl.h * 4);
  for (const mode of ['normals', 'tangents', 'flow', 'lic', 'depth', 'radiance', 'material', 'velocity', 'leaves', 'switch']) { debugImage(img, pl, mode); let nz = 0; for (let i = 0; i < img.length; i += 4) if (img[i] + img[i + 1] + img[i + 2] > 24) nz++; assert.ok(nz > (mode === 'switch' ? -1 : 500), mode); }
});
test('relaxation diagnostic (guide task 3-3 is not implemented): the annealed distribution collapses onto the per-leaf export, deterministically', t => {
  const a = specimen('high', 3), b = specimen('high', 3), ra = optimizeFrame(a.pl.sel, a.atlas), rb = optimizeFrame(b.pl.sel, b.atlas);
  t.diagnostic(ra.steps.map(s => `T=${s.temperature}: coverage RMS ${s.coverageRms.toFixed(4)}, descriptor RMS ${s.descriptorRms.toFixed(4)}, entropy ${s.entropy.toFixed(3)}`).join(' | '));
  assert.equal(ra.hash, rb.hash, 'replay produces identical discrete IDs');
  const last = ra.steps.at(-1), first = ra.steps[0]; assert.ok(last.coverageRms < first.coverageRms && last.coverageRms < 0.02, 'measured tolerance'); assert.ok(last.entropy < first.entropy);
});
