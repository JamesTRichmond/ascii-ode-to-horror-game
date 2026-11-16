// Rebindable keyboard controls. Bindings are { action: [KeyboardEvent.code, ...] }, stored in settings.
// Escape always pauses and backs out of menus and Tab always moves focus, so neither can be bound (no lock-out).
import { IN } from '../sim/sim.js';

export const ACTIONS = [
  ['FWD', 'Walk forward'], ['BACK', 'Walk back'], ['LEFT', 'Strafe left'], ['RIGHT', 'Strafe right'], ['TURNL', 'Turn left'], ['TURNR', 'Turn right'],
  ['HUM', 'Hum (hold)'], ['CHORD', 'Chord'], ['HOLD', 'Hold your breath (hold)'], ['USE', 'Use'], ['PAUSE', 'Pause (Esc always works)'],
];
export const DEFAULT_BINDINGS = { FWD: ['KeyW', 'ArrowUp'], BACK: ['KeyS', 'ArrowDown'], LEFT: ['KeyA'], RIGHT: ['KeyD'], TURNL: ['ArrowLeft', 'KeyQ'], TURNR: ['ArrowRight'], HUM: ['Space'], CHORD: ['KeyF'], HOLD: ['ShiftLeft', 'ShiftRight'], USE: ['KeyE', 'Enter'], PAUSE: ['KeyP'] };
export const RESERVED = new Set(['Escape', 'Tab']);

/** Merge stored bindings over the defaults, dropping anything malformed or reserved. */
export function normalise(stored) {
  const out = {}; for (const [a] of ACTIONS) out[a] = [...DEFAULT_BINDINGS[a]];
  if (stored && typeof stored === 'object') for (const [a] of ACTIONS) if (Array.isArray(stored[a])) out[a] = stored[a].filter(c => typeof c === 'string' && /^[A-Za-z0-9]+$/.test(c) && !RESERVED.has(c)).slice(0, 3);
  return out;
}
/** code -> IN bit map for play, and the set of extra pause codes. */
export function keymap(bindings) {
  const keys = {}, pause = new Set(['Escape']);
  for (const [a, codes] of Object.entries(bindings)) for (const c of codes) { if (a === 'PAUSE') pause.add(c); else keys[c] = (keys[c] || 0) | IN[a]; }
  return { keys, pause };
}
/** Bind `code` as the primary key of `action`. The code is taken from any other action that had it.
 *  @returns {bindings, moved: action | null}; throws for reserved keys. */
export function rebind(bindings, action, code) {
  if (RESERVED.has(code)) throw new Error(`${keyName(code)} is reserved: Esc pauses and backs out, Tab moves between controls.`);
  const out = {}; let moved = null;
  for (const [a, codes] of Object.entries(bindings)) { out[a] = codes.filter(c => c !== code); if (a !== action && out[a].length !== codes.length) moved = a; }
  out[action] = [code, ...out[action].filter((c, i) => i > 0 || c === code)].slice(0, 2); // new primary; keep the old secondary
  return { bindings: out, moved };
}
const NAMES = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps Lock', Escape: 'Esc', Tab: 'Tab' };
export function keyName(code) { return NAMES[code] || code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ') || code; }
export const describe = (bindings, action) => (bindings[action] || []).map(keyName).join(' / ') || 'unbound';
