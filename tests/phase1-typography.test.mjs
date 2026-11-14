// Nocturne phase 1 acceptance — typography and the material alphabet.
// Fixture: "Exhaustively validate Braille bit order; test median-distance robustness.
//           Render the same slanted stroke at three scales."
import test from 'node:test';
import assert from 'node:assert/strict';
import { assets, read, sha256, median3, specimen } from './helpers.mjs';
import { brailleCodepoint, sextantCodepoint } from '../src/shared/subcell.js';
import { MATERIALS, DICT_CHARS, DICT } from '../src/shared/materials.js';
import { DESCRIPTOR_DIMS, descriptorLayout } from '../src/shared/descriptor.js';
import { ATLAS_VERSION } from '../src/render/atlas.js';

test('Braille is a bijection in Unicode dot order', () => {
  const set = new Set(Array.from({ length: 256 }, (_, i) => brailleCodepoint(i)));
  assert.equal(set.size, 256);
  assert.equal(brailleCodepoint(1), 0x2801, 'dot 1'); assert.equal(brailleCodepoint(2), 0x2808, 'dot 4 is the top-right cell');
  assert.equal(brailleCodepoint(255), 0x28ff); assert.equal(brailleCodepoint(0), 0x2800);
  assert.equal(brailleCodepoint(0b01000000), 0x2840, 'dot 7 is bottom-left');
});
test('all 64 sextant masks map to distinct codepoints, including the four block-element special cases', () => {
  const set = new Set(Array.from({ length: 64 }, (_, i) => sextantCodepoint(i)));
  assert.equal(set.size, 64);
  assert.equal(sextantCodepoint(0), 0x20); assert.equal(sextantCodepoint(21), 0x258c); assert.equal(sextantCodepoint(42), 0x2590); assert.equal(sextantCodepoint(63), 0x2588);
  assert.equal(sextantCodepoint(1), 0x1fb00); assert.equal(sextantCodepoint(62), 0x1fb3b);
});
test('fallback glyphs ship in the atlas for every Braille and sextant mask (no OS font coverage assumed)', () => {
  const { atlas } = assets();
  for (let m = 0; m < 256; m++) { const g = atlas.braille[m]; assert.ok(g >= 0); assert.equal(atlas.codepoint[g], brailleCodepoint(m)); assert.ok(atlas.flags[g] & 1, 'procedural'); }
  for (let m = 1; m < 64; m++) { const g = atlas.sextant[m]; assert.ok(g >= 0); assert.equal(atlas.codepoint[g], sextantCodepoint(m)); }
  // sub-cell coverage is proportional to the number of set dots / blocks
  assert.ok(atlas.mean[atlas.braille[255]] > atlas.mean[atlas.braille[15]] && atlas.mean[atlas.braille[15]] > atlas.mean[atlas.braille[1]]);
  assert.ok(Math.abs(atlas.mean[atlas.sextant[63]] - 1) < 0.02 && Math.abs(atlas.mean[atlas.sextant[21]] - 0.5) < 0.03);
});
test('MSDF median rejects one bad channel', () => { assert.equal(median3(0.2, 0.7, 0.71), 0.7); assert.equal(median3(0.9, 0.1, 0.5), 0.5); });

test('atlas is versioned and matches its manifest', () => {
  const { atlas, manifest } = assets();
  assert.equal(manifest.version, ATLAS_VERSION); assert.equal(atlas.version, ATLAS_VERSION);
  assert.equal(manifest.atlas.sha256, sha256(read('assets/atlas/atlas.png'))); assert.equal(manifest.glyphs.sha256, sha256(read('assets/atlas/glyphs.bin')));
  assert.equal(manifest.glyphs.count, atlas.count); assert.deepEqual(manifest.glyphs.descriptorDims, DESCRIPTOR_DIMS);
  assert.equal(manifest.atlas.colorSpace, 'data-linear'); assert.deepEqual(manifest.bake.clippedGlyphs, []);
  assert.ok(manifest.tile.padding >= manifest.distanceRangeTexels / 2 + 1, 'padding covers half the distance range plus the bilinear footprint');
});
test('no atlas bleeding: every tile border texel is outside the glyph', () => {
  const { atlas, atlasPx: a } = assets(); let bad = 0;
  for (let g = 0; g < atlas.count; g++) {
    const tx = (g % atlas.cols) * atlas.tileW, ty = ((g / atlas.cols) | 0) * atlas.tileH;
    for (let y = 0; y < atlas.tileH; y++) for (let x = 0; x < atlas.tileW; x++) {
      if (x > 0 && y > 0 && x < atlas.tileW - 1 && y < atlas.tileH - 1) continue;
      const o = ((ty + y) * a.w + tx + x) * a.channels; if (median3(a.pixels[o], a.pixels[o + 1], a.pixels[o + 2]) >= 128) bad++;
    }
  }
  assert.equal(bad, 0);
});
test('no clipped ascenders or descenders: ink stays inside the cell', () => {
  const { atlas } = assets();
  for (const ch of 'dlbfhkgjpqy|/()[]{}@#$') { const g = atlas.glyph(ch), top = atlas.bearing[g * 4 + 1], hgt = atlas.bearing[g * 4 + 3]; assert.ok(top >= -0.02 && top + hgt <= 1.03, `${ch}: top ${top} height ${hgt}`); }
});

function coverageAt(atlas, a, g, cw, ch) { // reconstruct a glyph into a cw x ch cell from the 8-bit atlas, like the shader
  const tx = (g % atlas.cols) * atlas.tileW, ty = ((g / atlas.cols) | 0) * atlas.tileH, inW = atlas.tileW - 2 * atlas.pad, inH = atlas.tileH - 2 * atlas.pad, out = new Float32Array(cw * ch), pxRange = Math.max(1, atlas.range * (cw / inW));
  const S = (x, y, k) => { x = Math.min(atlas.tileW - 1.001, Math.max(0, x - 0.5)); y = Math.min(atlas.tileH - 1.001, Math.max(0, y - 0.5)); const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy, p = ((ty + iy) * a.w + tx + ix) * a.channels, q = p + a.w * a.channels; return ((a.pixels[p + k] * (1 - fx) + a.pixels[p + a.channels + k] * fx) * (1 - fy) + (a.pixels[q + k] * (1 - fx) + a.pixels[q + a.channels + k] * fx) * fy) / 255; };
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    let acc = 0; for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) { const u = atlas.pad + ((x + (sx + 0.5) / 4) / cw) * inW, v = atlas.pad + ((y + (sy + 0.5) / 4) / ch) * inH; acc += Math.min(1, Math.max(0, (median3(S(u, v, 0), S(u, v, 1), S(u, v, 2)) - 0.5) * pxRange + 0.5)); }
    out[y * cw + x] = acc / 16;
  }
  return out;
}
test('the same slanted stroke holds its coverage and slope at 4x8, 6x12 and 16x32 cells', t => {
  const { atlas, atlasPx } = assets(), g = atlas.glyph('/'), results = [];
  for (const [cw, ch] of [[4, 8], [6, 12], [16, 32]]) {
    const cov = coverageAt(atlas, atlasPx, g, cw, ch); let sum = 0, sxy = 0, sx = 0, sy = 0, sxx = 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const c = cov[y * cw + x], nx = (x + 0.5) / cw, ny = (y + 0.5) / ch; sum += c; sx += c * nx; sy += c * ny; sxy += c * nx * ny; sxx += c * ny * ny; }
    const mean = sum / (cw * ch), slope = (sxy / sum - (sx / sum) * (sy / sum)) / (sxx / sum - (sy / sum) ** 2);
    results.push({ cell: `${cw}x${ch}`, mean: +mean.toFixed(4), slope: +slope.toFixed(3) }); assert.ok(cov.every(Number.isFinite));
  }
  t.diagnostic(JSON.stringify(results));
  const ref = results[2];
  for (const r of results) { assert.ok(Math.abs(r.mean - ref.mean) / ref.mean < 0.3, `coverage drifts at ${r.cell}`); assert.ok(r.slope < 0 && Math.abs(r.slope - ref.slope) < 0.12, `slope drifts at ${r.cell}`); }
  assert.ok(Math.abs(ref.mean - atlas.mean[g]) < 0.02, 'matches the baked mean coverage');
});
test('1x and 2x display scale give the same silhouette', () => {
  const { atlas, atlasPx } = assets();
  for (const ch of 'A@s~') { const g = atlas.glyph(ch), a = coverageAt(atlas, atlasPx, g, 12, 20), b = coverageAt(atlas, atlasPx, g, 24, 40); let inter = 0, uni = 0;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 12; x++) { const lo = a[y * 12 + x] > 0.5, hi = (b[(y * 2) * 24 + x * 2] + b[(y * 2) * 24 + x * 2 + 1] + b[(y * 2 + 1) * 24 + x * 2] + b[(y * 2 + 1) * 24 + x * 2 + 1]) / 4 > 0.5; if (lo && hi) inter++; if (lo || hi) uni++; }
    assert.ok(inter / uni > 0.85, `${ch}: IoU ${inter / uni}`); }
});

test('descriptors: 6/12/24-D variants share one staggered layout and are unit-normalised', () => {
  const { atlas } = assets();
  for (const d of DESCRIPTOR_DIMS) {
    const L = descriptorLayout(d); assert.equal(L.cols * L.rows, d); assert.notEqual(L.cx[0], L.cx[L.cols], 'odd rows are staggered');
    const g = atlas.glyph('#'); let mag = 0; for (let k = 0; k < d; k++) mag += atlas.desc[d][g * d + k] ** 2; assert.ok(Math.abs(Math.sqrt(mag) - 1) < 0.01);
  }
});
test('material dictionaries: every dictionary character is baked and tagged', () => {
  const { atlas } = assets();
  for (const [name, chars] of Object.entries(DICT_CHARS)) for (const ch of Array.from(chars)) { const g = atlas.byCodepoint.get(ch.codePointAt(0)); assert.ok(g !== undefined, `${name} lacks ${ch}`); assert.ok(atlas.mask[g] & DICT[name]); }
  for (const m of MATERIALS) assert.ok(m.id === 0 || atlas.dict[m.id].length >= 6, `${m.name} has ${atlas.dict[m.id].length} candidates`);
  for (const m of MATERIALS) assert.ok(atlas.dict[m.id].length <= 256, 'candidate budget 64-256 per material');
});
test('pale and bone surfaces draw only from the pale alphabet', () => {
  const { atlas } = assets(), pale = new Set(Array.from(DICT_CHARS.PALE).map(c => c.codePointAt(0)));
  for (const m of [3, 11]) for (const g of atlas.dict[m]) assert.ok(pale.has(atlas.codepoint[g]), `${MATERIALS[m].name} offers '${String.fromCodePoint(atlas.codepoint[g])}'`);
});
test('stone / grass / spell scene uses the right dictionary with no material-boundary leakage', t => {
  const { pl, atlas } = specimen('high', 3), sel = pl.sel, used = {};
  for (let n = 0; n < sel.stats.emitted; n++) {
    const g = sel.inst[n * 11 + 6] | 0, m = sel.matOf[n], mt = MATERIALS[m], fl = atlas.flags[g];
    used[mt.name] = (used[mt.name] || 0) + 1;
    if (m === 0) { assert.ok(fl & 2, 'void leaves emit Braille only'); continue; }
    if (fl & 4) continue; // sextant silhouettes are owner-masked sub-cells, allowed on any subject
    assert.ok(atlas.mask[g] & mt.dict, `material ${mt.name} drew '${String.fromCodePoint(atlas.codepoint[g])}' from another dictionary`);
  }
  t.diagnostic('glyphs per material ' + JSON.stringify(used));
  for (const name of ['stone', 'grass', 'fur', 'arcane']) assert.ok(used[name] > 20, `${name} present in the test scene`);
});
