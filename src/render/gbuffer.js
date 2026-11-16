// Scene-linear G-buffer (guide phase 2, task 1-0). Units and conventions:
//   depth     Float32   metres along the camera forward axis (perpendicular depth); FAR for sky
//   normal    Int16 x2  octahedral-encoded world-space unit normal
//   tangent   Int16 x2  octahedral-encoded world-space authored surface tangent
//   radiance  Float32x3 scene-linear RGB (HDR, unclamped), written by the lighting pass
//   material  Uint8     material id (src/shared/materials.js)
//   object    Uint8     0 = static world, n = dynamic instance n (identity for history rejection)
//   velocity  Float32x2 current minus previous screen position, in pixels (camera + object motion)
// World axes: +y up, plan (x, z). Camera yaw 0 looks along +x; right = (-sin, cos). Cameras live in camera.js.
export const FAR = 1e4;
export const CELL = 2; // metres per map cell

export function createGBuffer(w, h) {
  const n = w * h;
  return {
    w, h, depth: new Float32Array(n), normal: new Int16Array(n * 2), tangent: new Int16Array(n * 2), radiance: new Float32Array(n * 3),
    material: new Uint8Array(n), object: new Uint8Array(n), velocity: new Float32Array(n * 2), lum: new Float32Array(n), nrm: new Float32Array(n * 3), // decoded normals, written once per frame by the lighting pass
    bytes: n * (4 + 4 + 4 + 12 + 1 + 1 + 8 + 4),
  };
}

/** Octahedral encode a unit vector into two signed 16-bit integers. */
export function octEncode(x, y, z, out, o) {
  const s = 1 / (Math.abs(x) + Math.abs(y) + Math.abs(z) || 1); let u = x * s, v = z * s;
  if (y < 0) { const tu = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1); v = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1); u = tu; }
  out[o] = Math.round(u * 32767); out[o + 1] = Math.round(v * 32767);
}
export function octDecode(src, o, out) {
  const u = src[o] / 32767, v = src[o + 1] / 32767; let x = u, z = v; const y = 1 - Math.abs(u) - Math.abs(v);
  if (y < 0) { x = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1); z = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1); }
  const l = 1 / Math.hypot(x, y, z); out[0] = x * l; out[1] = y * l; out[2] = z * l; return out;
}

export { makeCamera, setCamera, copyCamera, project, unproject } from './camera.js';
import { project, unproject } from './camera.js';

/**
 * Trace the height-field world into the G-buffer, one DDA per column, exact per-pixel depth.
 * world: {w,h, floorH, ceilH (Infinity = open sky), floorMat, wallMat, ceilMat}
 */
export function traceWorld(gb, world, cam) {
  const { w, h, depth, normal, tangent, material, object } = gb, { f, cy, y: eye } = cam, W = world.w, H = world.h;
  const { floorH, ceilH, floorMat, wallMat, ceilMat } = world;
  depth.fill(FAR); material.fill(0); object.fill(0);
  const nUp = [0, 0], nDown = [0, 0], nX = [[0, 0], [0, 0]], nZ = [[0, 0], [0, 0]], tX = [0, 0], tZ = [0, 0];
  octEncode(0, 1, 0, nUp, 0); octEncode(0, -1, 0, nDown, 0); octEncode(1, 0, 0, nX[0], 0); octEncode(-1, 0, 0, nX[1], 0);
  octEncode(0, 0, 1, nZ[0], 0); octEncode(0, 0, -1, nZ[1], 0); octEncode(1, 0, 0, tX, 0); octEncode(0, 0, 1, tZ, 0);
  for (let x = 0; x < w; x++) {
    const a = (x + 0.5 - w / 2) / f, dx = cam.fx + cam.rx * a, dz = cam.fz + cam.rz * a;
    let cx = Math.floor(cam.x / CELL), cz = Math.floor(cam.z / CELL), top = 0, bot = h - 1, t0 = 0;
    const sX = dx > 0 ? 1 : -1, sZ = dz > 0 ? 1 : -1, tDX = Math.abs(CELL / (dx || 1e-9)), tDZ = Math.abs(CELL / (dz || 1e-9));
    let tMX = (((dx > 0 ? cx + 1 : cx) * CELL) - cam.x) / (dx || 1e-9), tMZ = (((dz > 0 ? cz + 1 : cz) * CELL) - cam.z) / (dz || 1e-9);
    if (cx < 0 || cz < 0 || cx >= W || cz >= H) continue;
    for (let it = 0; it < 96 && top <= bot; it++) {
      const ci = cz * W + cx, fh = floorH[ci], chh = ceilH[ci], side = tMX < tMZ ? 0 : 1, t1 = Math.max(1e-7, side ? tMZ : tMX); // a camera exactly on a cell boundary exits at t = 0
      if (fh < eye) { // floor span
        const k = (eye - fh) * f, yS = Math.max(top, Math.ceil(cy + k / t1 - 0.5)), yE = t0 > 1e-6 ? Math.min(bot, Math.floor(cy + k / t0 - 0.5)) : bot, m = floorMat[ci];
        for (let y = yS; y <= yE; y++) { const i = y * w + x; depth[i] = k / (y + 0.5 - cy); material[i] = m; normal[i * 2] = nUp[0]; normal[i * 2 + 1] = nUp[1]; tangent[i * 2] = tX[0]; tangent[i * 2 + 1] = tX[1]; }
        if (yS - 1 < bot) bot = yS - 1;
      }
      if (chh < FAR && chh > eye && top <= bot) { // ceiling span
        const k = (chh - eye) * f, yS = t0 > 1e-6 ? Math.max(top, Math.ceil(cy - k / t0 - 0.5)) : top, yE = Math.min(bot, Math.floor(cy - k / t1 - 0.5)), m = ceilMat[ci];
        for (let y = yS; y <= yE; y++) { const i = y * w + x; depth[i] = k / (cy - y - 0.5); material[i] = m; normal[i * 2] = nDown[0]; normal[i * 2 + 1] = nDown[1]; tangent[i * 2] = tX[0]; tangent[i * 2 + 1] = tX[1]; }
        if (yE + 1 > top) top = yE + 1;
      }
      if (top > bot) break;
      if (side) { cz += sZ; tMZ += tDZ; } else { cx += sX; tMX += tDX; }
      if (cx < 0 || cz < 0 || cx >= W || cz >= H) break;
      const ni = cz * W + cx, nfh = floorH[ni], nch = ceilH[ni], nn = side ? nZ[sZ > 0 ? 1 : 0] : nX[sX > 0 ? 1 : 0], tt = side ? tX : tZ, m = wallMat[ni];
      if (nfh > fh) { // riser between the two floors
        const yS = Math.max(top, Math.ceil(cy - ((nfh - eye) * f) / t1 - 0.5)), yE = Math.min(bot, Math.floor(cy - ((fh - eye) * f) / t1 - 0.5));
        for (let y = yS; y <= yE; y++) { const i = y * w + x; depth[i] = t1; material[i] = m; normal[i * 2] = nn[0]; normal[i * 2 + 1] = nn[1]; tangent[i * 2] = tt[0]; tangent[i * 2 + 1] = tt[1]; }
        if (yS - 1 < bot) bot = yS - 1;
      }
      if (nch < chh && top <= bot) { // drop in ceiling height (or the edge of a roof under open sky)
        const hi = chh < FAR ? chh : nch + 0.45;
        const yS = Math.max(top, Math.ceil(cy - ((hi - eye) * f) / t1 - 0.5)), yE = Math.min(bot, Math.floor(cy - ((nch - eye) * f) / t1 - 0.5));
        for (let y = yS; y <= yE; y++) { const i = y * w + x; depth[i] = t1; material[i] = m; normal[i * 2] = nn[0]; normal[i * 2 + 1] = nn[1]; tangent[i * 2] = tt[0]; tangent[i * 2 + 1] = tt[1]; }
        if (yE + 1 > top) top = yE + 1;
      }
      t0 = t1;
    }
  }
}

const P0 = [0, 0, 0], P1 = [0, 0, 0];
/**
 * Rasterise a transformed mesh, perspective-correct, depth-tested.
 * mesh: {tris:Uint16/32 index triples, mat:Uint8 per vertex, count}
 * wp/wn/wt: world position / normal / tangent (Float32 xyz per vertex); pp: previous world positions.
 */
export function rasterMesh(gb, cam, prevCam, mesh, wp, wn, wt, pp, objectId) {
  const { w, h, depth, normal, tangent, material, object, velocity } = gb, nv = mesh.vcount;
  const sc = mesh._sc || (mesh._sc = new Float32Array(nv * 5)); // sx, sy, 1/z, prev sx, prev sy
  for (let v = 0; v < nv; v++) {
    project(cam, wp[v * 3], wp[v * 3 + 1], wp[v * 3 + 2], P0); project(prevCam, pp[v * 3], pp[v * 3 + 1], pp[v * 3 + 2], P1);
    sc[v * 5] = P0[0]; sc[v * 5 + 1] = P0[1]; sc[v * 5 + 2] = P0[2] > 0.2 ? 1 / P0[2] : -1; sc[v * 5 + 3] = P1[2] > 0.05 ? P1[0] : P0[0]; sc[v * 5 + 4] = P1[2] > 0.05 ? P1[1] : P0[1];
  }
  const tris = mesh.tris, mats = mesh.mat; let drawn = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2], wa = sc[a * 5 + 2], wb = sc[b * 5 + 2], wc = sc[c * 5 + 2];
    if (wa < 0 || wb < 0 || wc < 0) continue;
    const ax = sc[a * 5], ay = sc[a * 5 + 1], bx = sc[b * 5], by = sc[b * 5 + 1], cx = sc[c * 5], cy = sc[c * 5 + 1];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (den > -1e-6 && den < 1e-6) continue;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    if (minX > maxX || minY > maxY) continue;
    const inv = 1 / den, m = mats[a]; drawn++;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let p = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) * inv, q = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) * inv, r = 1 - p - q;
      if (p < 0 || q < 0 || r < 0) continue;
      p *= wa; q *= wb; r *= wc; const z = 1 / (p + q + r), i = y * w + x;
      if (z >= depth[i]) continue;
      p *= z; q *= z; r *= z; depth[i] = z; material[i] = m; object[i] = objectId;
      octEncode(p * wn[a * 3] + q * wn[b * 3] + r * wn[c * 3], p * wn[a * 3 + 1] + q * wn[b * 3 + 1] + r * wn[c * 3 + 1], p * wn[a * 3 + 2] + q * wn[b * 3 + 2] + r * wn[c * 3 + 2], normal, i * 2);
      octEncode(p * wt[a * 3] + q * wt[b * 3] + r * wt[c * 3], p * wt[a * 3 + 1] + q * wt[b * 3 + 1] + r * wt[c * 3 + 1], p * wt[a * 3 + 2] + q * wt[b * 3 + 2] + r * wt[c * 3 + 2], tangent, i * 2);
      velocity[i * 2] = px - (p * sc[a * 5 + 3] + q * sc[b * 5 + 3] + r * sc[c * 5 + 3]); velocity[i * 2 + 1] = py - (p * sc[a * 5 + 4] + q * sc[b * 5 + 4] + r * sc[c * 5 + 4]);
    }
  }
  return drawn;
}

/** Velocity of static world pixels from camera motion alone (object id 0). */
export function worldVelocity(gb, cam, prevCam) {
  const { w, h, depth, object, velocity } = gb, P = [0, 0, 0], Q = [0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (object[i]) continue;
    const d = depth[i] >= FAR ? 400 : depth[i]; unproject(cam, x + 0.5, y + 0.5, d, P); project(prevCam, P[0], P[1], P[2], Q);
    if (Q[2] > 0.05) { velocity[i * 2] = x + 0.5 - Q[0]; velocity[i * 2 + 1] = y + 0.5 - Q[1]; } else { velocity[i * 2] = 0; velocity[i * 2 + 1] = 0; }
  }
}
