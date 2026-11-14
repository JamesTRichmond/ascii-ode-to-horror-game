// Integer-only math for the authoritative simulation (guide phase 6, task 5-0).
// Nothing in src/sim may use floats in state, Math.random, Date, or performance.now.
export const UNIT = 1024;      // sim units per map cell
export const ANG = 4096;       // angle units per revolution
export const TRIG = 4096;      // isin/icos scale

/** Integer sine (Bhaskara I), scaled by TRIG. Exact integer arithmetic below 2^53. */
export function isin(a) {
  a &= ANG - 1; let neg = false;
  if (a >= 2048) { a -= 2048; neg = true; }
  const p = a * (2048 - a), v = Math.floor((16 * p * TRIG) / (5 * 2048 * 2048 - 4 * p));
  return neg && v ? -v : v;
}
export const icos = a => isin(a + 1024);

/** Exact integer square root. */
export function isqrt(n) {
  if (n <= 0) return 0;
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** Integer atan2 in angle units (max error about 0.3 degrees). */
export function iatan2(y, x) {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x), ay = Math.abs(y), swap = ay > ax;
  const r = Math.floor((1024 * (swap ? ax : ay)) / (swap ? ay : ax));
  let a = Math.floor((r * (512 * 1024 + 178 * (1024 - r))) / (1024 * 1024));
  if (swap) a = 1024 - a;
  if (x < 0) a = 2048 - a;
  if (y < 0) a = ANG - a;
  return a & (ANG - 1);
}

/** xorshift32; the generator state is part of canonical simulation state. */
export function xorshift(s) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; }

/** FNV-1a over an Int32Array, little-endian byte order regardless of platform. */
export function fnv1a(ints) {
  let h = 0x811c9dc5;
  for (let i = 0; i < ints.length; i++) {
    const v = ints[i];
    for (let b = 0; b < 32; b += 8) { h ^= (v >>> b) & 255; h = Math.imul(h, 0x01000193); }
  }
  return h >>> 0;
}

/** Signed shortest angular difference b - a, in (-2048, 2048]. */
export function angDiff(a, b) { let d = (b - a) & (ANG - 1); if (d > 2048) d -= ANG; return d; }
