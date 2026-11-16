// Spatial audio maths, separate from WebAudio so it can be tested: listener-relative positions for HRTF panning and
// occlusion by walls, traced through the simulation's tile grid.
import { solidAt } from '../sim/sim.js';

export const METRES_PER_CELL = 2, UNIT = 1024;

/** Position of a world point relative to the listener, in metres, in WebAudio's default listener frame
 *  (listener at the origin facing -Z, +X to the right). The simulation's right vector is (-sin, cos). */
export function relativePosition(L, x, z) {
  const th = L.yaw, dx = (x - L.x) / UNIT * METRES_PER_CELL, dz = (z - L.z) / UNIT * METRES_PER_CELL;
  const fwd = dx * Math.cos(th) + dz * Math.sin(th), right = -dx * Math.sin(th) + dz * Math.cos(th);
  return { x: right, y: 0, z: -fwd };
}

/** Solid cells crossed by the segment from (ax, az) to (bx, bz) (simulation units), excluding the two end cells.
 *  Amanatides–Woo grid traversal: every cell the segment touches is visited exactly once. */
export function occlusion(sim, ax, az, bx, bz, cap = 3) {
  let cx = Math.floor(ax / UNIT), cz = Math.floor(az / UNIT); const ex = Math.floor(bx / UNIT), ez = Math.floor(bz / UNIT);
  const dx = bx - ax, dz = bz - az, sx = Math.sign(dx), sz = Math.sign(dz);
  const tdx = dx ? Math.abs(UNIT / dx) : Infinity, tdz = dz ? Math.abs(UNIT / dz) : Infinity;
  let tx = dx ? ((sx > 0 ? (cx + 1) * UNIT - ax : ax - cx * UNIT) / Math.abs(dx)) : Infinity, tz = dz ? ((sz > 0 ? (cz + 1) * UNIT - az : az - cz * UNIT) / Math.abs(dz)) : Infinity;
  let n = 0;
  for (let guard = 0; guard < 256 && !(cx === ex && cz === ez); guard++) {
    if (tx < tz) { cx += sx; tx += tdx; } else { cz += sz; tz += tdz; }
    if (cx === ex && cz === ez) break;
    if (solidAt(sim, cx, cz) && ++n >= cap) break;
  }
  return n;
}
/** Low-pass cutoff and gain for a number of occluding cells: walls muffle highs first, then volume. */
export function occlusionFilter(n) { return n <= 0 ? { freq: 20000, gain: 1 } : n === 1 ? { freq: 900, gain: 0.55 } : n === 2 ? { freq: 450, gain: 0.32 } : { freq: 260, gain: 0.2 }; }
