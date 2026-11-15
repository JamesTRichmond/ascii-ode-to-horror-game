// Procedural room acoustics from level geometry. Each chapter's impulse response is derived from its own tile map:
//   - Sabine reverberation time RT60 = 0.161 V / (S·ā): floor area and wall perimeter in metres, a 3 m ceiling
//     indoors, the open sky (absorption 1) outdoors
//   - early reflections: ray casts from the listener's start to the nearest walls in 16 directions give discrete taps
//     at the round-trip delay with 1/distance amplitude
//   - a late tail of decorrelated noise per channel decaying at -60 dB per RT60, progressively low-passed so the tail
//     darkens (air and soft-surface absorption)
// Deterministic (seeded); pure functions plus a tiny WebAudio wrapper.
import { solidAt } from '../sim/sim.js';

const M = 2, CEILING = 3, ALPHA = { stone: 0.08, rubble: 0.12, sky: 1, ground: 0.3 }; // mid-band absorption: rough stone, debris-strewn floor, open sky, grass and sand

/** Acoustic description of a simulation map: { area, perimeter, volume, surface, rt60, indoor, taps: [[seconds, gain]] } */
export function roomAcoustics(sim) {
  const { w, h } = sim; let free = 0, edges = 0;
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) { if (solidAt(sim, x, z)) continue; free++; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (solidAt(sim, x + dx, z + dz)) edges++; }
  const indoor = !!sim.def.indoor, area = free * M * M, perimeter = edges * M, height = indoor ? CEILING : 6;
  const volume = area * height, wallArea = perimeter * height;
  // absorption: stone walls; a debris floor (indoor) or ground; a stone ceiling (indoor) or the open sky (outdoor)
  const S = wallArea + 2 * area, A = wallArea * ALPHA.stone + area * (indoor ? ALPHA.rubble : ALPHA.ground) + area * (indoor ? ALPHA.stone : ALPHA.sky);
  const rt60 = Math.min(4.5, Math.max(0.25, (0.161 * volume) / A));
  // early reflections from the start position
  const sx = (sim.start?.x ?? sim.p.x) / 1024, sz = (sim.start?.z ?? sim.p.z) / 1024, taps = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a); let d = 0;
    while (d < 30 && !solidAt(sim, Math.floor(sx + dx * d), Math.floor(sz + dz * d))) d += 0.25;
    if (d < 30) { const metres = d * M, t = (2 * metres) / 343; taps.push([+t.toFixed(5), +(0.5 / Math.max(1, metres)).toFixed(5)]); }
  }
  taps.sort((p, q) => p[0] - q[0]);
  return { area, perimeter, volume, surface: S, absorption: A, rt60: +rt60.toFixed(3), indoor, taps: taps.slice(0, 10) };
}

/** Stereo impulse response as two Float32Arrays at `rate`. */
export function impulseResponse(room, rate = 48000, seed = 1) {
  const len = Math.ceil(rate * Math.min(5, room.rt60 * 1.15 + 0.05)), L = new Float32Array(len), R = new Float32Array(len);
  let s = seed >>> 0 || 1; const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2147483648 - 1; };
  const k = 6.907755 / room.rt60, pre = Math.round(rate * (room.taps[0]?.[0] ?? 0.01));
  let lpL = 0, lpR = 0;
  for (let i = pre; i < len; i++) {
    const t = (i - pre) / rate, env = Math.exp(-k * t), damp = Math.min(0.92, 0.2 + t * 0.6); // tail darkens over time
    lpL = lpL * damp + rnd() * (1 - damp); lpR = lpR * damp + rnd() * (1 - damp);
    const norm = 1 / Math.sqrt((1 - damp) / (1 + damp)); // keep the filtered noise at unit power as it darkens
    L[i] = lpL * norm * env * 0.35; R[i] = lpR * norm * env * 0.35;
  }
  room.taps.forEach(([t, g], j) => { const i = Math.round(t * rate); if (i < len) { (j % 2 ? R : L)[i] += g; (j % 2 ? L : R)[Math.min(len - 1, i + 23)] += g * 0.6; } });
  return [L, R];
}
/** RT60 measured from an IR by Schroeder backward integration (T20 extrapolated: the -5 to -25 dB slope × 3). */
export function measureRT60(ir, rate) {
  const e = new Float64Array(ir.length); let acc = 0; for (let i = ir.length - 1; i >= 0; i--) { acc += ir[i] * ir[i]; e[i] = acc; }
  const db = i => 10 * Math.log10(e[i] / e[0] + 1e-30); let i5 = -1, i25 = -1;
  for (let i = 0; i < ir.length; i++) { const d = db(i); if (i5 < 0 && d <= -5) i5 = i; if (d <= -25) { i25 = i; break; } }
  return i5 < 0 || i25 < 0 ? NaN : ((i25 - i5) / rate) * 3;
}
