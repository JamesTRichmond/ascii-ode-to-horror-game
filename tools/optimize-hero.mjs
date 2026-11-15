#!/usr/bin/env node
// Offline hero-asset optimisation (guide task 3-3). Usage: node tools/optimize-hero.mjs [cols=56] [rows=20] [iterations=160]
// Renders the canonical specimen scene (furred creature and tall figure on grass before stone) at the high tier,
// takes the creature's tone-mapped luminance (G-buffer object pixels; the set behind it dimmed) as the target, and solves for the glyph grid with the differentiable rasteriser in
// src/render/heroopt.js. Writes the discrete export to assets/hero/specimen.json and a preview strip
// (target | per-cell greedy | optimised) to docs/images/hero-specimen.png.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { specimen, assets } from '../tests/helpers.mjs';
import { glyphBitmaps, optimiseHero } from '../src/render/heroopt.js';
import { encodePNG } from './lib/png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cols = 56, rows = 20, iterations = 160] = process.argv.slice(2).map(Number), cw = 8, ch = 12, W = cols * cw, H = rows * ch;
const { atlas, atlasPx } = assets(), { pl } = specimen('high', 6), g = pl.gb;
// target: luminance of the final radiance, tone-mapped like the renderer and stretched to the 99th percentile
// the hero is the creature itself: G-buffer object pixels keep their shading; the set behind it is dimmed to a hint
const lum = new Float32Array(g.w * g.h); for (let i = 0; i < lum.length; i++) { const Y = 0.2126 * g.radiance[i * 3] + 0.7152 * g.radiance[i * 3 + 1] + 0.0722 * g.radiance[i * 3 + 2]; lum[i] = Math.pow(Y / (1 + Y), 0.65) * (g.object[i] ? 1 : 0.12); }
const sorted = [...lum].sort((a, b) => a - b), lo = sorted[Math.floor(lum.length * 0.02)], hi = sorted[Math.floor(lum.length * 0.995)] || 1, target = new Float32Array(W * H);
const sx = g.w / W, sy = (g.h * 0.92) / H, oy = g.h * 0.04; // keep the frame's aspect, trim a sliver top and bottom
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let yy = Math.floor(oy + y * sy); yy < Math.max(Math.floor(oy + y * sy) + 1, Math.floor(oy + (y + 1) * sy)); yy++) for (let xx = Math.floor(x * sx); xx < Math.max(Math.floor(x * sx) + 1, Math.floor((x + 1) * sx)); xx++) { s += lum[yy * g.w + xx]; n++; } target[y * W + x] = Math.min(1, Math.max(0, (s / n - lo) / (hi - lo))) ** 1.4 * 0.85; } // contrast-stretched; glyphs cannot reach full coverage
// hero alphabet: printable ASCII present in the atlas plus every 4th Braille pattern (fine density steps), and blank
const ascii = []; for (let cp = 33; cp < 127; cp++) { const g = atlas.byCodepoint.get(cp); if (g !== undefined) ascii.push(g); }
const cand = [-1, ...new Set([...ascii, ...Array.from(atlas.braille).filter((g, m) => m % 4 === 3 && g >= 0)])], B = glyphBitmaps(atlas, atlasPx, cand, cw, ch);
const t0 = performance.now(), r = optimiseHero(target, cols, rows, cw, ch, B, cand.length, { iterations, sigma: 1.8, detail: 0.15 }), ms = performance.now() - t0;
const glyphOf = i => (cand[i] < 0 ? ' ' : String.fromCodePoint(atlas.codepoint[cand[i]])), grid = ids => Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => glyphOf(ids[y * cols + x])).join(''));
const out = { name: 'specimen', cols, rows, cell: [cw, ch], candidates: cand.length, atlasVersion: atlas.version, loss: { greedy: r.greedyLoss, relaxed: r.relaxedLoss, discrete: r.discreteLoss }, improvementVsGreedy: 1 - r.discreteLoss / r.greedyLoss, glyphs: grid(r.ids), codepoints: Array.from(r.ids, i => (cand[i] < 0 ? 32 : atlas.codepoint[cand[i]])) };
fs.mkdirSync(path.join(root, 'assets/hero'), { recursive: true }); fs.writeFileSync(path.join(root, 'assets/hero/specimen.json'), JSON.stringify(out, null, 1) + '\n');
// preview strip: three panels side by side, 8-bit grey
const P = cw * ch, img = new Uint8Array(W * 3 * H * 3), put = (panel, buf) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = Math.round(Math.min(1, Math.max(0, buf[y * W + x])) * 255), o = (y * W * 3 + panel * W + x) * 3; img[o] = img[o + 1] = img[o + 2] = v; } };
const raster = ids => { const b = new Float32Array(W * H); for (let c = 0; c < cols * rows; c++) { const cx = (c % cols) * cw, cy = ((c / cols) | 0) * ch; for (let j = 0; j < P; j++) b[(cy + ((j / cw) | 0)) * W + cx + (j % cw)] = B[ids[c] * P + j]; } return b; };
put(0, target); put(1, raster(r.greedyIds)); put(2, raster(r.ids));
fs.mkdirSync(path.join(root, 'docs/images'), { recursive: true }); fs.writeFileSync(path.join(root, 'docs/images/hero-specimen.png'), encodePNG(W * 3, H, img, 3));
console.log(`hero: ${cols}x${rows} cells, ${cand.length} candidates, ${iterations} iterations, ${(ms / 1000).toFixed(1)} s | blurred L2: greedy ${r.greedyLoss.toExponential(3)}, relaxed ${r.relaxedLoss.toExponential(3)}, discrete export ${r.discreteLoss.toExponential(3)} (${(out.improvementVsGreedy * 100).toFixed(1)} % better than per-cell greedy; relaxed-to-discrete gap ${((r.discreteLoss / r.relaxedLoss - 1) * 100).toFixed(2)} %)`);
