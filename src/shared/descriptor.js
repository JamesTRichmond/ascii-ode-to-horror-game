// Staggered coverage descriptors (guide phase 1 step 4 / phase 4 task 3-0).
// One layout definition is shared by the offline atlas bake and the runtime scene encoder,
// so both use the same sample positions, normalisation and contrast exponent.

export const DESCRIPTOR_DIMS = [6, 12, 24];
export const CONTRAST_EXPONENT = 1.35;
export const NORM_EPSILON = 1e-4;

const GRIDS = { 6: [2, 3], 12: [3, 4], 24: [4, 6] };

/**
 * Sample centres in cell-normalised coordinates. Odd rows are shifted by a quarter column
 * (staggered), so vertically adjacent samples do not alias the same stroke column.
 * @returns {{cx:Float32Array, cy:Float32Array, rx:number, ry:number, cols:number, rows:number}}
 */
export function descriptorLayout(dims) {
  const [cols, rows] = GRIDS[dims];
  const cx = new Float32Array(dims), cy = new Float32Array(dims);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const stagger = (r & 1 ? 0.25 : -0.25) / cols;
    cx[r * cols + c] = Math.min(1, Math.max(0, (c + 0.5) / cols + stagger));
    cy[r * cols + c] = (r + 0.5) / rows;
  }
  return { cx, cy, rx: 0.62 / cols, ry: 0.62 / rows, cols, rows };
}

/** In-place: contrast exponent, then L2 normalisation with epsilon. Returns the pre-normalisation mean. */
// Contrast curve as a 1025-entry table with linear interpolation, shared by bake and runtime so both
// apply bit-identical normalisation (max deviation from Math.pow below 2e-4 on [0, 1]).
const POW_N = 1024, POW = new Float32Array(POW_N + 2);
for (let i = 0; i <= POW_N + 1; i++) POW[i] = Math.pow(Math.min(i, POW_N) / POW_N, CONTRAST_EXPONENT);
export function contrastCurve(x) {
  if (x <= 0) return 0; if (x >= 1) return Math.pow(x, CONTRAST_EXPONENT);
  const f = x * POW_N, i = f | 0; return POW[i] + (POW[i + 1] - POW[i]) * (f - i);
}
export function normalizeDescriptor(v, offset, dims) {
  let mean = 0, mag = 0;
  for (let k = 0; k < dims; k++) {
    const raw = v[offset + k]; mean += raw;
    const x = contrastCurve(raw);
    v[offset + k] = x; mag += x * x;
  }
  const inv = 1 / (Math.sqrt(mag) + NORM_EPSILON);
  for (let k = 0; k < dims; k++) v[offset + k] *= inv;
  return mean / dims;
}

/** Descriptor of a coverage image (Float32, w*h, values 0..1) restricted to an inner cell rectangle. */
export function describeCoverage(cov, w, h, x0, y0, cw, ch, dims, out, offset) {
  const L = descriptorLayout(dims);
  for (let k = 0; k < dims; k++) {
    const ax = Math.max(0, Math.floor(x0 + (L.cx[k] - L.rx) * cw)), bx = Math.min(w, Math.ceil(x0 + (L.cx[k] + L.rx) * cw));
    const ay = Math.max(0, Math.floor(y0 + (L.cy[k] - L.ry) * ch)), by = Math.min(h, Math.ceil(y0 + (L.cy[k] + L.ry) * ch));
    let s = 0, n = 0;
    for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) { s += cov[y * w + x]; n++; }
    out[offset + k] = n ? s / n : 0;
  }
  return normalizeDescriptor(out, offset, dims);
}
