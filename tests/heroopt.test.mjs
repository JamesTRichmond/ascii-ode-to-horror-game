// Guide task 3-3: offline differentiable asset optimisation (src/render/heroopt.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assets, root } from './helpers.mjs';
import { glyphBitmaps, heroProblem, optimiseHero } from '../src/render/heroopt.js';

const { atlas, atlasPx } = assets();
const ascii = []; for (let cp = 33; cp < 127; cp++) { const g = atlas.byCodepoint.get(cp); if (g !== undefined) ascii.push(g); }
const cand = [-1, ...ascii.slice(0, 40)], cw = 8, ch = 12, B = glyphBitmaps(atlas, atlasPx, cand, cw, ch);
const shapes = (cols, rows) => { const W = cols * cw, H = rows * ch, T = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const ring = Math.abs(Math.hypot(x - W * 0.3, (y - H * 0.5) * 1.1) - H * 0.33) < 3, diag = Math.abs(x - W * 0.55 - y * 0.9) < 2.2 && x > W * 0.5; T[y * W + x] = ring || diag ? 0.9 : x > W * 0.8 ? (y / H) * 0.5 : 0; } return T; };

test('glyph bitmaps come from the MSDF atlas: blank is empty, "@" is denser than "."', () => {
  const [blank, dot, at] = [cand.indexOf(-1), cand.indexOf(atlas.byCodepoint.get(46)), cand.indexOf(atlas.byCodepoint.get(64))], P = cw * ch, sum = i => B.slice(i * P, (i + 1) * P).reduce((a, b) => a + b, 0);
  assert.equal(sum(blank), 0); assert.ok(dot > 0 && at > 0 && sum(at) > 3 * sum(dot), `${sum(at)} vs ${sum(dot)}`);
});
test('the rasteriser is differentiable: analytic gradient matches central finite differences', () => {
  const cols = 3, rows = 2, T = shapes(cols, rows), G = cand.length, pr = heroProblem(T, cols, rows, cw, ch, B, G, { sigma: 1.2, detail: 0.25 }), th = new Float32Array(cols * rows * G), g = new Float32Array(th.length);
  for (let i = 0; i < th.length; i++) th[i] = Math.sin(i * 1.7) * 0.5; pr.grad(th, 0.4, g);
  let worst = 0; for (const i of [0, 7, 41, 63, 100, 150, th.length - 1]) { const h = 1e-3, o = th[i]; th[i] = o + h; const a = pr.loss(th, 0.4); th[i] = o - h; const b = pr.loss(th, 0.4); th[i] = o; const fd = (a - b) / (2 * h); worst = Math.max(worst, Math.abs(fd - g[i]) / Math.max(1e-9, Math.abs(fd) + Math.abs(g[i]))); }
  assert.ok(worst < 0.02, `relative gradient error ${worst}`);
});
test('optimisation lowers the perceptual loss below per-cell greedy matching; the discrete export matches the relaxed result', t => {
  const cols = 16, rows = 8, r1 = optimiseHero(shapes(cols, rows), cols, rows, cw, ch, B, cand.length, { iterations: 120, sigma: 1.6, detail: 0.15 }), r2 = optimiseHero(shapes(cols, rows), cols, rows, cw, ch, B, cand.length, { iterations: 120, sigma: 1.6, detail: 0.15 });
  t.diagnostic(`greedy ${r1.greedyLoss.toExponential(3)}, relaxed ${r1.relaxedLoss.toExponential(3)}, discrete ${r1.discreteLoss.toExponential(3)}: ${((1 - r1.discreteLoss / r1.greedyLoss) * 100).toFixed(1)} % better, ${r1.ids.filter((v, i) => v !== r1.greedyIds[i]).length} of ${r1.ids.length} cells changed`);
  assert.ok(r1.discreteLoss < r1.greedyLoss * 0.97, 'at least 3 % better than greedy'); assert.ok(Math.abs(r1.discreteLoss / r1.relaxedLoss - 1) < 0.02, 'annealing closes the relaxed-to-discrete gap');
  assert.ok(r1.history[r1.history.length - 1] < r1.history[0]); assert.deepEqual([...r1.ids], [...r2.ids], 'deterministic');
});
test('the exported hero asset is a valid glyph grid and records its comparison', () => {
  const j = JSON.parse(fs.readFileSync(path.join(root, 'assets/hero/specimen.json'), 'utf8'));
  assert.equal(j.glyphs.length, j.rows); assert.ok(j.glyphs.every(r => [...r].length === j.cols)); assert.equal(j.codepoints.length, j.cols * j.rows);
  assert.ok(j.loss.discrete <= j.loss.greedy && Math.abs(j.loss.discrete / j.loss.relaxed - 1) < 0.02); assert.equal(j.atlasVersion, atlas.version);
});
