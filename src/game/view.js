// Presentation snapshot: interpolates two simulation states into a float view. Read-only on the sim.
import { CELL } from '../render/gbuffer.js';
const U = CELL / 1024, A = (Math.PI * 2) / 4096;
const lerpAng = (a, b, t) => { let d = (b - a) & 4095; if (d > 2048) d -= 4096; return (a + d * t) * A; };

/** prev: {p:{x,z,ang}, ents:[{x,z,ang}]} snapshot taken before the latest tick; cur: live sim state. */
export function viewOf(prev, cur, alpha) {
  const pp = prev.p, cp = cur.p, ents = [];
  for (let i = 0; i < cur.ents.length; i++) {
    const e = cur.ents[i], q = prev.ents[i] && prev.ents[i].type === e.type ? prev.ents[i] : e;
    const jump = Math.abs(e.x - q.x) + Math.abs(e.z - q.z) > 600; // teleports (ejection, respawn) are not interpolated
    ents.push({ type: e.type, mode: e.mode, x: (jump ? e.x : q.x + (e.x - q.x) * alpha) * U, z: (jump ? e.z : q.z + (e.z - q.z) * alpha) * U, yaw: lerpAng(q.ang, e.ang, alpha) });
  }
  const jumpP = Math.abs(cp.x - pp.x) + Math.abs(cp.z - pp.z) > 600;
  return { sim: cur, x: (jumpP ? cp.x : pp.x + (cp.x - pp.x) * alpha) * U, z: (jumpP ? cp.z : pp.z + (cp.z - pp.z) * alpha) * U, yaw: lerpAng(pp.ang, cp.ang, alpha), hold: cp.hold, bob: 0, ents };
}
/** Minimal copy of what interpolation needs. */
export const snapshot = s => ({ p: { x: s.p.x, z: s.p.z, ang: s.p.ang }, ents: s.ents.map(e => ({ type: e.type, x: e.x, z: e.z, ang: e.ang })) });
