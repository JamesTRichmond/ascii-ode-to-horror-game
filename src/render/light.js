// Lighting and atmosphere (guide phase 3). Everything here is scene-linear and resolved
// BEFORE glyph selection: direct directional light with plan-view height shadows, probe
// irradiance from the radiance cascades, emissive materials, then heterogeneous fog.
import { MATERIALS } from '../shared/materials.js';
import { FAR, CELL, octDecode } from './gbuffer.js';
import { TEXELS_PER_CELL } from './cascades.js';

const ALB = MATERIALS.map(m => m.albedo), EMI = MATERIALS.map(m => m.emissive);
const hash2 = (x, y) => { let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); n ^= n >>> 13; return ((Math.imul(n, 1274126177) ^ (n >>> 16)) >>> 0) / 4294967296; };
export { hash2 };

/** Plan-view shadow mask for a directional light: 1 lit, 0 shadowed, per map texel. */
export function directionalShadow(world, dir, out) {
  const T = TEXELS_PER_CELL, tw = world.w * T, th = world.h * T, tm = CELL / T, hl = Math.hypot(dir[0], dir[2]) || 1e-6, sx = dir[0] / hl, sz = dir[2] / hl, rise = (dir[1] / hl) * tm;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const base = world.floorH[((y / T) | 0) * world.w + ((x / T) | 0)]; let lit = 1;
    for (let s = 1; s <= 28; s++) {
      const xx = Math.floor(x + 0.5 + sx * s), yy = Math.floor(y + 0.5 + sz * s); if (xx < 0 || yy < 0 || xx >= tw || yy >= th) break;
      if (world.floorH[((yy / T) | 0) * world.w + ((xx / T) | 0)] > base + 0.2 + rise * s) { lit = 0; break; }
    }
    out[y * tw + x] = lit;
  }
  return out;
}

/** Bilinear probe irradiance for a world position and normal; invalid (in-wall) probes are skipped. */
export function probeIrradiance(c, xm, zm, nx, ny, nz, out) {
  const px = xm / CELL - 0.5, pz = zm / CELL - 0.5, ix = Math.floor(px), iz = Math.floor(pz), fx = px - ix, fz = pz - iz;
  const wxp = nx > 0 ? nx : 0, wxn = nx < 0 ? -nx : 0, wzp = nz > 0 ? nz : 0, wzn = nz < 0 ? -nz : 0, wy = Math.abs(ny);
  let r = 0, g = 0, b = 0, ws = 0;
  for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) {
    const xx = ix + dx, zz = iz + dz; if (xx < 0 || zz < 0 || xx >= c.nx || zz >= c.ny) continue;
    const p = zz * c.nx + xx; if (!c.valid[p]) continue;
    const w = (dx ? fx : 1 - fx) * (dz ? fz : 1 - fz) + 1e-4, o = p * 3;
    r += w * (c.irr[0][o] * wxp + c.irr[1][o] * wxn + c.irr[2][o] * wzp + c.irr[3][o] * wzn + c.fluence[o] * wy);
    g += w * (c.irr[0][o + 1] * wxp + c.irr[1][o + 1] * wxn + c.irr[2][o + 1] * wzp + c.irr[3][o + 1] * wzn + c.fluence[o + 1] * wy);
    b += w * (c.irr[0][o + 2] * wxp + c.irr[1][o + 2] * wxn + c.irr[2][o + 2] * wzp + c.irr[3][o + 2] * wzn + c.fluence[o + 2] * wy); ws += w;
  }
  if (ws > 0) { out[0] = r / ws; out[1] = g / ws; out[2] = b / ws; } else out[0] = out[1] = out[2] = 0;
  return out;
}

/**
 * Resolve scene-linear radiance for every pixel.
 * env: {ambient, skyTop, skyHorizon, dir:{d:[x,y,z], color}, shadow:Uint8 texel mask, cascades, time, exposure, stars}
 */
export function shade(gb, cam, env) {
  const { w, h, depth, normal, material, object, radiance } = gb, N = [0, 0, 0], E = [0, 0, 0], c = env.cascades, T = TEXELS_PER_CELL, tw = c.tw, th = c.th;
  const L = env.dir.d, LC = env.dir.color, amb = env.ambient, time = env.time, exp = env.exposure ?? 1, sh = env.shadow;
  // probe irradiance is cached per 2x3 micro-cell column while the surface (normal, object) is unchanged
  const cw = (w + 1) >> 1, cKey = shade._k && shade._k.length === cw ? shade._k : (shade._k = new Int32Array(cw)), cE = shade._e && shade._e.length === cw * 3 ? shade._e : (shade._e = new Float32Array(cw * 3));
  for (let y = 0; y < h; y++) {
    if (y % 3 === 0) cKey.fill(-1);
    const vy = (y + 0.5 - cam.cy) / cam.f;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, m = material[i], d = depth[i], o = i * 3;
      if (d >= FAR) { // sky: vertical gradient plus yaw-stable stars
        const el = Math.max(0, Math.min(1, -vy * 1.6)); let r = env.skyHorizon[0] + (env.skyTop[0] - env.skyHorizon[0]) * el, g = env.skyHorizon[1] + (env.skyTop[1] - env.skyHorizon[1]) * el, b = env.skyHorizon[2] + (env.skyTop[2] - env.skyHorizon[2]) * el;
        if (env.stars && vy < -0.02) { const az = cam.yaw + Math.atan((x + 0.5 - w / 2) / cam.f), s = hash2(Math.floor(az * 150), Math.floor(vy * 150)); if (s > 0.992) { const k = (s - 0.992) * 125 * env.stars * (0.7 + 0.3 * Math.sin(time * 2 + s * 400)); r += k; g += k; b += k * 1.1; } }
        radiance[o] = r * exp; radiance[o + 1] = g * exp; radiance[o + 2] = b * exp; continue;
      }
      const a = (x + 0.5 - w / 2) / cam.f, wx = cam.x + (cam.fx + cam.rx * a) * d, wz = cam.z + (cam.fz + cam.rz * a) * d, wy = cam.y - vy * d;
      octDecode(normal, i * 2, N);
      // procedural albedo detail: gives the shape matcher and structure tensor real surface structure
      let k = 1;
      if (m === 2) { // stone courses and joints
        if (N[1] > 0.5 || N[1] < -0.5) { const u = wx - Math.floor(wx), v = wz - Math.floor(wz); k = u < 0.06 || v < 0.06 ? 0.4 : 0.8 + 0.3 * hash2(Math.floor(wx), Math.floor(wz)); }
        else { const row = Math.floor(wy / 0.55), u = (wx + wz) * 0.8 + (row & 1) * 0.5, fv = wy / 0.55 - row; k = fv < 0.1 || u - Math.floor(u) < 0.06 ? 0.38 : 0.75 + 0.4 * hash2(Math.floor(u), row); }
      } else if (m === 1) k = 0.55 + 0.35 * Math.sin(wy * 41 + Math.sin((wx + wz) * 17) * 5) ** 2 + 0.2 * hash2(wx * 23, wy * 23 + wz * 31);
      else if (m === 7) k = 0.55 + 0.9 * hash2(Math.floor(wx * 5), Math.floor(wz * 5));
      else if (m === 9) k = 0.7 + 0.5 * hash2(Math.floor(wx * 9), Math.floor(wz * 9));
      else if (m === 8) k = 0.6 + 0.5 * Math.sin(wx * 2.3 + time * 0.9 + Math.sin(wz * 1.7 - time * 0.6) * 1.5) ** 2;
      else if (m === 10) k = 0.6 + 0.5 * Math.sin((wx + wz) * 9 + Math.sin(wy * 3) * 2) ** 2;
      else if (m === 4 || m === 3 || m === 11) k = 0.75 + 0.3 * Math.sin(wy * 23 + (wx + wz) * 7) ** 2;
      // direct directional light with plan-view height shadow
      let lit = Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
      if (lit > 0 && sh) { const tx = Math.floor((wx / CELL) * T), tz = Math.floor((wz / CELL) * T); if (tx >= 0 && tz >= 0 && tx < tw && tz < th && !sh[tz * tw + tx] && (object[i] === 0 || wy < 1.2)) lit *= 0.12; }
      const cc = x >> 1, key = (normal[i * 2] & 0xfff0) ^ ((normal[i * 2 + 1] & 0xfff0) << 12) ^ (object[i] << 4) ^ m;
      if (cKey[cc] === key) { E[0] = cE[cc * 3]; E[1] = cE[cc * 3 + 1]; E[2] = cE[cc * 3 + 2]; }
      else { probeIrradiance(c, wx, wz, N[0], N[1], N[2], E); cKey[cc] = key; cE[cc * 3] = E[0]; cE[cc * 3 + 1] = E[1]; cE[cc * 3 + 2] = E[2]; }
      // soft rim toward the viewer keeps silhouettes sculpted in near-darkness
      const rim = Math.max(0, -(N[0] * (cam.fx + cam.rx * a) + N[2] * (cam.fz + cam.rz * a)) + N[1] * vy) * (object[i] ? 0.06 : 0.02);
      const al = ALB[m], em = EMI[m], pulse = m === 13 || m === 6 ? 0.65 + 0.35 * Math.sin(time * 1.7 + (wx + wy + wz) * 2.1) : m === 15 ? 0.7 + 0.3 * Math.sin(time * 9 + wy * 8) : 1;
      radiance[o] = (al[0] * k * (amb[0] + LC[0] * lit + E[0] + rim) + em[0] * pulse) * exp;
      radiance[o + 1] = (al[1] * k * (amb[1] + LC[1] * lit + E[1] + rim) + em[1] * pulse) * exp;
      radiance[o + 2] = (al[2] * k * (amb[2] + LC[2] * lit + E[2] + rim) + em[2] * pulse) * exp;
    }
  }
}

/** Fog density (extinction, 1/m) at a world point. Heterogeneous: height falloff, drifting noise, local bodies. */
export function fogDensity(fog, x, y, z, time) {
  if (fog.homogeneous) return fog.sigma;
  let s = fog.sigma * Math.exp(-Math.max(0, y) / fog.height) * (0.55 + 0.9 * (0.5 + 0.5 * Math.sin(x * 0.61 + time * 0.23 + Math.sin(z * 0.47 - time * 0.17) * 1.9) * Math.sin(z * 0.53 + y * 0.9 + time * 0.11)));
  const blobs = fog.blobs;
  if (blobs) for (let b = 0; b < blobs.length; b += 5) { const dx = x - blobs[b], dy = y - blobs[b + 1], dz = z - blobs[b + 2], q = (dx * dx + dy * dy + dz * dz) / (blobs[b + 3] * blobs[b + 3]); if (q < 1) s += blobs[b + 4] * (1 - q) * (1 - q); }
  return s > 0 ? s : 0;
}

/**
 * Front-to-back Beer-Lambert integration through heterogeneous fog at reduced resolution.
 * Writes fog.L (in-scattered radiance, RGB) and fog.T (transmittance) on a (w/scale, h/scale) grid:
 *   Tseg = exp(-sigma * ds);  L += T * source * (1 - Tseg);  T *= Tseg
 */
export function createFog(w, h, scale = 3) { const fw = Math.ceil(w / scale), fh = Math.ceil(h / scale); return { scale, fw, fh, L: new Float32Array(fw * fh * 3), T: new Float32Array(fw * fh).fill(1), steps: 8, sigma: 0.018, height: 3, maxDist: 48, blobs: null, albedo: 0.9, ambient: [0.01, 0.02, 0.025] }; }
export function integrateFog(fog, gb, cam, env, noise) {
  const { fw, fh, scale, steps } = fog, c = env.cascades, time = env.time, exp = env.exposure ?? 1;
  for (let fy = 0; fy < fh; fy++) for (let fx = 0; fx < fw; fx++) {
    const sx = Math.min(gb.w - 1, fx * scale + (scale >> 1)), sy = Math.min(gb.h - 1, fy * scale + (scale >> 1)), i = fy * fw + fx;
    const d = Math.min(fog.maxDist, gb.depth[sy * gb.w + sx]), a = (sx + 0.5 - gb.w / 2) / cam.f, vy = (sy + 0.5 - cam.cy) / cam.f;
    const dx = cam.fx + cam.rx * a, dz = cam.fz + cam.rz * a, ds = (d / steps) * Math.sqrt(dx * dx + dz * dz + vy * vy), jitter = noise ? noise[((fy & 31) << 5) | (fx & 31)] / 256 : 0.5;
    let T = 1, r = 0, g = 0, b = 0;
    for (let s = 0; s < steps; s++) {
      const t = ((s + jitter) / steps) * d, px = cam.x + dx * t, pz = cam.z + dz * t, py = cam.y - vy * t;
      const sigma = fogDensity(fog, px, py, pz, time); if (sigma <= 0) continue;
      const Tseg = Math.exp(-sigma * ds), k = T * (1 - Tseg) * fog.albedo;
      const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL); let fr = 0, fg = 0, fb = 0;
      if (cx >= 0 && cz >= 0 && cx < c.nx && cz < c.ny) { const o = (cz * c.nx + cx) * 3; fr = c.fluence[o]; fg = c.fluence[o + 1]; fb = c.fluence[o + 2]; }
      r += k * (fr + fog.ambient[0]); g += k * (fg + fog.ambient[1]); b += k * (fb + fog.ambient[2]); T *= Tseg;
      if (T < 0.01) break;
    }
    fog.L[i * 3] = r * exp; fog.L[i * 3 + 1] = g * exp; fog.L[i * 3 + 2] = b * exp; fog.T[i] = T;
  }
}
/** radiance = radiance * T + L; also writes luminance. */
export function compositeFog(fog, gb) {
  const { w, h, radiance, lum } = gb, { fw, scale } = fog;
  for (let y = 0; y < h; y++) { const fr = ((y / scale) | 0) * fw; for (let x = 0; x < w; x++) {
    const i = y * w + x, f = fr + ((x / scale) | 0), T = fog.T[f], o = i * 3;
    const r = radiance[o] * T + fog.L[f * 3], g = radiance[o + 1] * T + fog.L[f * 3 + 1], b = radiance[o + 2] * T + fog.L[f * 3 + 2];
    radiance[o] = r; radiance[o + 1] = g; radiance[o + 2] = b; lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  } }
}

/** Reference transmittance march used by the acceptance fixture: T = prod exp(-sigma(s) * ds). */
export function marchTransmittance(sigmaAt, distance, steps) {
  let T = 1; const ds = distance / steps;
  for (let i = 0; i < steps; i++) T *= Math.exp(-Math.max(0, sigmaAt((i + 0.5) * ds)) * ds);
  return T;
}
