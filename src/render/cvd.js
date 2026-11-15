// Colour-vision-deficiency correction. Simulation matrices: Machado, Oliveira & Fernandes (2009), severity 1.0, in
// linear RGB. Correction is daltonisation (the colour information a dichromat loses is redistributed onto channels
// they can see): C0 = I + a·E·(I - Sim), with `a` chosen numerically. C0 is then refined by constrained coordinate
// descent over all nine entries. The objective is the smallest simulated CIELAB difference between the game's
// information-carrying colours (threat red vs foliage, fire vs gold, voice cyan vs pale light...). The constraint is
// that no key colour's perceived lightness moves more than 15 L*, so brightness cues in the dark survive. Computed once
// per mode on first use (deterministic). C is applied to scene-linear radiance before tone mapping, on GPU and CPU alike.
const SIM = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
const SHIFT = { protan: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1], deutan: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1], tritan: [1, 0, 0.7, 0, 1, 0.7, 0, 0, 0] };
export const CVD_MODES = ['off', 'protan', 'deutan', 'tritan'];
export const IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

// Constraints: no key colour's perceived lightness moves more than 15 L*, and neutral greys stay within 12 ΔE of their
// uncorrected look (no tinting of the mostly-grey scene).
// information-carrying colours as scene-linear radiance (from materials.js and the event bursts in main.js)
export const KEY_COLOURS = { threatEmber: [1.7, 0.1, 0.03], hurt: [1.6, 0.25, 0.15], cloth: [0.8, 0.075, 0.08], grass: [0.19, 0.42, 0.34], gold: [0.95, 0.72, 0.25], flame: [2.4, 1.1, 0.25], voice: [0.5, 1.4, 1.3], arcane: [0.4, 1.2, 1.4], pale: [1.1, 1.05, 0.95], water: [0.08, 0.2, 0.26] };
export const KEY_PAIRS = [['threatEmber', 'grass'], ['cloth', 'grass'], ['hurt', 'gold'], ['threatEmber', 'gold'], ['hurt', 'grass'], ['voice', 'pale'], ['arcane', 'grass'], ['voice', 'gold'], ['water', 'grass'], ['cloth', 'water']];

export const mul3 = (a, b) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; return o; };
export const apply3 = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const columnMajor = m => Float32Array.of(m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]);
const tone = v => Math.pow(Math.min(1, Math.max(0, v / (1 + v))), 0.65);           // the renderer's display curve
const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function lab(lin) { // linear sRGB -> CIELAB (D65)
  const [r, g, b] = lin, X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116), fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** What a viewer with `mode` perceives (Lab) for scene radiance `rad` shown through correction matrix `C`. */
export function perceived(rad, C, mode) {
  const shown = apply3(C, rad).map(v => tone(Math.max(0, v))).map(toLinear), seen = mode === 'off' ? shown : apply3(SIM[mode], shown).map(v => Math.min(1, Math.max(0, v)));
  return lab(seen);
}
export const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function minPairDelta(C, mode) { let m = Infinity, worst = null; for (const [p, q] of KEY_PAIRS) { const d = deltaE(perceived(KEY_COLOURS[p], C, mode), perceived(KEY_COLOURS[q], C, mode)); if (d < m) { m = d; worst = `${p}/${q}`; } } return { min: m, worst }; }

const I = IDENTITY, sub = (a, b) => a.map((v, i) => v - b[i]), add = (a, b) => a.map((v, i) => v + b[i]), scale = (a, k) => a.map(v => v * k);
const daltonise = (mode, a) => add(I, scale(mul3(SHIFT[mode], sub(I, SIM[mode])), a));
const cache = {};
/** Row-major 3x3 correction for a mode (identity for 'off'), with the strength chosen to maximise the worst key pair. */
export function correction(mode) {
  if (!SIM[mode]) return [...I];
  if (!cache[mode]) {
    let best = { a: 0, min: minPairDelta(I, mode).min }; for (let a = 0.05; a <= 2.0001; a += 0.05) { const D = daltonise(mode, a); if (!lightOk(D, mode)) continue; const m = minPairDelta(D, mode).min; if (m > best.min + 1e-9) best = { a, min: m }; } // feasible strengths only
    cache[mode] = { m: refine(daltonise(mode, best.a), mode), a: best.a };
  }
  return [...cache[mode].m];
}
// neutrals (stone in shadow and in light, pale light, bone) must not take on a tint: the scene is mostly grey glyphs
export const NEUTRALS = { stoneDim: [0.08, 0.085, 0.09], stone: [0.51, 0.53, 0.54], pale: [1.1, 1.05, 0.95], bone: [0.9, 0.88, 0.8] };
const L0 = {}, N0 = {};
const lightOk = (C, mode) => {
  L0[mode] ||= Object.fromEntries(Object.entries(KEY_COLOURS).map(([k, v]) => [k, perceived(v, I, mode)[0]])); N0[mode] ||= Object.fromEntries(Object.entries(NEUTRALS).map(([k, v]) => [k, perceived(v, I, mode)]));
  return Object.entries(KEY_COLOURS).every(([k, v]) => Math.abs(perceived(v, C, mode)[0] - L0[mode][k]) <= 15) && Object.entries(NEUTRALS).every(([k, v]) => deltaE(perceived(v, C, mode), N0[mode][k]) <= 12);
};
function refine(C, mode) {
  let cur = [...C], score = lightOk(cur, mode) ? minPairDelta(cur, mode).min : -1;
  for (const step of [0.1, 0.05, 0.02, 0.01]) for (let it = 0, improved = true; improved && it < 60; it++) { improved = false;
    for (let k = 0; k < 9; k++) for (const s of [step, -step]) { const t = [...cur]; t[k] += s; if (!lightOk(t, mode)) continue; const v = minPairDelta(t, mode).min; if (v > score + 1e-6) { cur = t; score = v; improved = true; } } }
  return cur;
}
export const strength = mode => (SIM[mode] ? (correction(mode), cache[mode].a) : 0);
/** CSS hex for a HUD colour (display sRGB) after correction, so HUD and scene agree. */
export function correctHex(hex, mode) {
  if (!SIM[mode]) return hex; const n = parseInt(hex.slice(1), 16), lin = [n >> 16, (n >> 8) & 255, n & 255].map(v => toLinear(v / 255));
  const out = apply3(correction(mode), lin).map(v => Math.min(1, Math.max(0, v))).map(v => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
  return '#' + out.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
