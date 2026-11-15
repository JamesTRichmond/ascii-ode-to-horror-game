// Ghost runs: the input log of a chapter's best completion is stored with the save; on later attempts a second
// simulation replays it tick-for-tick beside the player (the simulation is deterministic, so the ghost walks exactly
// the path of that run). Presentation only: it never touches the player's simulation, logs or hashes.
import { createSim, step } from '../sim/sim.js';
import { encodeInputs, decodeInputs } from './telemetry.js';

/** A record for the save: only for runs that started at tick 0 with this seed. */
export function recordGhost(chapterIndex, seed, log, tick) { return { chapter: chapterIndex, seed, tick, inputs: encodeInputs(log) }; }

/** A playing ghost, or null if the record does not belong to this chapter and seed. */
export function startGhost(rec, chapterIndex, seed) {
  if (!rec || rec.chapter !== chapterIndex || rec.seed !== seed || !Array.isArray(rec.inputs)) return null;
  const sim = createSim(chapterIndex, seed); return { sim, inputs: decodeInputs(rec.inputs), i: 0, prev: null, best: rec.tick };
}
/** Advance one tick in lockstep with the player. */
export function stepGhost(g) {
  if (!g || g.i >= g.inputs.length || g.sim.c.done || g.sim.c.dead) return;
  g.prev = { x: g.sim.p.x, z: g.sim.p.z, ang: g.sim.p.ang }; step(g.sim, g.inputs[g.i++]); g.sim.events.length = 0;
}
/** Interpolated pose in metres for the renderer (null once the ghost has finished). */
export function ghostPose(g, alpha, unit) {
  if (!g || g.sim.c.done || g.sim.c.dead || g.i >= g.inputs.length) return null; const p = g.sim.p, q = g.prev || p, A = (Math.PI * 2) / 4096;
  let d = (p.ang - q.ang) & 4095; if (d > 2048) d -= 4096;
  return { x: (q.x + (p.x - q.x) * alpha) * unit, z: (q.z + (p.z - q.z) * alpha) * unit, yaw: (q.ang + d * alpha) * A };
}
