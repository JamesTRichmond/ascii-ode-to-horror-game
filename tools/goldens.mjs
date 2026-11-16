#!/usr/bin/env node
// Visual goldens. Usage: node tools/goldens.mjs [--write]
// --write renders every chapter in both camera modes and stores tests/golden/visual/chapter-N.png (first person) and
// chapter-N-dimetric.png (do this only for an intended visual change, and review the images). Without --write it
// compares and writes diff images for failures to tests/golden/visual/out/ (ignored by git).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderChapter, chapterCount, compare } from './lib/goldens.mjs';
import { encodePNG, decodePNG } from './lib/png.mjs';

export const MAE_LIMIT = 0.35, OFF_LIMIT = 0.0025; // frames are dark: a 15 % exposure change moves the mean by only ~0.9 levels
export const CAMERAS = ['first', 'dimetric'];
/** Golden file name for a chapter index and camera mode: chapter-N.png (first person) or chapter-N-dimetric.png. */
export const goldenName = (i, camera) => `chapter-${i + 1}${camera === 'first' ? '' : `-${camera}`}.png`;
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests/golden/visual');
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const write = process.argv.includes('--write'); fs.mkdirSync(dir, { recursive: true }); let bad = 0;
  for (const camera of CAMERAS) for (let i = 0; i < chapterCount(); i++) {
    const r = renderChapter(i, null, camera), name = goldenName(i, camera), file = path.join(dir, name), label = `chapter ${i + 1} (${camera})`;
    if (write) { fs.writeFileSync(file, encodePNG(r.w, r.h, r.rgb, 3)); console.log(`wrote ${name} (${r.w}x${r.h}, ${r.glyphs} glyphs)`); continue; }
    const g = decodePNG(fs.readFileSync(file)), c = compare(r.rgb, g.pixels, r.w, r.h), ok = c.mae <= MAE_LIMIT && c.offShare <= OFF_LIMIT;
    console.log(`${label}: mae ${c.mae.toFixed(3)}, off ${(c.offShare * 100).toFixed(2)} % ${ok ? 'ok' : 'CHANGED'}`);
    if (!ok) { bad++; fs.mkdirSync(path.join(dir, 'out'), { recursive: true }); fs.writeFileSync(path.join(dir, 'out', name.replace('.png', '-diff.png')), encodePNG(r.w, r.h, c.diff, 3)); fs.writeFileSync(path.join(dir, 'out', name.replace('.png', '-now.png')), encodePNG(r.w, r.h, r.rgb, 3)); }
  }
  if (bad) { console.error(`${bad} chapter(s) changed; see tests/golden/visual/out/`); process.exit(1); }
}
