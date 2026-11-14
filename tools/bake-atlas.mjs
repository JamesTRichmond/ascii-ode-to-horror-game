#!/usr/bin/env node
// Offline atlas bake (guide phase 1). Produces a versioned asset set:
//   assets/atlas/atlas.png      RGB = normalised multi-channel signed distance (DATA, not sRGB)
//   assets/atlas/glyphs.bin     GlyphRecord table + 6/12/24-D staggered coverage descriptors
//   assets/atlas/bluenoise.bin  32x32 void-and-cluster rank texture
//   assets/atlas/manifest.json  version, metrics, hashes, bake verification report
// Usage: node tools/bake-atlas.mjs [path/to/font.ttf]
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTTF } from './lib/ttf.mjs';
import { colorEdges, generateMSDF, proceduralSDF, median3 } from './lib/msdf.mjs';
import { encodePNG } from './lib/png.mjs';
import { DICT, DICT_CHARS, dictMaskFor } from '../src/shared/materials.js';
import { brailleCodepoint, sextantCodepoint, brailleDots, sextantRects } from '../src/shared/subcell.js';
import { DESCRIPTOR_DIMS, describeCoverage } from '../src/shared/descriptor.js';

export const ATLAS_VERSION = 3;
const TILE_W = 32, TILE_H = 48, PAD = 4, RANGE = 6; // RANGE: total distance range in texels
const IN_W = TILE_W - 2 * PAD, IN_H = TILE_H - 2 * PAD;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontPath = process.argv[2] || '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';
const font = parseTTF(fs.readFileSync(fontPath));

const cell = (nx, ny) => [PAD + nx * IN_W, PAD + ny * IN_H];
const stroke = (a, b, r = 1.5) => ({ type: 'stroke', a: cell(a[0], a[1]), b: cell(b[0], b[1]), r });

// --- procedural glyphs -----------------------------------------------------------------------
const BOX = { // [left, right, up, down] 0 none, 1 single, 2 double
  '─': [1, 1, 0, 0], '│': [0, 0, 1, 1], '┌': [0, 1, 0, 1], '┐': [1, 0, 0, 1], '└': [0, 1, 1, 0], '┘': [1, 0, 1, 0],
  '├': [0, 1, 1, 1], '┤': [1, 0, 1, 1], '┬': [1, 1, 0, 1], '┴': [1, 1, 1, 0], '┼': [1, 1, 1, 1],
  '═': [2, 2, 0, 0], '║': [0, 0, 2, 2], '╔': [0, 2, 0, 2], '╗': [2, 0, 0, 2], '╚': [0, 2, 2, 0], '╝': [2, 0, 2, 0], '╬': [2, 2, 2, 2],
};
const RUNES = {
  'ᚠ': [[.3, .05, .3, .95], [.3, .55, .78, .25], [.3, .32, .78, .05]], 'ᚢ': [[.25, .95, .25, .05], [.25, .05, .75, .4], [.75, .4, .75, .95]],
  'ᚦ': [[.3, .05, .3, .95], [.3, .3, .72, .5], [.72, .5, .3, .7]], 'ᚨ': [[.3, .05, .3, .95], [.3, .05, .72, .3], [.3, .32, .72, .57]],
  'ᚱ': [[.3, .05, .3, .95], [.3, .05, .72, .25], [.72, .25, .3, .5], [.3, .5, .72, .95]], 'ᚲ': [[.72, .2, .3, .5], [.3, .5, .72, .8]],
  'ᚷ': [[.2, .1, .8, .9], [.8, .1, .2, .9]], 'ᚹ': [[.3, .05, .3, .95], [.3, .05, .72, .28], [.72, .28, .3, .5]],
  'ᚺ': [[.25, .05, .25, .95], [.75, .05, .75, .95], [.25, .4, .75, .6]], 'ᚾ': [[.5, .05, .5, .95], [.28, .4, .72, .6]],
  'ᛁ': [[.5, .05, .5, .95]], 'ᛃ': [[.62, .12, .3, .32], [.3, .32, .56, .5], [.7, .5, .44, .68], [.44, .68, .7, .88]],
  'ᛇ': [[.5, .05, .5, .95], [.5, .05, .76, .25], [.5, .95, .24, .75]], 'ᛈ': [[.3, .05, .3, .95], [.3, .05, .55, .2], [.55, .2, .76, .05], [.3, .95, .55, .8], [.55, .8, .76, .95]],
  'ᛉ': [[.5, .05, .5, .95], [.5, .48, .2, .1], [.5, .48, .8, .1]], 'ᛊ': [[.66, .05, .34, .35], [.34, .35, .66, .65], [.66, .65, .34, .95]],
};
function proceduralShapes(ch) {
  if (BOX[ch]) {
    const [l, r, u, d] = BOX[ch], out = [], e = 0.04, o = 0.11; // extend past the cell so neighbours join
    const arm = (on, a, b) => { if (on === 1) out.push(stroke(a, b)); if (on === 2) { const horiz = a[1] === b[1]; for (const s of [-o, o]) out.push(stroke(horiz ? [a[0], a[1] + s * 0.6] : [a[0] + s, a[1]], horiz ? [b[0], b[1] + s * 0.6] : [b[0] + s, b[1]], 1.1)); } };
    arm(l, [-e, .5], [.5, .5]); arm(r, [.5, .5], [1 + e, .5]); arm(u, [.5, -e], [.5, .5]); arm(d, [.5, .5], [.5, 1 + e]);
    return out;
  }
  if (ch === '╱') return [stroke([1.02, -.02], [-.02, 1.02])];
  if (ch === '╲') return [stroke([-.02, -.02], [1.02, 1.02])];
  if (ch === '█') return [{ type: 'box', x0: PAD - 1, y0: PAD - 1, x1: PAD + IN_W + 1, y1: PAD + IN_H + 1 }];
  if ('░▒▓'.includes(ch)) {
    const r = { '░': 1.0, '▒': 1.55, '▓': 2.15 }[ch], out = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) out.push({ type: 'disc', c: cell((x + (y & 1 ? .75 : .25)) / 5, (y + .5) / 8), r });
    return out;
  }
  if (RUNES[ch]) return RUNES[ch].map(s => stroke([s[0], .1 + s[1] * .8], [s[2], .1 + s[3] * .8], 1.45));
  return null;
}

// --- glyph list ------------------------------------------------------------------------------
const glyphs = []; const seen = new Set();
function addGlyph(cp, shapes, flags, mask) { if (seen.has(cp)) return; seen.add(cp); glyphs.push({ cp, shapes, flags, mask }); }
const missing = [];
for (const chars of Object.values(DICT_CHARS)) for (const ch of Array.from(chars)) {
  const cp = ch.codePointAt(0), proc = proceduralShapes(ch);
  if (proc) addGlyph(cp, proc, 1, dictMaskFor(ch));
  else if (cp === 0x20 || font.glyphIndex(cp)) addGlyph(cp, null, 0, dictMaskFor(ch));
  else missing.push(ch);
}
if (missing.length) { console.error('Font lacks glyphs, remove from dictionaries or add procedural shapes:', missing.join(' ')); process.exit(1); }
for (let m = 0; m < 256; m++) addGlyph(brailleCodepoint(m), brailleDots(m).map(([x, y]) => ({ type: 'disc', c: cell(x, y), r: 2.7 })), 1 | 2 | (m << 8), DICT.BRAILLE);
for (let m = 1; m < 64; m++) addGlyph(sextantCodepoint(m), sextantRects(m).map(([x0, y0, x1, y1]) => ({ type: 'box', x0: PAD + x0 * IN_W, y0: PAD + y0 * IN_H, x1: PAD + x1 * IN_W, y1: PAD + y1 * IN_H })), 1 | 4 | (m << 8), DICT.SEXTANT);
// Sextant special cases share codepoints with block elements; keep flags/mask consistent.
for (const g of glyphs) { for (const [m, cp] of [[21, 0x258c], [42, 0x2590], [63, 0x2588]]) if (g.cp === cp) { g.flags |= 4 | (m << 8); g.mask |= DICT.SEXTANT; } }

// --- bake ------------------------------------------------------------------------------------
const COLS = 32, ROWS = Math.ceil(glyphs.length / COLS), AW = COLS * TILE_W, AH = ROWS * TILE_H;
const atlas = new Uint8Array(AW * AH * 3).fill(0);
const scale = IN_H / (font.ascender - font.descender), DESC = DESCRIPTOR_DIMS.reduce((a, b) => a + b, 0);
const descriptors = new Float32Array(glyphs.length * DESC), meta = new Float32Array(glyphs.length * 4);
const report = { repairedPixels: 0, maxCoverageError: 0, worstGlyph: '', clipped: [] };

glyphs.forEach((g, gi) => {
  let msdf, sdf, advance = 1, bearing = [0, 0, 0, 0];
  if (g.shapes) { sdf = proceduralSDF(g.shapes, TILE_W, TILE_H); msdf = new Float32Array(TILE_W * TILE_H * 3); for (let i = 0; i < sdf.length; i++) msdf[i * 3] = msdf[i * 3 + 1] = msdf[i * 3 + 2] = sdf[i]; }
  else {
    const gid = font.glyphIndex(g.cp), adv = font.advance(gid) * scale, ox = PAD + (IN_W - adv) / 2, oy = PAD + font.ascender * scale;
    const contours = font.edges(gid).map(c => c.map(e => ({ p: e.p.map(([x, y]) => [ox + x * scale, oy - y * scale]) })));
    const r = contours.length ? generateMSDF(colorEdges(contours), TILE_W, TILE_H) : { msdf: new Float32Array(TILE_W * TILE_H * 3).fill(-1e3), sdf: new Float32Array(TILE_W * TILE_H).fill(-1e3), repaired: 0 };
    msdf = r.msdf; sdf = r.sdf; report.repairedPixels += r.repaired; advance = adv / IN_W;
  }
  // coverage reference, ink bounds, clipping check
  const cov = new Float32Array(TILE_W * TILE_H); let x0 = TILE_W, x1 = -1, y0 = TILE_H, y1 = -1, sum = 0, jxx = 0, jxy = 0, jyy = 0;
  for (let i = 0; i < sdf.length; i++) { cov[i] = Math.min(1, Math.max(0, sdf[i] + 0.5)); if (cov[i] > 0.5) { const x = i % TILE_W, y = (i / TILE_W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
  if (!g.shapes && x1 >= 0 && (x0 < 1 || y0 < 1 || x1 > TILE_W - 2 || y1 > TILE_H - 2)) report.clipped.push(String.fromCodePoint(g.cp));
  for (let y = 1; y < TILE_H - 1; y++) for (let x = 1; x < TILE_W - 1; x++) {
    const i = y * TILE_W + x, gx = (cov[i + 1] - cov[i - 1]) / 2, gy = (cov[i + TILE_W] - cov[i - TILE_W]) / 2; jxx += gx * gx; jxy += gx * gy; jyy += gy * gy;
    if (x >= PAD && x < PAD + IN_W && y >= PAD && y < PAD + IN_H) sum += cov[i];
  }
  let off = gi * DESC;
  for (const d of DESCRIPTOR_DIMS) { describeCoverage(cov, TILE_W, TILE_H, PAD, PAD, IN_W, IN_H, d, descriptors, off); off += d; }
  meta[gi * 4] = sum / (IN_W * IN_H);                                              // mean coverage
  meta[gi * 4 + 1] = 0.5 * Math.atan2(2 * jxy, jxx - jyy) + Math.PI / 2;           // stroke tangent angle
  meta[gi * 4 + 2] = Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / (jxx + jyy + 1e-6); // anisotropy 0..1
  meta[gi * 4 + 3] = x1 >= 0 ? (y1 - y0 + 1) / IN_H : 0;
  bearing = [x1 >= 0 ? (x0 - PAD) / IN_W : 0, x1 >= 0 ? (y0 - PAD) / IN_H : 0, advance, meta[gi * 4 + 3]];
  g.bearing = bearing;
  // write tile + verify the 8-bit median reconstruction against the reference coverage
  const tx = (gi % COLS) * TILE_W, ty = ((gi / COLS) | 0) * TILE_H; let err = 0;
  for (let y = 0; y < TILE_H; y++) for (let x = 0; x < TILE_W; x++) {
    const i = y * TILE_W + x, o = ((ty + y) * AW + tx + x) * 3, q = [];
    for (let k = 0; k < 3; k++) { const v = Math.round(Math.min(1, Math.max(0, msdf[i * 3 + k] / RANGE + 0.5)) * 255); atlas[o + k] = v; q.push(v / 255); }
    err = Math.max(err, Math.abs(Math.min(1, Math.max(0, (median3(q[0], q[1], q[2]) - 0.5) * RANGE + 0.5)) - cov[i]));
  }
  if (err > report.maxCoverageError) { report.maxCoverageError = err; report.worstGlyph = String.fromCodePoint(g.cp); }
});

// --- glyphs.bin ------------------------------------------------------------------------------
const HEADER = 48, REC = 48, bin = Buffer.alloc(HEADER + glyphs.length * REC + meta.byteLength + descriptors.byteLength);
bin.write('NGLY', 0, 'latin1');
[ATLAS_VERSION, glyphs.length, TILE_W, TILE_H, PAD].forEach((v, i) => bin.writeUInt32LE(v, 4 + i * 4));
bin.writeFloatLE(RANGE, 24); [COLS, ROWS, DESC, HEADER + glyphs.length * REC].forEach((v, i) => bin.writeUInt32LE(v, 28 + i * 4));
glyphs.forEach((g, gi) => {
  const o = HEADER + gi * REC, tx = gi % COLS, ty = (gi / COLS) | 0;
  [tx / COLS, ty / ROWS, (tx + 1) / COLS, (ty + 1) / ROWS, ...g.bearing].forEach((v, i) => bin.writeFloatLE(v, o + i * 4));
  bin.writeUInt32LE(gi * DESC, o + 32); bin.writeUInt32LE(g.mask >>> 0, o + 36); bin.writeUInt32LE(g.cp, o + 40); bin.writeUInt32LE(g.flags >>> 0, o + 44);
});
Buffer.from(meta.buffer).copy(bin, HEADER + glyphs.length * REC);
Buffer.from(descriptors.buffer).copy(bin, HEADER + glyphs.length * REC + meta.byteLength);

// --- blue noise (void-and-cluster, toroidal, deterministic) -------------------------------------
function blueNoise(N = 32) {
  const n = N * N, on = new Uint8Array(n), energy = new Float32Array(n), rank = new Uint16Array(n), K = [];
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) K.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * 1.9 * 1.9))]);
  const splat = (i, s) => { const x = i % N, y = (i / N) | 0; for (const [dx, dy, w] of K) energy[((y + dy + N) % N) * N + (x + dx + N) % N] += s * w; };
  const pick = (want, tight) => { let b = -1, v = tight ? -Infinity : Infinity; for (let i = 0; i < n; i++) if (on[i] === want && (tight ? energy[i] > v : energy[i] < v)) { v = energy[i]; b = i; } return b; };
  let s = 0x9e3779b9; const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
  let ones = 0; while (ones < n / 10) { const i = (rnd() * n) | 0; if (!on[i]) { on[i] = 1; splat(i, 1); ones++; } }
  for (let it = 0; it < 4000; it++) { const c = pick(1, true); on[c] = 0; splat(c, -1); const v = pick(0, false); on[v] = 1; splat(v, 1); if (v === c) break; }
  const proto = on.slice(), protoE = energy.slice();
  for (let r = ones - 1; r >= 0; r--) { const c = pick(1, true); on[c] = 0; splat(c, -1); rank[c] = r; }
  on.set(proto); energy.set(protoE);
  for (let r = ones; r < n; r++) { const v = pick(0, false); on[v] = 1; splat(v, 1); rank[v] = r; }
  return Uint8Array.from(rank, r => Math.floor(r * 256 / n));
}
const noise = blueNoise(32);

// --- write -----------------------------------------------------------------------------------
const outDir = path.join(root, 'assets/atlas'); fs.mkdirSync(outDir, { recursive: true });
const png = encodePNG(AW, AH, atlas, 3), sha = b => crypto.createHash('sha256').update(b).digest('hex');
fs.writeFileSync(path.join(outDir, 'atlas.png'), png); fs.writeFileSync(path.join(outDir, 'glyphs.bin'), bin); fs.writeFileSync(path.join(outDir, 'bluenoise.bin'), noise);
const manifest = {
  format: 'nocturne-atlas', version: ATLAS_VERSION, font: path.basename(fontPath), fontLicense: 'assets/atlas/FONT-LICENSE.txt',
  tile: { width: TILE_W, height: TILE_H, padding: PAD, innerWidth: IN_W, innerHeight: IN_H }, distanceRangeTexels: RANGE,
  atlas: { file: 'atlas.png', width: AW, height: AH, cols: COLS, rows: ROWS, colorSpace: 'data-linear', sha256: sha(png) },
  glyphs: { file: 'glyphs.bin', count: glyphs.length, recordBytes: REC, headerBytes: HEADER, descriptorDims: DESCRIPTOR_DIMS, sha256: sha(bin) },
  blueNoise: { file: 'bluenoise.bin', size: 32, sha256: sha(noise) },
  counts: { font: glyphs.filter(g => !g.shapes).length, procedural: glyphs.filter(g => g.shapes).length, braille: 256, sextant: 64 },
  bake: { repairedPixels: report.repairedPixels, maxCoverageError: +report.maxCoverageError.toFixed(4), worstGlyph: report.worstGlyph, clippedGlyphs: report.clipped },
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`atlas ${AW}x${AH}, ${glyphs.length} glyphs (${manifest.counts.font} font, ${manifest.counts.procedural} procedural), png ${(png.length / 1024).toFixed(0)} KiB`);
console.log(`repaired px ${report.repairedPixels}, max 8-bit coverage error ${report.maxCoverageError.toFixed(4)} at '${report.worstGlyph}', clipped: ${report.clipped.length ? report.clipped.join('') : 'none'}`);
