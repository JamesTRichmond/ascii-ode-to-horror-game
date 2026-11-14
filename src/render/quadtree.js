// Budgeted adaptive subdivision (guide phase 2, task 1-1).
// Root tiles are 16x24 G-buffer pixels; each level halves both axes down to 2x3 micro-cells.
// Children are allocated with an exclusive prefix scan against a hard leaf capacity; a node whose
// children do not fit is retained as a leaf (overflow). Split/merge uses hysteresis per node, and
// node identity is its Morton path, so leaves are stable between frames.
import { MATERIALS } from '../shared/materials.js';
import { FAR } from './gbuffer.js';

export const ROOT_W = 16, ROOT_H = 24, MAX_LEVEL = 3;
const IMPORTANCE = Float32Array.from(MATERIALS.map(m => m.importance));
// minimum subdivision level by material: void may stay coarse, ground is medium, subjects are fine
const MIN_LEVEL = Uint8Array.from(MATERIALS.map(m => (m.importance >= 0.8 ? 3 : 2)));

export function createQuadtree(w, h, capacity = 12000) {
  const levels = [];
  for (let l = 0; l <= MAX_LEVEL; l++) {
    const cw = ROOT_W >> l, ch = ROOT_H >> l, nx = Math.ceil(w / cw), ny = Math.ceil(h / ch), n = nx * ny;
    levels.push({ cw, ch, nx, ny, dmin: new Float32Array(n), dmax: new Float32Array(n), lmin: new Float32Array(n), lmax: new Float32Array(n), subj: new Uint16Array(n), px: new Uint16Array(n), imp: new Float32Array(n), minLevel: new Uint8Array(n), mixed: new Uint8Array(n), first: new Uint16Array(n), split: new Uint8Array(n), calm: new Uint8Array(n) });
  }
  return {
    w, h, capacity, levels, depthWeight: 1.0, silhouetteWeight: 1.0, splitThreshold: 0.34, mergeThreshold: 0.22, mergeFrames: 6, pressure: 1,
    count: 0, lx: new Int16Array(capacity), ly: new Int16Array(capacity), lw: new Uint8Array(capacity), lh: new Uint8Array(capacity), level: new Uint8Array(capacity), key: new Uint32Array(capacity),
    stats: { leaves: 0, overflow: 0, byLevel: [0, 0, 0, 0], flips: 0 }, _a: new Int32Array(capacity), _b: new Int32Array(capacity), _ka: new Uint32Array(capacity), _kb: new Uint32Array(capacity),
  };
}

function buildPyramid(qt, gb) {
  const { w, h, depth, lum, material, object } = gb, L = qt.levels[MAX_LEVEL];
  for (let cy = 0; cy < L.ny; cy++) for (let cx = 0; cx < L.nx; cx++) {
    let dmin = 1e9, dmax = 0, lmin = 1e9, lmax = 0, subj = 0, px = 0, imp = 0, ml = 0, first = -1, mixed = 0;
    for (let y = cy * L.ch; y < Math.min(h, (cy + 1) * L.ch); y++) for (let x = cx * L.cw; x < Math.min(w, (cx + 1) * L.cw); x++) {
      const i = y * w + x, d = depth[i] >= FAR ? 60 : depth[i], l = lum[i], m = material[i], id = (object[i] << 8) | m, im = IMPORTANCE[m];
      if (d < dmin) dmin = d; if (d > dmax) dmax = d; if (l < lmin) lmin = l; if (l > lmax) lmax = l;
      if (im >= 0.8) subj++; if (im > imp) imp = im; if (MIN_LEVEL[m] > ml) ml = MIN_LEVEL[m];
      if (first < 0) first = id; else if (first !== id) mixed = 1; px++;
    }
    const n = cy * L.nx + cx; L.dmin[n] = dmin; L.dmax[n] = dmax; L.lmin[n] = lmin; L.lmax[n] = lmax; L.subj[n] = subj; L.px[n] = px; L.imp[n] = imp; L.minLevel[n] = ml; L.first[n] = first; L.mixed[n] = mixed;
  }
  for (let l = MAX_LEVEL - 1; l >= 0; l--) {
    const P = qt.levels[l], C = qt.levels[l + 1];
    for (let cy = 0; cy < P.ny; cy++) for (let cx = 0; cx < P.nx; cx++) {
      let dmin = 1e9, dmax = 0, lmin = 1e9, lmax = 0, subj = 0, px = 0, imp = 0, ml = 0, first = -1, mixed = 0;
      for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
        const x = cx * 2 + k, y = cy * 2 + j; if (x >= C.nx || y >= C.ny) continue; const c = y * C.nx + x;
        if (C.dmin[c] < dmin) dmin = C.dmin[c]; if (C.dmax[c] > dmax) dmax = C.dmax[c]; if (C.lmin[c] < lmin) lmin = C.lmin[c]; if (C.lmax[c] > lmax) lmax = C.lmax[c];
        subj += C.subj[c]; px += C.px[c]; if (C.imp[c] > imp) imp = C.imp[c]; if (C.minLevel[c] > ml) ml = C.minLevel[c];
        if (first < 0) first = C.first[c]; else if (first !== C.first[c]) mixed = 1; if (C.mixed[c]) mixed = 1;
      }
      const n = cy * P.nx + cx; P.dmin[n] = dmin; P.dmax[n] = dmax; P.lmin[n] = lmin; P.lmax[n] = lmax; P.subj[n] = subj; P.px[n] = px; P.imp[n] = imp; P.minLevel[n] = ml; P.first[n] = first; P.mixed[n] = mixed;
    }
  }
}

/** error = max(depthRange * depthWeight, contrast * materialImportance, silhouetteCoverage * silhouetteWeight) */
export function nodeError(qt, l, n) {
  const L = qt.levels[l];
  const depthTerm = ((L.dmax[n] - L.dmin[n]) / (L.dmin[n] + 0.5)) * qt.depthWeight;
  const contrast = ((L.lmax[n] - L.lmin[n]) / (L.lmax[n] + L.lmin[n] + 0.04)) * L.imp[n];
  const sil = L.subj[n] ? Math.max(0.5, L.subj[n] / L.px[n]) * qt.silhouetteWeight : 0;
  const forced = l < L.minLevel[n] ? 1 : 0, edge = L.mixed[n] && L.imp[n] >= 0.5 ? 0.6 : 0;
  return Math.max(depthTerm, contrast, sil, forced, edge);
}

/** Rebuild the leaf set for this frame. Returns qt (leaves in qt.lx/ly/lw/lh/level/key, qt.count). */
export function subdivide(qt, gb) {
  buildPyramid(qt, gb);
  const st = qt.stats; st.overflow = 0; st.flips = 0; st.byLevel = [0, 0, 0, 0];
  let active = qt._a, next = qt._b, keys = qt._ka, nextKeys = qt._kb, nActive = 0, out = 0;
  const R = qt.levels[0]; for (let n = 0; n < R.nx * R.ny; n++) { active[nActive] = n; keys[nActive++] = n << 6; }
  const emit = (l, n, key) => { const L = qt.levels[l], cx = n % L.nx, cy = (n / L.nx) | 0, x = cx * L.cw, y = cy * L.ch; qt.lx[out] = x; qt.ly[out] = y; qt.lw[out] = Math.min(L.cw, qt.w - x); qt.lh[out] = Math.min(L.ch, qt.h - y); qt.level[out] = l; qt.key[out] = key; out++; st.byLevel[l]++; };
  for (let l = 0; l <= MAX_LEVEL; l++) {
    const L = qt.levels[l], C = qt.levels[l + 1]; let nNext = 0, running = out + nActive; // leaves if nothing else splits
    for (let a = 0; a < nActive; a++) {
      const n = active[a]; let want = false;
      if (l < MAX_LEVEL) {
        const err = nodeError(qt, l, n), was = L.split[n];
        if (err >= 1) { want = true; L.calm[n] = 0; }
        else if (was) { if (err < qt.mergeThreshold * qt.pressure) { if (++L.calm[n] >= qt.mergeFrames) want = false; else want = true; } else { L.calm[n] = 0; want = true; } }
        else want = err > qt.splitThreshold * qt.pressure;
        if (want) { // count in-viewport children, then check the budget (exclusive scan)
          const cx = n % L.nx, cy = (n / L.nx) | 0; let kids = 0;
          for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) if (cx * 2 + k < C.nx && cy * 2 + j < C.ny) kids++;
          if (running + kids - 1 <= qt.capacity) {
            running += kids - 1;
            for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) { const x = cx * 2 + k, y = cy * 2 + j; if (x >= C.nx || y >= C.ny) continue; next[nNext] = y * C.nx + x; nextKeys[nNext++] = ((keys[a] >>> 6) << 6) | ((((keys[a] & 63) << 2) | (j * 2 + k)) & 63); }
          } else { want = false; st.overflow++; }
        }
        if (was !== (want ? 1 : 0)) st.flips++;
        L.split[n] = want ? 1 : 0;
      }
      if (!want) emit(l, n, (keys[a] | (l << 30)) >>> 0);
    }
    const ta = active; active = next; next = ta; const tk = keys; keys = nextKeys; nextKeys = tk; nActive = nNext;
    if (!nActive) break;
  }
  // budget pressure: raise thresholds while overflowing, relax when comfortably under budget
  if (st.overflow > 0) qt.pressure = Math.min(4, qt.pressure * 1.08); else if (out < qt.capacity * 0.8) qt.pressure = Math.max(1, qt.pressure * 0.97);
  qt.count = out; st.leaves = out;
  return qt;
}
