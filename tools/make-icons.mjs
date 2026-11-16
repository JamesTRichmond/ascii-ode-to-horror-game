#!/usr/bin/env node
// App icons from the game's own MSDF glyph atlas: the word ODE in cyan glyph-light over a field of faint Braille dots,
// on the game's background colour. Usage: node tools/make-icons.mjs  (writes assets/icons/*.png, deterministic)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assets } from '../tests/helpers.mjs';
import { encodePNG } from './lib/png.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), { atlas, atlasPx } = assets(), med = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
function glyph(img, S, g, x0, y0, w, h, rgb) { // MSDF reconstruction at the target size, alpha-blended
  const tw = atlas.tileW, th = atlas.tileH, ox = (g % atlas.cols) * tw, oy = Math.floor(g / atlas.cols) * th, pxRange = Math.max(1, atlas.range * (w / tw));
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(S, Math.ceil(y0 + h)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(S, Math.ceil(x0 + w)); x++) {
    const u = ((x + 0.5 - x0) / w) * tw - 0.5, v = ((y + 0.5 - y0) / h) * th - 0.5; if (u < 0 || v < 0 || u >= tw - 1 || v >= th - 1) continue;
    const ix = u | 0, iy = v | 0, fx = u - ix, fy = v - iy, s = k => { const p = ((oy + iy) * atlasPx.w + ox + ix) * atlasPx.channels, q = p + atlasPx.w * atlasPx.channels, c = atlasPx.channels; return ((atlasPx.pixels[p + k] * (1 - fx) + atlasPx.pixels[p + c + k] * fx) * (1 - fy) + (atlasPx.pixels[q + k] * (1 - fx) + atlasPx.pixels[q + c + k] * fx) * fy) / 255; };
    const a = Math.min(1, Math.max(0, (med(s(0), s(1), s(2)) - 0.5) * pxRange + 0.5)); if (a <= 0) continue;
    const o = (y * S + x) * 3; for (let k = 0; k < 3; k++) img[o + k] += (rgb[k] - img[o + k]) * a;
  }
}
function icon(S, safe) { // safe: fraction of the icon the mark may use (maskable icons keep to the inner 80 %)
  const img = new Uint8Array(S * S * 3); for (let i = 0; i < S * S; i++) { img[i * 3] = 3; img[i * 3 + 1] = 5; img[i * 3 + 2] = 11; }
  const cell = S / 16; let n = 7; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { n = (n * 1103515245 + 12345) >>> 0; const m = n >>> 24; glyph(img, S, atlas.braille[m], x * cell, y * cell, cell, cell * 1.5, [22, 40, 44]); }
  const word = 'ODE', gw = (S * safe) / 3.2, gh = gw * (atlas.tileH / atlas.tileW), x0 = (S - gw * 3) / 2, y0 = (S - gh) / 2;
  [...word].forEach((ch, i) => { const g = atlas.byCodepoint.get(ch.codePointAt(0)); glyph(img, S, g, x0 + i * gw, y0, gw, gh, [127, 227, 212]); });
  return img;
}
fs.mkdirSync(path.join(root, 'assets/icons'), { recursive: true });
for (const [name, S, safe] of [['icon-192', 192, 0.92], ['icon-512', 512, 0.92], ['icon-maskable-512', 512, 0.7]]) { fs.writeFileSync(path.join(root, `assets/icons/${name}.png`), encodePNG(S, S, icon(S, safe), 3)); console.log('wrote', name); }
