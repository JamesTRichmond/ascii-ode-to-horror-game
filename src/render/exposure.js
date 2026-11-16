// Eye adaptation (auto-exposure). Metering: a log2-luminance histogram of the final scene radiance (after fog), sampled
// on a sparse lattice; the mean over the 45th-95th percentile ignores the dark majority of a horror frame and the few
// hottest pixels (a flame or a measure must not black out the room). Adaptation is asymmetric, like the eye: into
// light quickly (tau 0.4 s), into darkness slowly (tau 2.2 s), so stepping out of a lit hall leaves you blind for a
// moment before the dark resolves. Adaptation is partial (strength 0.5: exposure = (key / L)^0.5), so the dark chapters
// stay dark and only half of the brightness spread is compensated. The exposure applies through env.exposure (light and
// fog alike). Key 0.16 is the median chapter's metered luminance, so a typical scene keeps exposure ~1.
const BINS = 64, LO = -12, HI = 4; // log2 luminance range

export function createExposure(o = {}) { return { ev: 1, target: 1, key: o.key ?? 0.16, strength: o.strength ?? 0.5, min: o.min ?? 0.5, max: o.max ?? 2.2, tauDark: o.tauDark ?? 2.2, tauBright: o.tauBright ?? 0.4, hist: new Uint32Array(BINS), avg: 0 }; }

/** Mean log2 luminance of the 45-95th percentile of `radiance` (exposed by `exposure`, which is divided out). */
export function meter(ae, radiance, w, h, exposure = 1, stride = 3) {
  const hist = ae.hist; hist.fill(0); let n = 0; const inv = 1 / exposure;
  for (let y = 1; y < h; y += stride) for (let x = (y * 7) % stride; x < w; x += stride) {
    const o = (y * w + x) * 3, Y = (0.2126 * radiance[o] + 0.7152 * radiance[o + 1] + 0.0722 * radiance[o + 2]) * inv;
    const b = Math.min(BINS - 1, Math.max(0, Math.floor(((Math.log2(Y + 1e-6) - LO) / (HI - LO)) * BINS))); hist[b]++; n++;
  }
  const lo = n * 0.45, hi = n * 0.95; let acc = 0, sum = 0, cnt = 0;
  for (let b = 0; b < BINS; b++) { const c = hist[b], from = Math.max(acc, lo), to = Math.min(acc + c, hi); if (to > from) { const mid = LO + ((b + 0.5) / BINS) * (HI - LO); sum += mid * (to - from); cnt += to - from; } acc += c; }
  return (ae.avg = cnt ? sum / cnt : LO);
}
/** Move the exposure toward key / metered luminance with the eye's asymmetric time constants. */
export function adapt(ae, avgLog2, dt) {
  ae.target = Math.min(ae.max, Math.max(ae.min, (ae.key / 2 ** avgLog2) ** ae.strength));
  const tau = ae.warm > 0 ? 0.08 : ae.target > ae.ev ? ae.tauDark : ae.tauBright; // raising exposure = adapting to darkness: slow
  if (ae.warm > 0) ae.warm -= dt; // just after a scene starts, light transport is still converging: follow it quickly
  ae.ev += (ae.target - ae.ev) * (1 - Math.exp(-Math.max(0, dt) / tau));
  return ae.ev;
}
