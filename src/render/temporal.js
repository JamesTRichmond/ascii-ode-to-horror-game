// Temporal coherence (guide phase 5): history validation, vector-space hysteresis, continuous-time decay.

/** Blend factor for an exponential response: alpha = 1 - exp(-dt / tau). Frame-rate invariant. */
export const responseAlpha = (dt, tau) => 1 - Math.exp(-dt / tau);

/** Hysteresis on the selection score: switch only when history is invalid or the best beats the incumbent by the margin. */
export const shouldSwitch = (valid, bestError, previousError, margin) => !valid || bestError + margin < previousError;
export const SWITCH_MARGIN = 0.025;

/** density' = max(newEmission, density * exp(-dt / tau)) — actual elapsed seconds, never frame counts. */
export const decayDensity = (density, emission, dt, tau) => Math.max(emission, density * Math.exp(-dt / tau));

/** Density -> glyph ladder  @ -> % -> * -> . -> empty. A dither offset in [0,1) breaks banding. */
export function densityGlyph(d, dither = 0.5) {
  const v = d + (dither - 0.5) * 0.08;
  return v > 0.7 ? '@' : v > 0.4 ? '%' : v > 0.15 ? '*' : v > 0.04 ? '.' : '';
}

/** History validity: same object/material identity, compatible leaf level, consistent depth and normal. */
export function historyValid(prevKey, key, prevLevel, level, prevDepth, expectedDepth, nDot) {
  return prevKey === key && prevLevel === level && Math.abs(prevDepth - expectedDepth) <= 0.1 * expectedDepth + 0.08 && nDot > 0.85;
}

/** World-anchored decaying glyph trails (hum wake, chord burst, unwritten creatures). */
export class DecayField {
  constructor(capacity = 768) { this.cap = capacity; this.n = 0; this.pos = new Float32Array(capacity * 3); this.vel = new Float32Array(capacity * 3); this.density = new Float32Array(capacity); this.tau = new Float32Array(capacity); this.rgb = new Float32Array(capacity * 3); this.seed = new Float32Array(capacity); this.next = 0; }
  emit(x, y, z, vx, vy, vz, density, tau, rgb) {
    const i = this.n < this.cap ? this.n++ : (this.next = (this.next + 1) % this.cap);
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.density[i] = density; this.tau[i] = tau; this.rgb.set(rgb, i * 3); this.seed[i] = (i * 0.61803398875) % 1;
  }
  /** Advance by real elapsed seconds. Paused scenes pass dt = 0 and nothing evolves. */
  update(dt) {
    if (dt <= 0) return;
    for (let i = 0; i < this.n; i++) {
      this.density[i] = decayDensity(this.density[i], 0, dt, this.tau[i]);
      for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; this.vel[i * 3 + k] *= Math.exp(-dt / 0.8); }
    }
    while (this.n > 0 && this.density[this.n - 1] < 0.03) this.n--;
  }
  clear() { this.n = 0; }
}
