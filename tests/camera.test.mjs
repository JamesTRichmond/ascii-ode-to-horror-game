// Camera interface: both cameras round-trip, and the dimetric camera has the 2:1 tile edge, monotonic ortho depth
// and a constant pixel scale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCamera, setCamera, setDimetric, project, unproject, ray, pixelScale, metresPerPixel, projectDirection, DIMETRIC, ORTHO_SCALE } from '../src/render/camera.js';
import { CELL } from '../src/render/gbuffer.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const points = [[3.2, 0, 7.5], [10, 1.6, 2], [-4, 2.3, 9.1], [0.5, 0.01, 0.2], [14, 4.6, 14]];

test('project/unproject round-trips for the pinhole camera and for the dimetric camera', () => {
  const S = [0, 0, 0], P = [0, 0, 0];
  for (const cam of [setCamera(makeCamera(320, 180), 1, 1.6, 2, 0.7, 3), setDimetric(makeCamera(320, 180), 20, 18, ORTHO_SCALE.low)]) {
    for (const [x, y, z] of points) {
      if (!cam.ortho) { const dx = x - cam.x, dz = z - cam.z; if (dx * cam.fx + dz * cam.fz < 0.5) continue; } // behind the pinhole: no image
      project(cam, x, y, z, S); unproject(cam, S[0], S[1], S[2], P);
      assert.ok(near(P[0], x, 1e-5) && near(P[1], y, 1e-5) && near(P[2], z, 1e-5), `${cam.ortho ? 'dimetric' : 'pinhole'} round trip ${[x, y, z]} -> ${P}`);
    }
  }
});
test('the view ray reproduces unproject: O + D * depth is the unprojected point in both cameras', () => {
  const R = [0, 0, 0, 0, 0, 0], P = [0, 0, 0];
  for (const cam of [setCamera(makeCamera(320, 180), 1, 1.6, 2, 0.7), setDimetric(makeCamera(320, 180), 20, 18, ORTHO_SCALE.low)]) {
    for (const [sx, sy, d] of [[10.5, 20.5, 6], [160.5, 90.5, 12], [300.5, 170.5, 45]]) {
      ray(cam, sx, sy, R); unproject(cam, sx, sy, d, P);
      for (let k = 0; k < 3; k++) assert.ok(near(R[k] + R[k + 3] * d, P[k], 1e-6));
    }
  }
});
test('dimetric: the tile edges along x and z are equally long and run 2 px across per 1 px down', () => {
  const cam = setDimetric(makeCamera(480, 270), 10, 10, ORTHO_SCALE.high), A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  project(cam, 10, 0, 10, A); project(cam, 10 + CELL, 0, 10, B); project(cam, 10, 0, 10 + CELL, C);
  const ex = [B[0] - A[0], B[1] - A[1]], ez = [C[0] - A[0], C[1] - A[1]];
  assert.ok(near(Math.hypot(...ex), Math.hypot(...ez), 1e-6), 'x and z edges foreshorten equally (dimetric)');
  assert.ok(near(Math.abs(ex[0]) / Math.abs(ex[1]), 2, 1e-6) && near(Math.abs(ez[0]) / Math.abs(ez[1]), 2, 1e-6), `2:1 edge, got ${ex} ${ez}`);
  assert.ok(Math.sign(ex[0]) !== Math.sign(ez[0]) && ex[1] < 0 && ez[1] < 0, 'the two edges open upward to the left and the right');
  assert.ok(near(Math.atan2(Math.abs(ex[1]), Math.abs(ex[0])), Math.atan(0.5), 1e-9), 'the edge rises at atan(1/2) = 26.565 deg on screen');
  assert.ok(near(DIMETRIC.yaw, Math.PI / 4) && near(Math.sin(DIMETRIC.pitch), 0.5));
});
test('dimetric: depth grows monotonically along the view direction and is independent of the pixel', () => {
  const cam = setDimetric(makeCamera(320, 180), 20, 18, ORTHO_SCALE.low), S = [0, 0, 0]; let last = -Infinity;
  for (let t = -10; t <= 10; t += 0.5) { project(cam, 20 + cam.dx * t, cam.dy * t, 18 + cam.dz * t, S); assert.ok(S[2] > last, 'depth increases along the view direction'); assert.ok(near(S[0], 160) && near(S[1], 90), 'and the point stays on the same pixel'); last = S[2]; }
  project(cam, 20, 0, 18, S); const d0 = S[2]; project(cam, 20 + cam.rx * 5, 0, 18 + cam.rz * 5, S); assert.ok(near(S[2], d0), 'moving along the screen right axis does not change depth');
  assert.ok(near(S[0] - 160, 5 * cam.scale), '5 m right is 5 * scale pixels right');
  project(cam, 20, 2, 18, S); assert.ok(S[2] < d0 && S[1] < 90, 'higher is nearer the camera and higher on screen');
});
test('dimetric: pixelScale is the constant ortho scale per tier; the pinhole scale falls off with depth', () => {
  for (const [tier, s] of Object.entries(ORTHO_SCALE)) { const cam = setDimetric(makeCamera(320, 180), 0, 0, s); for (const d of [1, 10, 60, 200]) { assert.equal(pixelScale(cam, d), s, tier); assert.ok(near(metresPerPixel(cam, d) * pixelScale(cam, d), 1)); } }
  const pin = setCamera(makeCamera(320, 180), 0, 1.6, 0, 0); assert.ok(near(pixelScale(pin, 5), pin.f / 5) && near(metresPerPixel(pin, 5), 5 / pin.f) && pixelScale(pin, 10) < pixelScale(pin, 5));
  const cam = setDimetric(makeCamera(320, 180), 0, 0, 14), D = [0, 0]; projectDirection(cam, 7, 7, 60, cam.rx, 0, cam.rz, D); assert.ok(near(D[0], 14) && near(D[1], 0), 'a world direction along screen right projects to scale px/m');
  projectDirection(cam, 7, 7, 60, 0, 1, 0, D); assert.ok(near(D[0], 0) && near(D[1], -14 * Math.cos(DIMETRIC.pitch)), 'up foreshortens by cos(pitch)');
});
