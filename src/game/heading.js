// Screen-relative movement for the dimetric camera, done in the shell only: W/A/S/D (or the left stick) name a direction
// on the screen, which is turned into the world heading the singer should face and walk along. The simulation keeps its
// facing-relative input word unchanged: we emit turn = wrap(desired - facing), clamped to the word's ±2047, plus FWD.
// While idle nothing is emitted for movement, so the facing stays where it was.
import { IN } from '../sim/sim.js';

const ANG = 4096, MOVE = IN.FWD | IN.BACK | IN.LEFT | IN.RIGHT, TURN = IN.TURNL | IN.TURNR;
/** Shortest signed turn from `from` to `to` in angle units, within the input word's range. */
export const wrapTurn = (from, to) => { let d = (to - from) & (ANG - 1); if (d > 2048) d -= ANG; return Math.max(-2047, Math.min(2047, d)); };

/**
 * Map one tick of screen-relative input to the simulation's facing-relative buttons and turn.
 * buttons: IN bits where FWD/BACK/LEFT/RIGHT mean screen up/down/left/right; stick: [x, y] in -1..1 (y down) or null;
 * ang: the singer's current facing in angle units; camYaw: the camera's azimuth in radians (screen up in the world).
 * @returns {buttons, turn}; `turn` replaces the mouse or stick turn whenever there is movement.
 */
export function screenInput(buttons, stick, ang, camYaw, idleTurn = 0) {
  let sx = 0, sy = 0; // screen-space intent: x right, y up
  if (stick && (stick[0] || stick[1])) { sx = stick[0]; sy = -stick[1]; }
  else { sx = (buttons & IN.RIGHT ? 1 : 0) - (buttons & IN.LEFT ? 1 : 0); sy = (buttons & IN.FWD ? 1 : 0) - (buttons & IN.BACK ? 1 : 0); }
  if (!sx && !sy) return { buttons: buttons & ~MOVE, turn: idleTurn };
  const fx = Math.cos(camYaw), fz = Math.sin(camYaw), wx = fx * sy - fz * sx, wz = fz * sy + fx * sx; // screen up = camera forward, screen right = camera right
  const desired = Math.round((Math.atan2(wz, wx) / (Math.PI * 2)) * ANG) & (ANG - 1);
  return { buttons: (buttons & ~(MOVE | TURN)) | IN.FWD, turn: wrapTurn(ang, desired) };
}
