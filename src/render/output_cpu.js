// Reference CPU compositor: draws the instance stream by sampling the MSDF atlas directly.
// Used for headless snapshots/tests and as the last-resort fallback where WebGL2 is missing.
// Produces the same image as the GPU path (same median reconstruction and tone curve).
import { INSTANCE_FLOATS } from './select.js';

const median = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
export const toneMap = v => Math.pow(Math.min(1, Math.max(0, v / (1 + v))), 0.65);

/**
 * @param out Uint8ClampedArray RGBA, (w*scale) x (h*scale)
 * @param atlasPx {pixels:Uint8Array RGB(A), w, h, channels}
 */
export function compositeCPU(out, w, h, scale, inst, count, atlas, atlasPx, background = [3, 5, 11], cvd = null) { // cvd: row-major 3x3 or null
  const W = w * scale, H = h * scale, ch = atlasPx.channels, tw = atlas.tileW, tH = atlas.tileH, px = atlasPx.pixels, aw = atlasPx.w;
  for (let i = 0; i < W * H; i++) { out[i * 4] = background[0]; out[i * 4 + 1] = background[1]; out[i * 4 + 2] = background[2]; out[i * 4 + 3] = 255; }
  for (let n = 0; n < count; n++) {
    const o = n * INSTANCE_FLOATS, cx = inst[o] * scale, cy = inst[o + 1] * scale, ax = inst[o + 2] * scale, ay = inst[o + 3] * scale, bx = inst[o + 4] * scale, by = inst[o + 5] * scale, g = inst[o + 6] | 0;
    const det = ax * by - bx * ay; if (Math.abs(det) < 1e-6) continue;
    const ex = Math.abs(ax) + Math.abs(bx), ey = Math.abs(ay) + Math.abs(by), x0 = Math.max(0, Math.floor(cx - ex)), x1 = Math.min(W - 1, Math.ceil(cx + ex)), y0 = Math.max(0, Math.floor(cy - ey)), y1 = Math.min(H - 1, Math.ceil(cy + ey));
    const tx = (g % atlas.cols) * tw, ty = ((g / atlas.cols) | 0) * tH, pxRange = Math.max(1, atlas.range * (Math.sqrt(Math.abs(det)) * 2) / Math.sqrt(tw * tH));
    let r = inst[o + 7], gr = inst[o + 8], b = inst[o + 9]; if (cvd) [r, gr, b] = [cvd[0] * r + cvd[1] * gr + cvd[2] * b, cvd[3] * r + cvd[4] * gr + cvd[5] * b, cvd[6] * r + cvd[7] * gr + cvd[8] * b];
    const cr = toneMap(Math.max(0, r)) * 255, cg = toneMap(Math.max(0, gr)) * 255, cb = toneMap(Math.max(0, b)) * 255, al = inst[o + 10];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, u = (dx * by - dy * bx) / det, v = (dy * ax - dx * ay) / det; if (u < -1 || u > 1 || v < -1 || v > 1) continue;
      const fx = Math.min(tw - 1.001, Math.max(0, (u * 0.5 + 0.5) * tw - 0.5)), fy = Math.min(tH - 1.001, Math.max(0, (v * 0.5 + 0.5) * tH - 0.5)), ix = fx | 0, iy = fy | 0, qx = fx - ix, qy = fy - iy;
      const p = ((ty + iy) * aw + tx + ix) * ch, q = p + aw * ch, s = k => ((px[p + k] * (1 - qx) + px[p + ch + k] * qx) * (1 - qy) + (px[q + k] * (1 - qx) + px[q + ch + k] * qx) * qy) / 255;
      const a = Math.min(1, Math.max(0, (median(s(0), s(1), s(2)) - 0.5) * pxRange + 0.5)) * al; if (a <= 0) continue;
      const i = (y * W + x) * 4; out[i] += (cr - out[i]) * a; out[i + 1] += (cg - out[i + 1]) * a; out[i + 2] += (cb - out[i + 2]) * a;
    }
  }
  return out;
}

/** Debug visualisation of one G-buffer channel as RGBA8 (guide: "debug every channel independently"). */
export function debugImage(out, pl, mode) {
  const gb = pl.gb, n = gb.w * gb.h, N = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0;
    if (mode === 'radiance') { r = toneMap(gb.radiance[i * 3]); g = toneMap(gb.radiance[i * 3 + 1]); b = toneMap(gb.radiance[i * 3 + 2]); }
    else if (mode === 'depth') { r = g = b = gb.depth[i] > 1e3 ? 0 : 1 / (1 + gb.depth[i] * 0.25); }
    else if (mode === 'normals' || mode === 'tangents') { const src = mode === 'normals' ? gb.normal : gb.tangent, u = src[i * 2] / 32767, v = src[i * 2 + 1] / 32767; let x = u, z = v; const y = 1 - Math.abs(u) - Math.abs(v); if (y < 0) { x = (1 - Math.abs(v)) * Math.sign(u || 1); z = (1 - Math.abs(u)) * Math.sign(v || 1); } const l = Math.hypot(x, y, z) || 1; N[0] = x / l; N[1] = y / l; N[2] = z / l; if (gb.material[i]) { r = N[0] * 0.5 + 0.5; g = N[1] * 0.5 + 0.5; b = N[2] * 0.5 + 0.5; } }
    else if (mode === 'material') { const m = gb.material[i] * 47 + gb.object[i] * 91; r = ((m * 13) % 255) / 255; g = ((m * 29) % 255) / 255; b = ((m * 53) % 255) / 255; if (!gb.material[i]) r = g = b = 0; }
    else if (mode === 'velocity') { r = 0.5 + gb.velocity[i * 2] * 0.06; g = 0.5 + gb.velocity[i * 2 + 1] * 0.06; b = 0.5; }
    else if (mode === 'flow' || mode === 'switch' || mode === 'lic') { const fl = pl.flow, c = Math.min(fl.gh - 1, ((i / gb.w | 0) / 3) | 0) * fl.gw + Math.min(fl.gw - 1, (i % gb.w) >> 1); if (mode === 'flow') { r = fl.fx[c] * 0.5 + 0.5; g = fl.fy[c] * 0.5 + 0.5; b = fl.coh[c]; } else if (mode === 'lic') { r = g = b = fl.lic[c]; } else { r = pl.sel.heat[c]; g = r * 0.4; b = 0.08; } }
    out[i * 4] = r * 255; out[i * 4 + 1] = g * 255; out[i * 4 + 2] = b * 255; out[i * 4 + 3] = 255;
  }
  if (mode === 'leaves') { const qt = pl.qt; for (let i = 0; i < n; i++) { out[i * 4] = 4; out[i * 4 + 1] = 8; out[i * 4 + 2] = 12; out[i * 4 + 3] = 255; }
    for (let l = 0; l < qt.count; l++) { const c = [[24, 56, 52], [60, 110, 100], [150, 150, 120], [240, 200, 120]][qt.level[l]], x0 = qt.lx[l], y0 = qt.ly[l]; for (let x = x0; x < x0 + qt.lw[l]; x++) { const i = (y0 * gb.w + x) * 4; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; } for (let y = y0; y < y0 + qt.lh[l]; y++) { const i = (y * gb.w + x0) * 4; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; } } }
  return out;
}
