// Cameras. Every pass goes through this interface, never through the camera's fields directly:
//   project(cam, x, y, z, out)        world -> [screenX, screenY, depth]
//   unproject(cam, sx, sy, depth, out) pixel + depth -> world
//   ray(cam, sx, sy, out)             the pixel's view ray as [ox, oy, oz, dx, dy, dz]; P = O + D * depth
//   pixelScale(cam, depth)            pixels per metre at that depth (glyph size, flow Jacobian)
//   projectDirection(...)             screen-space direction of a world direction at a pixel
//   skyCoords(cam, sx, sy, out)       [azimuth, elevation slope] of a pixel that missed the world
// Depth is measured along the view direction (perpendicular depth), FAR for sky. The plan forward (fx, fz) is
// the horizontal facing in both cameras and is what culling, the rim and the fog terms read.
// Two cameras share the same record: cam.ortho = 0 is the yaw-only pinhole camera (first person, photo mode),
// cam.ortho = 1 the dimetric camera (parallel rays at a fixed azimuth and elevation, orthographic scale).
// World axes: +y up, plan (x, z). Yaw 0 looks along +x; right = (-sin, cos).

/** Dimetric constants: azimuth 45 deg so x and z edges foreshorten equally, elevation asin(1/2) = 30 deg so a tile
 *  edge on screen runs 2 px across for every 1 px down (the classic 2:1 edge, atan(1/2) = 26.565 deg above horizontal).
 *  Pixels are square on the output canvas (the G-buffer keeps the 16:9 aspect), so no glyph-cell correction is needed. */
export const DIMETRIC = { yaw: Math.PI / 4, pitch: Math.asin(0.5), back: 60, aspect: 1 };
/** Orthographic scale (pixels per metre along the screen's right axis) per quality tier: the same world extent at every tier. */
export const ORTHO_SCALE = { low: 14, medium: 17.5, high: 21 };

export function makeCamera(w, h, fovDeg = 74) {
  return { w, h, ortho: 0, f: (w / 2) / Math.tan((fovDeg * Math.PI) / 360), x: 0, y: 1.6, z: 0, yaw: 0, cy: h / 2, fx: 1, fz: 0, rx: 0, rz: 1, scale: 1, sy: 1, dx: 1, dy: 0, dz: 0, ux: 0, uy: 1, uz: 0 };
}
export function setCamera(cam, x, y, z, yaw, bob = 0) {
  cam.ortho = 0; cam.x = x; cam.y = y; cam.z = z; cam.yaw = yaw; cam.fx = Math.cos(yaw); cam.fz = Math.sin(yaw); cam.rx = -cam.fz; cam.rz = cam.fx; cam.cy = cam.h / 2 + bob; return cam;
}
/** Dimetric camera looking at the plan point (tx, tz) at ground level, which lands on the screen centre. */
export function setDimetric(cam, tx, tz, scale, yaw = DIMETRIC.yaw, pitch = DIMETRIC.pitch) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  cam.ortho = 1; cam.yaw = yaw; cam.fx = Math.cos(yaw); cam.fz = Math.sin(yaw); cam.rx = -cam.fz; cam.rz = cam.fx; cam.cy = cam.h / 2;
  cam.dx = cam.fx * cp; cam.dy = -sp; cam.dz = cam.fz * cp; cam.ux = cam.fx * sp; cam.uy = cp; cam.uz = cam.fz * sp;
  cam.scale = scale; cam.sy = scale * DIMETRIC.aspect; cam.f = scale * DIMETRIC.back; // f keeps a perspective-equivalent focal length for code that reads it as a size hint
  cam.x = tx - cam.dx * DIMETRIC.back; cam.y = -cam.dy * DIMETRIC.back; cam.z = tz - cam.dz * DIMETRIC.back; return cam;
}
export const copyCamera = (dst, src) => Object.assign(dst, src);

/** World -> [screenX, screenY, depth]. */
export function project(cam, px, py, pz, out) {
  const qx = px - cam.x, qy = py - cam.y, qz = pz - cam.z;
  if (cam.ortho) { out[0] = cam.w / 2 + (qx * cam.rx + qz * cam.rz) * cam.scale; out[1] = cam.cy - (qx * cam.ux + qy * cam.uy + qz * cam.uz) * cam.sy; out[2] = qx * cam.dx + qy * cam.dy + qz * cam.dz; return out; }
  const zc = qx * cam.fx + qz * cam.fz, xc = qx * cam.rx + qz * cam.rz;
  out[0] = cam.w / 2 + (xc * cam.f) / zc; out[1] = cam.cy - (qy * cam.f) / zc; out[2] = zc; return out;
}
/** Pixel centre + depth -> world position. */
export function unproject(cam, sx, sy, depth, out) {
  if (cam.ortho) { const u = (sx - cam.w / 2) / cam.scale, v = (cam.cy - sy) / cam.sy; out[0] = cam.x + cam.rx * u + cam.ux * v + cam.dx * depth; out[1] = cam.y + cam.uy * v + cam.dy * depth; out[2] = cam.z + cam.rz * u + cam.uz * v + cam.dz * depth; return out; }
  const a = (sx - cam.w / 2) / cam.f;
  out[0] = cam.x + (cam.fx + cam.rx * a) * depth; out[2] = cam.z + (cam.fz + cam.rz * a) * depth; out[1] = cam.y - ((sy - cam.cy) * depth) / cam.f; return out;
}
/** View ray of a pixel: out = [ox, oy, oz, dx, dy, dz] with P(depth) = O + D * depth. The pinhole direction has unit
 *  forward component (so it is not unit length); the dimetric direction is unit and shared by every pixel. */
export function ray(cam, sx, sy, out) {
  if (cam.ortho) { const u = (sx - cam.w / 2) / cam.scale, v = (cam.cy - sy) / cam.sy; out[0] = cam.x + cam.rx * u + cam.ux * v; out[1] = cam.y + cam.uy * v; out[2] = cam.z + cam.rz * u + cam.uz * v; out[3] = cam.dx; out[4] = cam.dy; out[5] = cam.dz; return out; }
  const a = (sx - cam.w / 2) / cam.f, vy = (sy - cam.cy) / cam.f;
  out[0] = cam.x; out[1] = cam.y; out[2] = cam.z; out[3] = cam.fx + cam.rx * a; out[4] = -vy; out[5] = cam.fz + cam.rz * a; return out;
}
/** Pixels per metre for a surface at that depth (constant under the orthographic camera). */
export const pixelScale = (cam, depth) => (cam.ortho ? cam.scale : cam.f / depth);
/** Metres per pixel at that depth: the inverse, kept as its own expression so the pinhole output is unchanged. */
export const metresPerPixel = (cam, depth) => (cam.ortho ? 1 / cam.scale : depth / cam.f);
/** Screen-space direction (pixels per metre) of world direction (tx,ty,tz) at pixel (sx,sy) with depth d. */
export function projectDirection(cam, sx, sy, d, tx, ty, tz, out) {
  if (cam.ortho) { out[0] = (tx * cam.rx + tz * cam.rz) * cam.scale; out[1] = -(tx * cam.ux + ty * cam.uy + tz * cam.uz) * cam.sy; return out; }
  const ax = tx * cam.rx + tz * cam.rz, az = tx * cam.fx + tz * cam.fz, xc = ((sx - cam.w / 2) * d) / cam.f, yc = (-(sy - cam.cy) * d) / cam.f;
  out[0] = (cam.f * (ax * d - xc * az)) / (d * d); out[1] = (-cam.f * (ty * d - yc * az)) / (d * d); return out;
}
/** Sky backdrop coordinates of a pixel: [azimuth (rad), slope below the horizon (negative = up)]. Parallel rays have
 *  one direction, so the dimetric sky is a flat backdrop keyed on screen position instead. */
export function skyCoords(cam, sx, sy, out) {
  if (cam.ortho) { out[0] = cam.yaw + ((sx - cam.w / 2) / cam.w) * 1.2; out[1] = (sy - cam.cy) / cam.h - 0.5; return out; }
  out[0] = cam.yaw + Math.atan((sx - cam.w / 2) / cam.f); out[1] = (sy - cam.cy) / cam.f; return out;
}
