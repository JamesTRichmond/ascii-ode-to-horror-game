// Visual regression: all nine chapters, headless, through the full CPU pipeline and reference compositor.
// After an intended visual change: node tools/goldens.mjs --write, then review tests/golden/visual/*.png in the PR.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { renderChapter, chapterCount, compare } from '../tools/lib/goldens.mjs';
import { MAE_LIMIT, OFF_LIMIT } from '../tools/goldens.mjs';
import { decodePNG } from '../tools/lib/png.mjs';

const golden = i => decodePNG(fs.readFileSync(path.join(root, `tests/golden/visual/chapter-${i + 1}.png`)));
test('every chapter renders within tolerance of its golden image', t => {
  for (let i = 0; i < chapterCount(); i++) {
    const r = renderChapter(i), g = golden(i); assert.equal(g.w, r.w); assert.equal(g.h, r.h);
    const c = compare(r.rgb, g.pixels, r.w, r.h); t.diagnostic(`chapter ${i + 1}: mae ${c.mae.toFixed(3)}, off ${(c.offShare * 100).toFixed(2)} %`);
    assert.ok(c.mae <= MAE_LIMIT && c.offShare <= OFF_LIMIT, `chapter ${i + 1} changed visibly (run node tools/goldens.mjs for diff images)`);
  }
});
test('the check is sensitive: a 15 % exposure change or a shifted camera is caught, and the diff marks it', t => {
  for (const [name, mutate] of [['exposure x1.15', pl => { pl.opts.exposure = 1.15; }], ['camera nudged', (pl, sim) => { sim.p.x += 300; }]]) {
    const r = renderChapter(2, mutate), g = golden(2), c = compare(r.rgb, g.pixels, r.w, r.h); t.diagnostic(`${name}: mae ${c.mae.toFixed(2)}, off ${(c.offShare * 100).toFixed(2)} %`);
    assert.ok(c.mae > MAE_LIMIT || c.offShare > OFF_LIMIT, name);
    let marked = 0; for (let k = 0; k < r.w * r.h; k++) if (c.diff[k * 3] !== c.diff[k * 3 + 1]) marked++; assert.ok(marked > 0);
  }
});
