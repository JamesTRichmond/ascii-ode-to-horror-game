// Offline hero-asset optimisation (guide phase 4, task 3-3), implemented as a deterministic
// annealed soft assignment in descriptor space: each leaf holds a relaxed distribution over its
// material dictionary (softmax of -error / temperature); the temperature is annealed and the
// discrete export is the arg-max. This is NOT gradient descent through a differentiable
// rasteriser; it is the discrete/relaxed comparison the guide's acceptance asks for.
import { MATERIALS } from '../shared/materials.js';
import { shapeError } from './select.js';
import { fnv1a } from '../sim/fixed.js';

/** @returns {{ids:Int32Array, hash:number, steps:Array<{temperature:number, coverageRms:number, descriptorRms:number, entropy:number}>}} */
export function optimizeFrame(sel, atlas, temperatures = [0.2, 0.08, 0.03, 0.01]) {
  const h = sel.cur, n = h.count, ids = new Int32Array(n).fill(-1), steps = [], v = new Float32Array(24), w = new Float32Array(256);
  for (const temperature of temperatures) {
    let covSq = 0, descSq = 0, ent = 0, count = 0;
    for (let s = 0; s < n; s++) {
      if (h.glyph[s] < 0) continue;
      const mat = h.key[s] & 255, dims = h.level[s] >= 3 ? 6 : h.level[s] === 2 ? 12 : 24, cand = atlas.dict[mat], table = atlas.desc[dims], wS = MATERIALS[mat].wShape;
      for (let k = 0; k < dims; k++) v[k] = h.vec[s * 24 + k];
      let best = 1e9, bi = 0, z = 0;
      for (let c = 0; c < cand.length; c++) { const e = wS * shapeError(v, table, cand[c], dims); w[c] = e; if (e < best) { best = e; bi = c; } }
      for (let c = 0; c < cand.length; c++) { w[c] = Math.exp(-(w[c] - best) / temperature); z += w[c]; }
      let cov = 0, d2 = 0; const g = cand[bi];
      for (let c = 0; c < cand.length; c++) { const p = w[c] / z; cov += p * atlas.mean[cand[c]]; if (p > 1e-12) ent -= p * Math.log(p); }
      for (let k = 0; k < dims; k++) { let r = 0; for (let c = 0; c < cand.length; c++) r += (w[c] / z) * table[cand[c] * dims + k]; const d = r - table[g * dims + k]; d2 += d * d; }
      covSq += (cov - atlas.mean[g]) ** 2; descSq += d2 / dims; ids[s] = g; count++;
    }
    steps.push({ temperature, coverageRms: Math.sqrt(covSq / count), descriptorRms: Math.sqrt(descSq / count), entropy: ent / count });
  }
  return { ids, hash: fnv1a(ids), steps };
}
