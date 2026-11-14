// Input collection. Produces one packed integer word per simulation tick; nothing here is authoritative.
import { IN, packInput } from '../sim/sim.js';

const KEYS = { KeyW: IN.FWD, ArrowUp: IN.FWD, KeyS: IN.BACK, ArrowDown: IN.BACK, KeyA: IN.LEFT, KeyD: IN.RIGHT, ArrowLeft: IN.TURNL, ArrowRight: IN.TURNR, KeyQ: IN.TURNL, Space: IN.HUM, KeyF: IN.CHORD, ShiftLeft: IN.HOLD, ShiftRight: IN.HOLD, KeyE: IN.USE, Enter: IN.USE };

export function createInput(canvas, opts) {
  const st = { buttons: 0, turn: 0, taps: 0, locked: false, sensitivity: 1, enabled: false, onPause: null };
  const down = e => { if ((e.code === 'Escape' || e.code === 'KeyP') && e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); return; } /* auto-repeat of a held pause key must never resume */ if (!st.enabled) return; if (e.code === 'Escape' || e.code === 'KeyP') { st.onPause?.(); e.preventDefault(); e.stopImmediatePropagation(); return; } /* the same press must not also resume */ const b = KEYS[e.code]; if (b) { st.buttons |= b; st.taps |= b; e.preventDefault(); } };
  const up = e => { const b = KEYS[e.code]; if (b) st.buttons &= ~b; };
  addEventListener('keydown', down); addEventListener('keyup', up); addEventListener('blur', () => { st.buttons = 0; });
  canvas.addEventListener('click', () => { if (st.enabled && !st.locked && opts?.pointerLock !== false) canvas.requestPointerLock?.(); });
  document.addEventListener('pointerlockchange', () => { st.locked = document.pointerLockElement === canvas; });
  addEventListener('mousemove', e => { if (st.locked && st.enabled) st.turn += e.movementX * 1.6 * st.sensitivity; });
  addEventListener('mousedown', e => { if (st.locked && st.enabled && e.button === 0) st.taps |= IN.CHORD; });
  for (const b of document.querySelectorAll('#touch [data-in]')) {
    const bit = +b.dataset.in, on = e => { st.buttons |= bit; st.taps |= bit; e.preventDefault(); }, off = e => { st.buttons &= ~bit; e.preventDefault(); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  }
  /** Consume input for exactly one tick. Taps guarantee a press shorter than a tick is not lost. */
  st.poll = () => { const t = Math.trunc(st.turn); st.turn -= t; const w = packInput(st.buttons | st.taps, t); st.taps = 0; return w; };
  st.reset = () => { st.buttons = 0; st.taps = 0; st.turn = 0; };
  return st;
}
