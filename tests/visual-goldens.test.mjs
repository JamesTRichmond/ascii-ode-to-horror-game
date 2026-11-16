// Visual regression: all nine chapters in both camera modes, headless, through the full CPU pipeline and reference
// compositor. After an intended visual change: node tools/goldens.mjs --write, then review tests/golden/visual/*.png
// in the PR.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { renderChapter, chapterCount, compare } from '../tools/lib/goldens.mjs';
import { MAE_LIMIT, OFF_LIMIT, CAMERAS, goldenName } from '../tools/goldens.mjs';
import { decodePNG } from '../tools/lib/png.mjs';

const golden = (i, camera = 'first') => decodePNG(fs.readFileSync(path.join(root, 'tests/golden/visual', goldenName(i, camera))));
for (const camera of CAMERAS) test(`every chapter renders within tolerance of its ${camera} golden image`, t => {
  for (let i = 0; i < chapterCount(); i++) {
    const r = renderChapter(i, null, camera), g = golden(i, camera); assert.equal(g.w, r.w); assert.equal(g.h, r.h);
    const c = compare(r.rgb, g.pixels, r.w, r.h); t.diagnostic(`chapter ${i + 1} (${camera}): mae ${c.mae.toFixed(3)}, off ${(c.offShare * 100).toFixed(2)} %`);
    assert.ok(c.mae <= MAE_LIMIT && c.offShare <= OFF_LIMIT, `chapter ${i + 1} (${camera}) changed visibly (run node tools/goldens.mjs for diff images)`);
  }
});
test('the dimetric goldens show the singer near the centre of the frame (the player figure is in the scene)', t => {
  for (let i = 0; i < chapterCount(); i++) {
    const r = renderChapter(i, null, 'dimetric'), x0 = Math.floor(r.w * 0.3), x1 = Math.ceil(r.w * 0.7), y0 = Math.floor(r.h * 0.3), y1 = Math.ceil(r.h * 0.7);
    let lit = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const k = (y * r.w + x) * 3; if (r.rgb[k] + r.rgb[k + 1] + r.rgb[k + 2] > 90) lit++; }
    t.diagnostic(`chapter ${i + 1}: ${lit} lit pixels in the central window`); assert.ok(lit > 200, `chapter ${i + 1}: the singer and their lantern light should be visible near the centre`);
  }
});
test('the check is sensitive: a 15 % exposure change or a shifted camera is caught, and the diff marks it', t => {
  for (const [name, mutate] of [['exposure x1.15', pl => { pl.opts.exposure = 1.15; }], ['camera nudged', (pl, sim) => { sim.p.x += 300; }]]) {
    const r = renderChapter(2, mutate), g = golden(2), c = compare(r.rgb, g.pixels, r.w, r.h); t.diagnostic(`${name}: mae ${c.mae.toFixed(2)}, off ${(c.offShare * 100).toFixed(2)} %`);
    assert.ok(c.mae > MAE_LIMIT || c.offShare > OFF_LIMIT, name);
    let marked = 0; for (let k = 0; k < r.w * r.h; k++) if (c.diff[k * 3] !== c.diff[k * 3 + 1]) marked++; assert.ok(marked > 0);
  }
});
