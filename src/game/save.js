// Persistence. Settings and progress in localStorage; mid-chapter saves hold the canonical
// integer simulation state, so loading preserves the next random draw.
const KEY = 'ode.save.v1';
export const DEFAULT_SETTINGS = { quality: 'auto', reducedMotion: false, textScale: 1, contrast: false, volume: 0.7, sensitivity: 1, stats: false, debug: '', captions: true, telemetry: false, renderThread: 'worker', vibration: true, bindings: null, soundCaptions: false, cvd: 'off', speed: 1, toggleVoice: false };

export function loadSave() {
  const base = { version: 1, unlocked: 1, settings: { ...DEFAULT_SETTINGS }, checkpoint: null, endings: [], best: {} };
  try {
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) base.settings.reducedMotion = true;
    const raw = JSON.parse(localStorage.getItem(KEY)); if (!raw || raw.version !== 1) return base;
    return { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } };
  } catch { return base; }
}
export function storeSave(save) { try { localStorage.setItem(KEY, JSON.stringify(save)); return true; } catch { return false; } }
export function clearSave() { try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } }

// ---------------------------------------------------------------- transfer between browsers and devices
// A save code is "ODE1.<base64url JSON>.<FNV-1a 32 of the rest>". The checksum catches truncation and copy errors;
// it is not anti-tamper (a single-player save has nothing to protect). Import validates every field before use.
const MAGIC = 'ODE1', CHAPTER_COUNT = 9, QUALITIES = ['auto', 'low', 'medium', 'high'];
const fnv32 = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };
const toB64url = str => { const b = new TextEncoder().encode(str); let bin = ''; for (const x of b) bin += String.fromCharCode(x); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64url = s => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); };

export function exportSave(save) { const body = toB64url(JSON.stringify(save)); return `${MAGIC}.${body}.${fnv32(MAGIC + '.' + body)}`; }

const isInt = (v, lo = -2147483648, hi = 2147483647) => Number.isInteger(v) && v >= lo && v <= hi;
/** @returns a list of problems (empty = valid). Unknown top-level keys are allowed (forward-safe) and kept. */
export function validateSave(s) {
  const bad = [];
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['not a save object'];
  if (s.version !== 1) bad.push(`save version ${s.version} is not supported`);
  if (!isInt(s.unlocked, 1, CHAPTER_COUNT)) bad.push('unlocked chapters must be 1-9');
  if (!Array.isArray(s.endings) || s.endings.some(e => e !== 1 && e !== 2) || new Set(s.endings).size !== s.endings.length) bad.push('endings must be a list of 1 and/or 2');
  if (!s.best || typeof s.best !== 'object' || Object.entries(s.best).some(([k, v]) => !/^[1-9]$/.test(k) || !isInt(v, 1))) bad.push('best times must be positive tick counts for chapters 1-9');
  if (s.settings !== undefined) {
    if (!s.settings || typeof s.settings !== 'object') bad.push('settings must be an object');
    else for (const [k, v] of Object.entries(s.settings)) if (k in DEFAULT_SETTINGS && typeof v !== typeof DEFAULT_SETTINGS[k]) bad.push(`setting ${k} has the wrong type`);
    if (s.settings?.quality !== undefined && !QUALITIES.includes(s.settings.quality)) bad.push('unknown render quality');
  }
  const cp = s.checkpoint;
  if (cp !== null && cp !== undefined) {
    if (typeof cp !== 'object' || !Array.isArray(cp.state) || cp.state.length > 20000 || !cp.state.every(v => isInt(v))) bad.push('checkpoint state must be a list of 32-bit integers');
    else if (cp.endless ? !(isInt(cp.endless.seed) && isInt(cp.endless.depth, 1)) : !isInt(cp.chapter, 0, CHAPTER_COUNT - 1)) bad.push('checkpoint chapter is out of range');
  }
  for (const k of ['endlessBest']) if (s[k] !== undefined && !isInt(s[k], 0)) bad.push(`${k} must be a non-negative integer`);
  return bad;
}

/** Parse and validate a save code. @returns {save, summary}; throws an Error whose message is fit to show the player. */
export function importSave(code) {
  const parts = String(code).trim().replace(/\s+/g, '').split('.');
  if (parts[0] !== MAGIC) throw new Error('This is not an ODE save code (it should start with ODE1.).');
  if (parts.length !== 3) throw new Error('This save code is damaged or incomplete: part of it is missing.');
  if (fnv32(MAGIC + '.' + parts[1]) !== parts[2]) throw new Error('This save code is damaged or incomplete: its checksum does not match.');
  let raw; try { raw = JSON.parse(fromB64url(parts[1])); } catch { throw new Error('This save code is damaged: its contents cannot be read.'); }
  const bad = validateSave(raw); if (bad.length) throw new Error(`This save cannot be used: ${bad.join('; ')}.`);
  const save = { ...loadSave(), ...raw, settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) } };
  const cp = save.checkpoint, summary = `Chapters unlocked ${save.unlocked} of ${CHAPTER_COUNT} · endings ${save.endings.length ? save.endings.join(' and ') : 'none'} · best times for ${Object.keys(save.best).length} chapter${Object.keys(save.best).length === 1 ? "" : "s"}${cp ? ` · a saved game in ${cp.endless ? `Endless verse ${cp.endless.depth}` : `Chapter ${cp.chapter + 1}`}` : ''}${save.endlessBest ? ` · deepest Endless verse ${save.endlessBest}` : ''}`;
  return { save, summary };
}
