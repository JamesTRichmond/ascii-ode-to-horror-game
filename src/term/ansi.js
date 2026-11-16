// Terminal output for the glyph renderer: TextGrid dirty runs -> ANSI escape sequences (24-bit colour, absolute
// cursor moves). An unchanged frame writes nothing; a changed cell costs one run. Pure (no I/O) so it is testable.
export const ESC = '\x1b[';
export const enter = () => `${ESC}?1049h${ESC}?25l${ESC}2J`;      // alternate screen, hide cursor, clear
export const leave = () => `${ESC}0m${ESC}?25h${ESC}?1049l`;      // reset colour, show cursor, main screen
const rgb4 = c => [((c >> 8) & 15) * 17, ((c >> 4) & 15) * 17, (c & 15) * 17];

/** ANSI for the grid's dirty runs (all of them with full=true), offset by `top` rows (HUD above). */
export function runsToAnsi(runs, top = 0) {
  let out = '', last = -1;
  for (const r of runs) {
    out += `${ESC}${r.y + 1 + top};${r.x + 1}H`;
    if (r.color !== last) { const [R, G, B] = rgb4(r.color); out += `${ESC}38;2;${R};${G};${B}m`; last = r.color; }
    out += r.text;
  }
  return out;
}
/** Strip escape sequences (for measuring what a terminal would show). */
export const visible = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

/** Keys from a raw-mode terminal. Terminals report presses (with auto-repeat) but never releases, so a press holds
 *  its button for `holdMs`; repeat keeps it held. Returns the packed buttons for "now". */
export function createKeyState(IN, holdMs = 180) {
  const until = new Map(), MAP = { w: IN.FWD, s: IN.BACK, a: IN.LEFT, d: IN.RIGHT, ' ': IN.HUM, f: IN.CHORD, h: IN.HOLD, e: IN.USE, '\x1b[A': IN.FWD, '\x1b[B': IN.BACK, '\x1b[D': IN.TURNL, '\x1b[C': IN.TURNR, q: IN.TURNL, r: IN.TURNR };
  return {
    press(key, now) { const b = MAP[key.toLowerCase?.() === key ? key : key.toLowerCase()] ?? MAP[key]; if (b) until.set(b, now + holdMs); return !!b; },
    buttons(now) { let b = 0; for (const [bit, t] of until) if (t > now) b |= bit; return b; },
  };
}
