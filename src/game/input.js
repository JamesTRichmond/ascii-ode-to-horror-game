// Input collection. Produces one packed integer word per simulation tick; nothing here is authoritative.
import { IN, packInput } from '../sim/sim.js';
import { gamepadInput, menuIntent, snapshot, PAD } from './gamepad.js';
import { DEFAULT_BINDINGS, keymap } from './bindings.js';

export function createInput(canvas, opts) {
  const st = { buttons: 0, turn: 0, taps: 0, locked: false, sensitivity: 1, enabled: false, onPause: null, onMenuBack: null, vibration: true };
  let { keys: KEYS, pause: PAUSE } = keymap(DEFAULT_BINDINGS);
  /** Apply a full bindings object (see bindings.js); held keys are released so nothing sticks across a change. */
  st.setBindings = b => { ({ keys: KEYS, pause: PAUSE } = keymap(b)); st.buttons = 0; };
  const down = e => { if (st.capture) return; if (PAUSE.has(e.code) && e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); return; } /* auto-repeat of a held pause key must never resume */ if (!st.enabled) return; if (PAUSE.has(e.code)) { st.onPause?.(); e.preventDefault(); e.stopImmediatePropagation(); return; } /* the same press must not also resume */ const b = KEYS[e.code]; if (b) { st.buttons |= b; st.taps |= b; e.preventDefault(); } };
  const up = e => { const b = KEYS[e.code]; if (b) st.buttons &= ~b; };
  addEventListener('keydown', down); addEventListener('keyup', up); addEventListener('blur', () => { st.buttons = 0; });
  canvas.addEventListener('click', () => { if (st.enabled && !st.locked && opts?.pointerLock !== false) canvas.requestPointerLock?.()?.catch?.(() => { /* denied or cancelled lock is ordinary play, not a crash */ }); });
  document.addEventListener('pointerlockchange', () => { st.locked = document.pointerLockElement === canvas; });
  addEventListener('mousemove', e => { if (st.locked && st.enabled) st.turn += e.movementX * 1.6 * st.sensitivity; });
  addEventListener('mousedown', e => { if (st.locked && st.enabled && e.button === 0) st.taps |= IN.CHORD; });
  for (const b of document.querySelectorAll('#touch [data-in]')) {
    const bit = +b.dataset.in, on = e => { st.buttons |= bit; st.taps |= bit; e.preventDefault(); }, off = e => { st.buttons &= ~bit; e.preventDefault(); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  }
  /** Consume input for exactly one tick. Taps guarantee a press shorter than a tick is not lost. */
  const pad = () => { const all = [...(globalThis.navigator?.getGamepads?.() || [])].filter(p => p?.connected); return all.find(p => p.mapping === 'standard') || all[0] || null; };
  let padPrev = null;
  st.poll = () => {
    const gp = pad(), g = gamepadInput(gp, st.sensitivity); st.turn += g.turn;
    if (gp && st.enabled && gp.buttons[PAD.START]?.pressed && !padPrev?.buttons[PAD.START]?.pressed) { padPrev = snapshot(gp); st.onPause?.(); return packInput(0, 0); }
    padPrev = snapshot(gp);
    const t = Math.trunc(st.turn); st.turn -= t; const w = packInput(st.buttons | st.taps | g.buttons, t); st.taps = 0; return w;
  };
  /** Menus by controller: called every frame while a menu is open. Focus moves among the dialog's controls. */
  st.menuPoll = () => {
    const gp = pad(), intent = menuIntent(gp, padPrev); padPrev = snapshot(gp); if (!intent) return;
    const menu = document.getElementById('menu'); if (!menu || menu.hidden) return;
    const items = [...menu.querySelectorAll('button:not([disabled]),select,input,textarea')], cur = document.activeElement, i = items.indexOf(cur);
    if (intent === 'down' || intent === 'up') { const n = items.length; if (!n) return; const step = intent === 'down' ? 1 : -1; items[i < 0 ? (step > 0 ? 0 : n - 1) : (i + step + n) % n].focus(); }
    else if (intent === 'left' || intent === 'right') { const d = intent === 'right' ? 1 : -1;
      if (cur?.type === 'range') { cur.value = +cur.value + d * +(cur.step || 1); cur.dispatchEvent(new Event('change', { bubbles: true })); }
      else if (cur?.tagName === 'SELECT') { cur.selectedIndex = Math.max(0, Math.min(cur.options.length - 1, cur.selectedIndex + d)); cur.dispatchEvent(new Event('change', { bubbles: true })); }
      else if (items.length) items[((i < 0 ? 0 : i) + d + items.length) % items.length].focus(); }
    else if (intent === 'activate') { if (items.includes(cur)) cur.click(); else items[0]?.focus(); }
    else st.onMenuBack?.(intent);
  };
  /** Controller rumble (dual-rumble actuator) when available and enabled. */
  st.rumble = (strength, ms) => { if (!st.vibration) return; const a = pad()?.vibrationActuator; a?.playEffect?.('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: Math.min(1, strength * 0.6), strongMagnitude: Math.min(1, strength) })?.catch?.(() => { /* actuator busy or absent */ }); };
  st.reset = () => { st.buttons = 0; st.taps = 0; st.turn = 0; };
  return st;
}
