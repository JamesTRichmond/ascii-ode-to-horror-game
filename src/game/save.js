// Persistence. Settings and progress in localStorage; mid-chapter saves hold the canonical
// integer simulation state, so loading preserves the next random draw.
const KEY = 'ode.save.v1';
export const DEFAULT_SETTINGS = { quality: 'auto', reducedMotion: false, textScale: 1, contrast: false, volume: 0.7, sensitivity: 1, stats: false, debug: '', captions: true, telemetry: false, vibration: true, bindings: null };

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
