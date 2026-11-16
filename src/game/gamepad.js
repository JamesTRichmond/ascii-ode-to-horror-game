// Gamepad support (W3C Gamepad API, "standard" mapping). Pure mapping functions are separate from the browser
// polling so they can be tested without a device.
//   play:  left stick / D-pad move (radial dead zone, diagonals normalised) · right stick turns (analog, response curve)
//          RT hum · LT hold breath · RB or X chord · A use · Start pause
//   menus: D-pad / left stick up/down move focus, left/right adjust a focused slider or list · A activates · B backs out · Start resumes
import { IN } from '../sim/sim.js';

export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
export const DEAD = 0.22, TRIGGER = 0.35, TURN_MAX = 150; // turn units per tick at full deflection (keyboard turn is 44)

const pressed = (gp, i) => { const b = gp.buttons[i]; return !!b && (b.pressed || b.value > TRIGGER); };
/** Radial dead zone with rescale: |out| = 0 inside DEAD, 0..1 linearly outside. */
export function deadzone(x, y, dz = DEAD) { const m = Math.hypot(x, y); if (m < dz) return [0, 0]; const k = Math.min(1, (m - dz) / (1 - dz)) / m; return [x * k, y * k]; }

/** Map one gamepad snapshot to the simulation's buttons and turn amount for one tick. */
export function gamepadInput(gp, sensitivity = 1) {
  if (!gp || !gp.connected) return { buttons: 0, turn: 0 };
  let b = 0; const [lx, ly] = deadzone(gp.axes[0] || 0, gp.axes[1] || 0), [rx] = deadzone(gp.axes[2] || 0, 0);
  if (ly < -0.3 || pressed(gp, PAD.UP)) b |= IN.FWD; if (ly > 0.3 || pressed(gp, PAD.DOWN)) b |= IN.BACK;
  if (lx < -0.3 || pressed(gp, PAD.LEFT)) b |= IN.LEFT; if (lx > 0.3 || pressed(gp, PAD.RIGHT)) b |= IN.RIGHT;
  if (pressed(gp, PAD.RT)) b |= IN.HUM; if (pressed(gp, PAD.LT)) b |= IN.HOLD; if (pressed(gp, PAD.RB) || pressed(gp, PAD.X)) b |= IN.CHORD; if (pressed(gp, PAD.A)) b |= IN.USE;
  const turn = Math.sign(rx) * Math.abs(rx) ** 1.6 * TURN_MAX * sensitivity; // gentle near the centre, fast at the edge
  return { buttons: b, turn };
}

/** Menu intents from the change between two snapshots: 'down' | 'up' | 'left' | 'right' | 'activate' | 'back' | 'start' | null. */
export function menuIntent(gp, prev) {
  if (!gp || !gp.connected) return null; const was = i => !!prev && pressed(prev, i), now = i => pressed(gp, i), edge = i => now(i) && !was(i);
  const [lx, ly] = deadzone(gp.axes[0] || 0, gp.axes[1] || 0), [plx, ply] = prev ? deadzone(prev.axes[0] || 0, prev.axes[1] || 0) : [0, 0];
  if (edge(PAD.DOWN) || (ly > 0.5 && ply <= 0.5)) return 'down'; if (edge(PAD.UP) || (ly < -0.5 && ply >= -0.5)) return 'up';
  if (edge(PAD.RIGHT) || (lx > 0.5 && plx <= 0.5)) return 'right'; if (edge(PAD.LEFT) || (lx < -0.5 && plx >= -0.5)) return 'left';
  if (edge(PAD.A)) return 'activate'; if (edge(PAD.B)) return 'back'; if (edge(PAD.START)) return 'start';
  return null;
}
/** Copy the parts of a live Gamepad we compare between frames (Chromium reuses the object). */
export const snapshot = gp => gp && { connected: gp.connected, axes: [...gp.axes], buttons: gp.buttons.map(b => ({ pressed: b.pressed, value: b.value })) };
