// Input collection. Produces one packed integer word per simulation tick; nothing here is authoritative.
import { IN, packInput } from '../sim/sim.js';
import { DEFAULT_BINDINGS, keymap } from './bindings.js';

export function createInput(canvas, opts) {
  const st = { buttons: 0, turn: 0, taps: 0, latched: 0, toggle: false, locked: false, sensitivity: 1, enabled: false, onPause: null };
  const LATCHABLE = IN.HUM | IN.HOLD; // with st.toggle (assist), a press latches these on and the next press releases them
  let { keys: KEYS, pause: PAUSE } = keymap(DEFAULT_BINDINGS);
  /** Apply a full bindings object (see bindings.js); held keys are released so nothing sticks across a change. */
  st.setBindings = b => { ({ keys: KEYS, pause: PAUSE } = keymap(b)); st.buttons = 0; };
  const down = e => { if (st.capture) return; if (PAUSE.has(e.code) && e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); return; } /* auto-repeat of a held pause key must never resume */ if (!st.enabled) return; if (PAUSE.has(e.code)) { st.onPause?.(); e.preventDefault(); e.stopImmediatePropagation(); return; } /* the same press must not also resume */ const b = KEYS[e.code]; if (b) { e.preventDefault(); if (st.toggle && b & LATCHABLE) { if (!e.repeat) st.latched ^= b & LATCHABLE; if (!(b & ~LATCHABLE)) return; } st.buttons |= b & (st.toggle ? ~LATCHABLE : ~0); st.taps |= b & (st.toggle ? ~LATCHABLE : ~0); } };
  const up = e => { const b = KEYS[e.code]; if (b) st.buttons &= ~(st.toggle ? b & ~LATCHABLE : b); };
  addEventListener('keydown', down); addEventListener('keyup', up); addEventListener('blur', () => { st.buttons = 0; });
  canvas.addEventListener('click', () => { if (st.enabled && !st.locked && opts?.pointerLock !== false) canvas.requestPointerLock?.()?.catch?.(() => { /* denied or cancelled lock is ordinary play, not a crash */ }); });
  document.addEventListener('pointerlockchange', () => { st.locked = document.pointerLockElement === canvas; });
  addEventListener('mousemove', e => { if (st.locked && st.enabled) st.turn += e.movementX * 1.6 * st.sensitivity; });
  addEventListener('mousedown', e => { if (st.locked && st.enabled && e.button === 0) st.taps |= IN.CHORD; });
  for (const b of document.querySelectorAll('#touch [data-in]')) {
    const bit = +b.dataset.in, latch = () => st.toggle && bit & LATCHABLE;
    const on = e => { e.preventDefault(); if (latch()) { st.latched ^= bit; b.setAttribute('aria-pressed', String(!!(st.latched & bit))); return; } st.buttons |= bit; st.taps |= bit; }, off = e => { e.preventDefault(); if (!latch()) st.buttons &= ~bit; };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  }
  /** Consume input for exactly one tick. Taps guarantee a press shorter than a tick is not lost. */
  st.poll = () => { const t = Math.trunc(st.turn); st.turn -= t; const w = packInput(st.buttons | st.taps | st.latched, t); st.taps = 0; return w; };
  st.reset = () => { st.buttons = 0; st.taps = 0; st.turn = 0; st.latched = 0; };
  return st;
}
