// Phase 1 feasibility spike. Measures the three CPU costs that decide whether the
// Nocturne pipeline can run in real time in a browser-class JS engine:
//   1. G-buffer pixel fill (perspective-correct, z-tested, 5 attachments)
//   2. 12-D shape-descriptor matching against a 64-glyph dictionary
//   3. Front-to-back Beer–Lambert fog integration
// Usage: node tools/spike/feasibility-bench.mjs
import { performance } from 'node:perf_hooks';

const W = 480, H = 270, N = W * H;
const depth = new Float32Array(N), normal = new Float32Array(N * 2), rad = new Float32Array(N * 3);
const mat = new Uint8Array(N), vel = new Float32Array(N * 2);

function fillPass(tris) {
  depth.fill(1e6);
  let s = 12345;
  const r = () => ((s = Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
  for (let t = 0; t < tris; t++) {
    const cx = r() * W, cy = r() * H, sz = 4 + r() * 10, z = 1 + r() * 20;
    const x0 = Math.max(0, cx - sz | 0), x1 = Math.min(W - 1, cx + sz | 0);
    const y0 = Math.max(0, cy - sz | 0), y1 = Math.min(H - 1, cy + sz | 0);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const a = (x - x0) / (x1 - x0 + 1), b = (y - y0) / (y1 - y0 + 1);
      if (a + b > 1) continue;
      const i = y * W + x, zz = 1 / ((1 - a - b) / z + a / (z + 1) + b / (z + 2));
      if (zz >= depth[i]) continue;
      depth[i] = zz; mat[i] = 1; normal[i * 2] = a; normal[i * 2 + 1] = b;
      rad[i * 3] = a; rad[i * 3 + 1] = b; rad[i * 3 + 2] = zz; vel[i * 2] = a; vel[i * 2 + 1] = b;
    }
  }
}
function matchPass(leaves, dims, cands) {
  const dict = new Float32Array(cands * dims).map((_, i) => (i * 2654435761 % 1000) / 1000);
  const v = new Float32Array(dims); let acc = 0;
  for (let l = 0; l < leaves; l++) {
    for (let k = 0; k < dims; k++) v[k] = ((l + k) * 40503 % 997) / 997;
    let best = 1e9, id = 0;
    for (let c = 0; c < cands; c++) { let e = 0; const o = c * dims; for (let k = 0; k < dims; k++) { const d = v[k] - dict[o + k]; e += d * d; } if (e < best) { best = e; id = c; } }
    acc += id;
  }
  return acc;
}
function fogPass(w, h, steps) {
  let acc = 0;
  for (let i = 0; i < w * h; i++) { let T = 1, L = 0; for (let s = 0; s < steps; s++) { const sig = 0.02 + 0.01 * ((i + s) & 7); const Ts = Math.exp(-sig * 0.5); L += T * 0.3 * (1 - Ts); T *= Ts; } acc += L; }
  return acc;
}
function time(name, fn, reps = 30) {
  for (let i = 0; i < 5; i++) fn();
  const t = []; for (let i = 0; i < reps; i++) { const a = performance.now(); fn(); t.push(performance.now() - a); }
  t.sort((a, b) => a - b);
  console.log(`${name.padEnd(52)} p50 ${t[reps >> 1].toFixed(2)} ms   p95 ${t[Math.floor(reps * .95)].toFixed(2)} ms`);
}
console.log(`node ${process.version} / G-buffer ${W}x${H}`);
time('G-buffer fill, 6,000 triangles, 5 attachments', () => fillPass(6000));
for (const d of [6, 12, 24]) time(`shape match, 6,000 leaves x 64 candidates x ${d}D`, () => matchPass(6000, d, 64));
time('fog, 240x135 half-res x 16 steps', () => fogPass(240, 135, 16));
