// Runtime view of the baked atlas (assets/atlas/glyphs.bin). Versioned; never inferred from the OS font.
import { MATERIALS } from '../shared/materials.js';
import { DESCRIPTOR_DIMS } from '../shared/descriptor.js';
import { brailleCodepoint, sextantCodepoint } from '../shared/subcell.js';

export const ATLAS_VERSION = 3;

/** @param {ArrayBuffer} buf contents of glyphs.bin */
export function parseAtlas(buf) {
  const dv = new DataView(buf), magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'NGLY') throw new Error('glyphs.bin: bad magic');
  const version = dv.getUint32(4, true); if (version !== ATLAS_VERSION) throw new Error(`glyphs.bin version ${version}, runtime expects ${ATLAS_VERSION}; re-run npm run bake`);
  const count = dv.getUint32(8, true), tileW = dv.getUint32(12, true), tileH = dv.getUint32(16, true), pad = dv.getUint32(20, true), range = dv.getFloat32(24, true);
  const cols = dv.getUint32(28, true), rows = dv.getUint32(32, true), descStride = dv.getUint32(36, true), metaOff = dv.getUint32(40, true), HEADER = 48, REC = 48;
  const codepoint = new Uint32Array(count), mask = new Uint32Array(count), flags = new Uint32Array(count), uv = new Float32Array(count * 4), bearing = new Float32Array(count * 4);
  for (let g = 0; g < count; g++) {
    const o = HEADER + g * REC;
    for (let k = 0; k < 4; k++) { uv[g * 4 + k] = dv.getFloat32(o + k * 4, true); bearing[g * 4 + k] = dv.getFloat32(o + 16 + k * 4, true); }
    mask[g] = dv.getUint32(o + 36, true); codepoint[g] = dv.getUint32(o + 40, true); flags[g] = dv.getUint32(o + 44, true);
  }
  const meta = new Float32Array(count * 4), all = new Float32Array(count * descStride);
  for (let i = 0; i < meta.length; i++) meta[i] = dv.getFloat32(metaOff + i * 4, true);
  for (let i = 0; i < all.length; i++) all[i] = dv.getFloat32(metaOff + meta.byteLength + i * 4, true);
  // split interleaved 6+12+24 descriptors into one tight table per dimension
  const desc = {}; let off = 0;
  for (const d of DESCRIPTOR_DIMS) { const t = new Float32Array(count * d); for (let g = 0; g < count; g++) for (let k = 0; k < d; k++) t[g * d + k] = all[g * descStride + off + k]; desc[d] = t; off += d; }
  const byCodepoint = new Map(); for (let g = 0; g < count; g++) byCodepoint.set(codepoint[g], g);
  const braille = new Int16Array(256), sextant = new Int16Array(64);
  for (let m = 0; m < 256; m++) braille[m] = byCodepoint.get(brailleCodepoint(m));
  for (let m = 0; m < 64; m++) sextant[m] = byCodepoint.get(sextantCodepoint(m));
  // per-material candidate lists; blank glyphs are never candidates
  const dict = MATERIALS.map(mt => { const list = []; for (let g = 0; g < count; g++) if (mask[g] & mt.dict & 0x1ff9ff && !(flags[g] & 6) && meta[g * 4] > 0.008) list.push(g); return Int16Array.from(list); });
  const mean = new Float32Array(count), angle = new Float32Array(count), aniso = new Float32Array(count), c2 = new Float32Array(count), s2 = new Float32Array(count);
  for (let g = 0; g < count; g++) { mean[g] = meta[g * 4]; angle[g] = meta[g * 4 + 1]; aniso[g] = meta[g * 4 + 2]; c2[g] = Math.cos(2 * angle[g]); s2[g] = Math.sin(2 * angle[g]); }
  return { version, count, tileW, tileH, pad, range, cols, rows, codepoint, mask, flags, uv, bearing, desc, mean, angle, aniso, byCodepoint, braille, sextant, dict, c2, s2, glyph: ch => byCodepoint.get(ch.codePointAt(0)) ?? 0 };
}
