// Surface flow (guide phase 4, task 3-1): structure tensor -> edge tangent flow (ETF) with sign
// alignment -> optional line integral convolution. Works on the micro-cell grid (2x3 pixels).
import { FAR, octDecode } from './gbuffer.js';
import { MATERIALS } from '../shared/materials.js';

export const CELL_W = 2, CELL_H = 3;
const ORGANIC = Uint8Array.from(MATERIALS.map(m => (m.wOrient >= 0.5 ? 1 : 0)));

export function createFlow(w, h) {
  const gw = Math.ceil(w / CELL_W), gh = Math.ceil(h / CELL_H), n = gw * gh;
  return { gw, gh, jxx: new Float32Array(n), jxy: new Float32Array(n), jyy: new Float32Array(n), tmp: new Float32Array(n * 3), tx: new Float32Array(n), ty: new Float32Array(n), coh: new Float32Array(n), ax: new Float32Array(n), ay: new Float32Array(n), fx: new Float32Array(n), fy: new Float32Array(n), conf: new Float32Array(n), lic: new Float32Array(n).fill(0.5), id: new Uint16Array(n), sx: new Float32Array(n), sy: new Float32Array(n) };
}

/** Tangent and coherence of a symmetric 2x2 structure tensor. The tangent is the minor eigenvector. */
export function tensorTangent(jxx, jxy, jyy, out) {
  const theta = 0.5 * Math.atan2(2 * jxy, jxx - jyy) + Math.PI * 0.5;
  out[0] = Math.cos(theta); out[1] = Math.sin(theta);
  out[2] = Math.sqrt((jxx - jyy) * (jxx - jyy) + 4 * jxy * jxy) / (jxx + jyy + 1e-6);
  return out;
}
/** +1 or -1 so that b points into the same half-plane as a (t and -t are the same line). */
export const signAlign = (ax, ay, bx, by) => (ax * bx + ay * by < 0 ? -1 : 1);

/** Screen-space direction (pixels per metre) of world direction (tx,ty,tz) at pixel (sx,sy) with depth d. */
export function projectDirection(cam, sx, sy, d, tx, ty, tz, out) {
  const ax = tx * cam.rx + tz * cam.rz, az = tx * cam.fx + tz * cam.fz, xc = ((sx - cam.w / 2) * d) / cam.f, yc = (-(sy - cam.cy) * d) / cam.f;
  out[0] = (cam.f * (ax * d - xc * az)) / (d * d); out[1] = (-cam.f * (ty * d - yc * az)) / (d * d); return out;
}

export function computeFlow(fl, gb, cam, opts = {}) {
  const { w, h, lum, depth, material, object, tangent } = gb, { gw, gh, jxx, jxy, jyy, tmp } = fl, n = gw * gh, T = [0, 0, 0], D = [0, 0], V = [0, 0, 0];
  jxx.fill(0); jxy.fill(0); jyy.fill(0);
  // 1. Sobel gradients of compressed luminance, outer products accumulated per micro-cell
  for (let y = 1; y < h - 1; y++) { const cr = ((y / CELL_H) | 0) * gw; for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, a = lum[i - w - 1], b = lum[i - w], c = lum[i - w + 1], d = lum[i - 1], e = lum[i + 1], f = lum[i + w - 1], g = lum[i + w], k = lum[i + w + 1], s = 1 / (lum[i] + 0.08);
    const gx = (c + 2 * e + k - a - 2 * d - f) * 0.125 * s, gy = (f + 2 * g + k - a - 2 * b - c) * 0.125 * s, ci = cr + (x >> 1);
    jxx[ci] += gx * gx; jxy[ci] += gx * gy; jyy[ci] += gy * gy;
  } }
  // 2. smooth the tensor (separable 1-2-1), 3. eigen-analysis
  for (const J of [jxx, jxy, jyy]) {
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const i = y * gw + x; tmp[i] = (J[i - (x > 0 ? 1 : 0)] + 2 * J[i] + J[i + (x < gw - 1 ? 1 : 0)]) * 0.25; }
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const i = y * gw + x; J[i] = (tmp[i - (y > 0 ? gw : 0)] + 2 * tmp[i] + tmp[i + (y < gh - 1 ? gw : 0)]) * 0.25; }
  }
  for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) {
    const ci = cy * gw + cx, px = Math.min(w - 1, cx * CELL_W + 1), py = Math.min(h - 1, cy * CELL_H + 1), i = py * w + px, m = material[i], d = depth[i];
    tensorTangent(jxx[ci], jxy[ci], jyy[ci], V); fl.tx[ci] = V[0]; fl.ty[ci] = V[1]; fl.coh[ci] = V[2]; fl.id[ci] = (object[i] << 8) | m;
    // authored geometric tangent, projected to the screen
    let ax = 1, ay = 0;
    if (d < FAR && m !== 7 && m !== 9) { octDecode(tangent, i * 2, T); projectDirection(cam, px + 0.5, py + 0.5, d, T[0], T[1], T[2], D); const l = Math.hypot(D[0], D[1]); if (l > 1e-5) { ax = D[0] / l; ay = D[1] / l; } }
    else if (m === 7) { ax = 0; ay = -1; }
    fl.ax[ci] = ax; fl.ay[ci] = ay;
    // coherence-aware blend: in flat regions fall back to the authored tangent
    const k = Math.max(0, Math.min(1, (V[2] - 0.45) / 0.35)) * (opts.tensorWeight ?? 0.45), s = signAlign(ax, ay, V[0], V[1]);
    let bx = ax + (V[0] * s - ax) * k, by = ay + (V[1] * s - ay) * k; const l = Math.hypot(bx, by) || 1; bx /= l; by /= l;
    fl.fx[ci] = bx; fl.fy[ci] = by; fl.conf[ci] = d < FAR ? 0.35 + 0.65 * V[2] : 0;
  }
  // 4. ETF: iterated, sign-aligned, confidence-weighted neighbourhood smoothing within one surface
  const iters = opts.etfIterations ?? 2, sx = fl.sx, sy = fl.sy;
  for (let it = 0; it < iters; it++) {
    for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) {
      const ci = cy * gw + cx, vx = fl.fx[ci], vy = fl.fy[ci], id = fl.id[ci]; let ox = vx * 0.5, oy = vy * 0.5;
      for (let dy = -1; dy <= 1; dy++) { const yy = cy + dy; if (yy < 0 || yy >= gh) continue; for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx; if (xx < 0 || xx >= gw || (!dx && !dy)) continue; const ni = yy * gw + xx; if (fl.id[ni] !== id) continue;
        const wgt = fl.conf[ni] * signAlign(vx, vy, fl.fx[ni], fl.fy[ni]); ox += fl.fx[ni] * wgt; oy += fl.fy[ni] * wgt;
      } }
      const l = Math.hypot(ox, oy); if (l > 1e-6) { sx[ci] = ox / l; sy[ci] = oy / l; } else { sx[ci] = vx; sy[ci] = vy; }
    }
    fl.fx.set(sx); fl.fy.set(sy);
  }
  // 5. LIC of blue noise along the flow, organic materials only: a visible fibre streak signal
  if (opts.noise) { const noise = opts.noise, L = opts.licSteps ?? 5;
    for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) {
      const ci = cy * gw + cx, id = fl.id[ci]; if (!ORGANIC[id & 255]) { fl.lic[ci] = 0.5; continue; }
      let sum = noise[((cy & 31) << 5) | (cx & 31)], cnt = 1;
      for (const dir of [1, -1]) { let x = cx + 0.5, y = cy + 0.5, px = fl.fx[ci] * dir, py = fl.fy[ci] * dir;
        for (let s = 0; s < L; s++) {
          x += px * 0.75; y += py * 0.5; const xi = x | 0, yi = y | 0; if (xi < 0 || yi < 0 || xi >= gw || yi >= gh) break; const ni = yi * gw + xi; if (fl.id[ni] !== id) break;
          const sg = signAlign(px, py, fl.fx[ni], fl.fy[ni]); px = fl.fx[ni] * sg; py = fl.fy[ni] * sg; sum += noise[((yi & 31) << 5) | (xi & 31)]; cnt++;
        } }
      fl.lic[ci] = sum / (cnt * 255);
    } }
  return fl;
}

/** Closed-form 2x2 SVD with singular-value clamping. m = [a, b, c, d] row-major, in place. */
export function clampJacobian(m, lo, hi) {
  const E = (m[0] + m[3]) / 2, F = (m[0] - m[3]) / 2, G = (m[2] + m[1]) / 2, H = (m[2] - m[1]) / 2, Q = Math.hypot(E, H), R = Math.hypot(F, G);
  let s1 = Q + R, s2 = Q - R; const a1 = Math.atan2(G, F), a2 = Math.atan2(H, E), th = (a2 - a1) / 2, ph = (a2 + a1) / 2;
  s1 = Math.min(hi, Math.max(lo, s1)); s2 = (s2 < 0 ? -1 : 1) * Math.min(hi, Math.max(lo, Math.abs(s2)));
  const cp = Math.cos(ph), sp = Math.sin(ph), ct = Math.cos(th), st = Math.sin(th);
  m[0] = cp * s1 * ct - sp * s2 * st; m[1] = -cp * s1 * st - sp * s2 * ct; m[2] = sp * s1 * ct + cp * s2 * st; m[3] = -sp * s1 * st + cp * s2 * ct;
  return m;
}
/** Singular values of a 2x2 matrix [a,b,c,d]. */
export function singularValues(m) { const E = (m[0] + m[3]) / 2, F = (m[0] - m[3]) / 2, G = (m[2] + m[1]) / 2, H = (m[2] - m[1]) / 2, Q = Math.hypot(E, H), R = Math.hypot(F, G); return [Q + R, Math.abs(Q - R)]; }
