// Cameras. Every pass goes through this interface, never through the camera's fields directly:
//   project(cam, x, y, z, out)        world -> [screenX, screenY, depth]
//   unproject(cam, sx, sy, depth, out) pixel + depth -> world
//   ray(cam, sx, sy, out)             the pixel's view ray as [ox, oy, oz, dx, dy, dz]; P = O + D * depth
//   pixelScale(cam, depth)            pixels per metre at that depth (glyph size, flow Jacobian)
//   projectDirection(...)             screen-space direction of a world direction at a pixel
//   skyCoords(cam, sx, sy, out)       [azimuth, elevation slope] of a pixel that missed the world
// Depth is measured along the view direction (perpendicular depth), FAR for sky. The plan forward (fx, fz) is
// the horizontal facing in both cameras and is what culling, the rim and the fog terms read.
// Today's yaw-only pinhole camera is the first implementation; the dimetric camera follows.
// World axes: +y up, plan (x, z). Yaw 0 looks along +x; right = (-sin, cos).

export function makeCamera(w, h, fovDeg = 74) {
  return { w, h, f: (w / 2) / Math.tan((fovDeg * Math.PI) / 360), x: 0, y: 1.6, z: 0, yaw: 0, cy: h / 2, fx: 1, fz: 0, rx: 0, rz: 1 };
}
export function setCamera(cam, x, y, z, yaw, bob = 0) {
  cam.x = x; cam.y = y; cam.z = z; cam.yaw = yaw; cam.fx = Math.cos(yaw); cam.fz = Math.sin(yaw); cam.rx = -cam.fz; cam.rz = cam.fx; cam.cy = cam.h / 2 + bob; return cam;
}
export const copyCamera = (dst, src) => Object.assign(dst, src);

/** World -> [screenX, screenY, depth]. */
export function project(cam, px, py, pz, out) {
  const qx = px - cam.x, qy = py - cam.y, qz = pz - cam.z;
  const zc = qx * cam.fx + qz * cam.fz, xc = qx * cam.rx + qz * cam.rz;
  out[0] = cam.w / 2 + (xc * cam.f) / zc; out[1] = cam.cy - (qy * cam.f) / zc; out[2] = zc; return out;
}
/** Pixel centre + depth -> world position. */
export function unproject(cam, sx, sy, depth, out) {
  const a = (sx - cam.w / 2) / cam.f;
  out[0] = cam.x + (cam.fx + cam.rx * a) * depth; out[2] = cam.z + (cam.fz + cam.rz * a) * depth; out[1] = cam.y - ((sy - cam.cy) * depth) / cam.f; return out;
}
/** View ray of a pixel: out = [ox, oy, oz, dx, dy, dz] with P(depth) = O + D * depth. The pinhole direction has unit
 *  forward component (so it is not unit length). */
export function ray(cam, sx, sy, out) {
  const a = (sx - cam.w / 2) / cam.f, vy = (sy - cam.cy) / cam.f;
  out[0] = cam.x; out[1] = cam.y; out[2] = cam.z; out[3] = cam.fx + cam.rx * a; out[4] = -vy; out[5] = cam.fz + cam.rz * a; return out;
}
/** Pixels per metre for a surface at that depth. */
export const pixelScale = (cam, depth) => cam.f / depth;
/** Metres per pixel at that depth: the inverse, kept as its own expression so the output is unchanged. */
export const metresPerPixel = (cam, depth) => depth / cam.f;
/** Screen-space direction (pixels per metre) of world direction (tx,ty,tz) at pixel (sx,sy) with depth d. */
export function projectDirection(cam, sx, sy, d, tx, ty, tz, out) {
  const ax = tx * cam.rx + tz * cam.rz, az = tx * cam.fx + tz * cam.fz, xc = ((sx - cam.w / 2) * d) / cam.f, yc = (-(sy - cam.cy) * d) / cam.f;
  out[0] = (cam.f * (ax * d - xc * az)) / (d * d); out[1] = (-cam.f * (ty * d - yc * az)) / (d * d); return out;
}
/** Sky backdrop coordinates of a pixel: [azimuth (rad), slope below the horizon (negative = up)]. */
export function skyCoords(cam, sx, sy, out) {
  out[0] = cam.yaw + Math.atan((sx - cam.w / 2) / cam.f); out[1] = (sy - cam.cy) / cam.f; return out;
}
