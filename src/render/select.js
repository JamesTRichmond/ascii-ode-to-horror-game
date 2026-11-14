// Glyph selection (guide phases 4 and 5): every leaf is encoded from the ORIGINAL scene buffers,
// matched against its material's dictionary in descriptor space, stabilised against reprojected
// history, and given a surface-attached transform from the SVD-clamped projection Jacobian.
import { MATERIALS } from '../shared/materials.js';
import { descriptorLayout, normalizeDescriptor } from '../shared/descriptor.js';
import { FAR, octDecode, unproject, project } from './gbuffer.js';
import { CELL_W, CELL_H, projectDirection, clampJacobian, signAlign } from './flow.js';
import { MAX_LEVEL } from './quadtree.js';
import { responseAlpha, shouldSwitch, historyValid, densityGlyph, SWITCH_MARGIN } from './temporal.js';
import { hash2 } from './light.js';

export const INSTANCE_FLOATS = 11; // cx, cy, ax, ay, bx, by, glyph, r, g, b, alpha
const IMP = Float32Array.from(MATERIALS.map(m => m.importance));
const tone = l => l / (l + 0.35);
const newHistory = (cap, cells) => ({ slotOf: new Int32Array(cells).fill(-1), key: new Uint16Array(cap), level: new Uint8Array(cap), glyph: new Int16Array(cap).fill(-1), depth: new Float32Array(cap), n: new Float32Array(cap * 3), vec: new Float32Array(cap * 24), count: 0 });

export function createSelector(w, h, capacity, atlas, noise) {
  const gw = Math.ceil(w / CELL_W), gh = Math.ceil(h / CELL_H);
  return {
    w, h, gw, gh, capacity, atlas, noise, inst: new Float32Array((capacity + 1024) * INSTANCE_FLOATS), matOf: new Uint8Array(capacity + 1024), count: 0,
    prev: newHistory(capacity, gw * gh), cur: newHistory(capacity, gw * gh), heat: new Float32Array(gw * gh),
    layouts: { 6: descriptorLayout(6), 12: descriptorLayout(12), 24: descriptorLayout(24) }, EX: atlas.tileW / (atlas.tileW - 2 * atlas.pad), EY: atlas.tileH / (atlas.tileH - 2 * atlas.pad),
    stats: { leaves: 0, emitted: 0, matched: 0, braille: 0, sextant: 0, valid: 0, switches: 0, switchRate: 0, rejected: 0 },
    opts: { tau: 0.12, margin: SWITCH_MARGIN, motionBias: 0.75, sigmaMin: 0.45, sigmaMax: 1.25, temporal: true },
  };
}

const V = new Float32Array(24), IDX = new Int32Array(24), N = [0, 0, 0], T = [0, 0, 0], P = [0, 0, 0], Q = [0, 0, 0], D0 = [0, 0], D1 = [0, 0], J = [0, 0, 0, 0];

/** Stroke bias toward the motion direction. Only renderer object motion counts: static background under camera motion has zero confidence and is never rotated. */
export const motionBiasAmount = (objectSpeedPxPerSec, isDynamicObject, gain) => (isDynamicObject ? Math.max(0, Math.min(1, (objectSpeedPxPerSec - 25) / 160)) * gain : 0);

/** Score one candidate. Exposed for tests and the offline optimiser. */
export function shapeError(v, table, g, dims) { let e = 0; const o = g * dims; for (let k = 0; k < dims; k++) { const d = v[k] - table[o + k]; e += d * d; } return e * 0.5; }

export function selectGlyphs(sel, gb, qt, fl, cam, prevCam, env) {
  const { w, h, gw, atlas, inst, noise, opts, EX, EY } = sel, { depth, material, object, radiance, lum, velocity, normal, tangent } = gb, st = sel.stats;
  const tmp = sel.prev; sel.prev = sel.cur; sel.cur = tmp; const prev = sel.prev, cur = sel.cur; cur.slotOf.fill(-1);
  const dt = env.dt, alpha = responseAlpha(dt, opts.tau), temporal = opts.temporal && dt > 0 && dt < 0.25;
  let n = 0, switches = 0, valid = 0, rejected = 0, lastGlyph = -1; st.braille = st.sextant = st.matched = 0;
  const heat = sel.heat, hd = Math.exp(-dt / 0.6); for (let i = 0; i < heat.length; i++) heat[i] *= hd;

  for (let li = 0; li < qt.count; li++) {
    const x = qt.lx[li], y = qt.ly[li], lw = qt.lw[li], lh = qt.lh[li], level = qt.level[li], dims = level >= 3 ? 6 : level === 2 ? 12 : 24, L = sel.layouts[dims];
    let oKey = -1, oImp = -1, oDepth = 1e9;
    for (let k = 0; k < dims; k++) {
      const px = Math.min(w - 1, x + ((L.cx[k] * lw) | 0)), py = Math.min(h - 1, y + ((L.cy[k] * lh) | 0)), i = py * w + px, m = material[i], imp = IMP[m]; IDX[k] = i;
      if (imp > oImp || (imp === oImp && depth[i] < oDepth)) { oImp = imp; oDepth = depth[i]; oKey = (object[i] << 8) | m; }
    }
    const oMat = oKey & 255, mt = MATERIALS[oMat]; let cnt = 0, r = 0, g = 0, b = 0, mask = 0, ci = -1;
    for (let k = 0; k < dims; k++) {
      const i = IDX[k];
      if (((object[i] << 8) | material[i]) === oKey) { V[k] = tone(lum[i]); r += radiance[i * 3]; g += radiance[i * 3 + 1]; b += radiance[i * 3 + 2]; cnt++; mask |= 1 << k; if (ci < 0 || depth[i] < depth[ci]) ci = i; } else V[k] = 0;
    }
    r /= cnt; g /= cnt; b /= cnt;
    const cellX = x >> 1, cellY = (y / CELL_H) | 0, slot = li, mcx = Math.min(w - 1, x + (lw >> 1)), mcy = Math.min(h - 1, y + (lh >> 1));
    if (((object[mcy * w + mcx] << 8) | material[mcy * w + mcx]) === oKey) ci = mcy * w + mcx; // prefer the centre when the owner covers it
    const sx = (ci % w) + 0.5, sy = ((ci / w) | 0) + 0.5, d = depth[ci];
    // history slot bookkeeping (identity = leaf slot; cells map back to it)
    cur.key[slot] = oKey; cur.level[slot] = level; cur.depth[slot] = d; cur.glyph[slot] = -1;
    for (let yy = cellY, ye = Math.min(sel.gh, cellY + Math.ceil(lh / CELL_H)); yy < ye; yy++) for (let xx = cellX, xe = Math.min(gw, cellX + Math.ceil(lw / CELL_W)); xx < xe; xx++) cur.slotOf[yy * gw + xx] = slot;
    const o = n * INSTANCE_FLOATS; let glyph = -1, ax = lw * 0.5 * EX, ay = 0, bx = 0, by = lh * 0.5 * EY, px = x + lw * 0.5, py = y + lh * 0.5;

    if (oMat === 0) { // fog / sky: Braille sub-cell dithering of in-scattered light
      const ml = tone(0.2126 * r + 0.7152 * g + 0.0722 * b); if (ml < 0.012) continue;
      let bm = 0;
      for (let rr = 0; rr < 4; rr++) for (let cc = 0; cc < 2; cc++) { const qx = Math.min(w - 1, x + (((cc + 0.5) * lw) >> 1)), qy = Math.min(h - 1, y + (((rr + 0.5) * lh) >> 2)), qi = qy * w + qx; if (material[qi] === 0 && noise[((qy & 31) << 5) | (qx & 31)] / 256 < tone(lum[qi]) * 1.7) bm |= 1 << (rr * 2 + cc); }
      if (!bm) continue; glyph = atlas.braille[bm]; st.braille++; const boost = 2.2; r *= boost; g *= boost; b *= boost;
    } else if (level === MAX_LEVEL && cnt <= 3 && oImp >= 0.8 && d > 4) { // thin distant silhouettes: exact sextant sub-cells
      glyph = atlas.sextant[mask & 63]; st.sextant++; r *= 0.55; g *= 0.55; b *= 0.55;
    } else {
      const mean = normalizeDescriptor(V, 0, dims), cand = atlas.dict[oMat], table = atlas.desc[dims], cell = Math.min(sel.gh - 1, (sy / CELL_H) | 0) * gw + Math.min(gw - 1, sx >> 1);
      octDecode(normal, ci * 2, N); unproject(cam, sx, sy, d, P);
      // --- reprojection + history validation ---
      let ok = false, prevGlyph = -1, ps = -1;
      if (temporal) {
        const qx = sx - velocity[ci * 2], qy = sy - velocity[ci * 2 + 1];
        if (qx >= 0 && qy >= 0 && qx < w && qy < h) {
          ps = prev.slotOf[((qy / CELL_H) | 0) * gw + (qx >> 1)];
          if (ps >= 0) {
            let expected = d; if (!(oKey >> 8)) { project(prevCam, P[0], P[1], P[2], Q); expected = Q[2]; }
            ok = historyValid(prev.key[ps], oKey, prev.level[ps], level, prev.depth[ps], expected, N[0] * prev.n[ps * 3] + N[1] * prev.n[ps * 3 + 1] + N[2] * prev.n[ps * 3 + 2]) && prev.glyph[ps] >= 0;
            if (ok) { prevGlyph = prev.glyph[ps]; for (let k = 0; k < dims; k++) V[k] = prev.vec[ps * 24 + k] + (V[k] - prev.vec[ps * 24 + k]) * alpha; valid++; } else rejected++;
          }
        }
      }
      for (let k = 0; k < dims; k++) cur.vec[slot * 24 + k] = V[k];
      cur.n[slot * 3] = N[0]; cur.n[slot * 3 + 1] = N[1]; cur.n[slot * 3 + 2] = N[2];
      // --- flow, motion bias ---
      let fx = fl.fx[cell], fy = fl.fy[cell], bias = 0;
      if (oKey >> 8 && dt > 0) { // object motion = total velocity minus camera-only velocity
        project(prevCam, P[0], P[1], P[2], Q); const mvx = velocity[ci * 2] - (sx - Q[0]), mvy = velocity[ci * 2 + 1] - (sy - Q[1]), sp = Math.hypot(mvx, mvy) / dt;
        bias = motionBiasAmount(sp, true, opts.motionBias);
        if (bias > 0) { const s = signAlign(fx, fy, mvx, mvy) / (Math.hypot(mvx, mvy) || 1); fx += (mvx * s - fx) * bias; fy += (mvy * s - fy) * bias; const l = Math.hypot(fx, fy) || 1; fx /= l; fy /= l; }
      }
      // --- candidate scoring: shape + coverage + orientation + neighbour + stable variety ---
      const target = Math.max(0.04, Math.min(0.5, mean * 0.62 * mt.cover)), tAng = Math.atan2(fl.ty[cell], fl.tx[cell]), coh = fl.coh[cell];
      const hid = oKey >> 8 ? (cellX * 7919 + cellY * 104729) | 0 : (Math.floor(P[0] * 3) * 73856093) ^ (Math.floor(P[1] * 3) * 19349663) ^ (Math.floor(P[2] * 3) * 83492791);
      let best = 1e9, prevErr = 1e9;
      for (let c = 0; c < cand.length; c++) {
        const gi = cand[c], dm = atlas.mean[gi] - target; let e = mt.wShape * shapeError(V, table, gi, dims) + 4 * dm * dm;
        if (mt.wOrient < 0.5) { const cs = Math.cos(atlas.angle[gi] - tAng); e += mt.wOrient * 0.3 * atlas.aniso[gi] * coh * (1 - cs * cs); } else e -= 0.15 * bias * atlas.aniso[gi];
        e += hash2(hid, gi) * mt.jitter * 0.22; if (gi === lastGlyph && mt.jitter > 0.3) e += 0.12;
        if (e < best) { best = e; glyph = gi; } if (gi === prevGlyph) prevErr = e;
      }
      if (glyph < 0) continue;
      if (ok && !shouldSwitch(ok, best, prevErr, opts.margin)) glyph = prevGlyph;
      else if (ok && glyph !== prevGlyph) { switches++; heat[cell] = 1; }
      cur.glyph[slot] = glyph; lastGlyph = glyph; st.matched++;
      // --- transform: projection Jacobian of the surface basis, singular values clamped ---
      const hw = lw * 0.5 * EX * mt.scale, hh = lh * 0.5 * EY * mt.scale, jn = hash2(hid, 17), jm = hash2(hid, 91);
      if (mt.warp) {
        octDecode(tangent, ci * 2, T); const tn = T[0] * N[0] + T[1] * N[1] + T[2] * N[2]; T[0] -= N[0] * tn; T[1] -= N[1] * tn; T[2] -= N[2] * tn; const tl = Math.hypot(T[0], T[1], T[2]) || 1; T[0] /= tl; T[1] /= tl; T[2] /= tl;
        projectDirection(cam, sx, sy, d, T[0], T[1], T[2], D0); projectDirection(cam, sx, sy, d, N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0], D1);
        const k = d / cam.f; J[0] = D0[0] * k; J[2] = D0[1] * k; J[1] = D1[0] * k; J[3] = D1[1] * k;
        if (mt.wOrient >= 0.5) { // organic: rotate the frame so the glyph's stroke axis follows the (ETF + motion) flow
          let ga = atlas.aniso[glyph] > 0.45 ? atlas.angle[glyph] : 0; if (ga > Math.PI / 2) ga -= Math.PI;
          const want = Math.atan2(fy, fx) - ga + (jn - 0.5) * mt.jitter, have = Math.atan2(J[2], J[0]), dl = want - have, c = Math.cos(dl), s = Math.sin(dl), a0 = J[0], a1 = J[1], a2 = J[2], a3 = J[3];
          J[0] = c * a0 - s * a2; J[1] = c * a1 - s * a3; J[2] = s * a0 + c * a2; J[3] = s * a1 + c * a3;
        }
        if (J[0] < 0 && mt.wOrient < 0.5) { J[0] = -J[0]; J[2] = -J[2]; } if (J[0] * J[3] - J[1] * J[2] < 0) { J[1] = -J[1]; J[3] = -J[3]; }
        clampJacobian(J, opts.sigmaMin, opts.sigmaMax);
        const stretch = 1 + 0.5 * bias; ax = J[0] * hw * stretch; ay = J[2] * hw * stretch; bx = J[1] * hh; by = J[3] * hh;
      } else { const rot = oMat === 7 ? (jn - 0.5) * 0.8 : 0, c = Math.cos(rot), s = Math.sin(rot); ax = c * hw; ay = s * hw; bx = -s * hh; by = c * hh; }
      px += (jn - 0.5) * lw * mt.jitter; py += (jm - 0.5) * lh * mt.jitter;
      // shading detail that belongs to the glyph: fibre texture, LIC streaks, depth-crease occlusion
      let tex = (mt.jitter > 0.3 ? 0.75 + jm * 0.9 : 0.9 + jm * 0.2) * (0.7 + 0.6 * fl.lic[cell]), occ = 0;
      for (let q = 0; q < 4; q++) { const j = Math.min(h - 1, Math.max(0, (sy | 0) + (q === 2 ? -3 : q === 3 ? 3 : 0))) * w + Math.min(w - 1, Math.max(0, (sx | 0) + (q === 0 ? -2 : q === 1 ? 2 : 0))), dd = d - depth[j]; if (dd > 0.035 && dd < 0.4) occ += 0.075; }
      tex *= 1 - occ; r *= tex; g *= tex; b *= tex;
    }
    inst[o] = px; inst[o + 1] = py; inst[o + 2] = ax; inst[o + 3] = ay; inst[o + 4] = bx; inst[o + 5] = by; inst[o + 6] = glyph; inst[o + 7] = r; inst[o + 8] = g; inst[o + 9] = b; inst[o + 10] = 1; sel.matOf[n] = oMat; n++;
  }
  cur.count = qt.count; sel.count = n; st.leaves = qt.count; st.emitted = n; st.valid = valid; st.switches = switches; st.rejected = rejected; st.switchRate = valid ? switches / valid : 0;
  return sel;
}

/** Append world-anchored decay-trail glyphs (depth-tested against the G-buffer). */
export function appendTrails(sel, field, gb, cam) {
  const { inst, atlas, noise, EX, EY } = sel, S = [0, 0, 0]; let n = sel.count; const max = (inst.length / INSTANCE_FLOATS) | 0;
  for (let i = 0; i < field.n && n < max; i++) {
    project(cam, field.pos[i * 3], field.pos[i * 3 + 1], field.pos[i * 3 + 2], S);
    if (S[2] < 0.3 || S[0] < 0 || S[1] < 0 || S[0] >= gb.w || S[1] >= gb.h || S[2] > gb.depth[(S[1] | 0) * gb.w + (S[0] | 0)] + 0.15) continue;
    const dn = field.density[i], ch = densityGlyph(dn, noise[(i * 37) & 1023] / 256); if (!ch) continue;
    const size = Math.max(1.6, Math.min(9, (cam.f / S[2]) * 0.085 * (0.6 + dn))), o = n * INSTANCE_FLOATS, k = 0.5 + 2.2 * dn;
    inst[o] = S[0]; inst[o + 1] = S[1]; inst[o + 2] = size * EX; inst[o + 3] = 0; inst[o + 4] = 0; inst[o + 5] = size * 1.5 * EY; inst[o + 6] = atlas.glyph(ch);
    inst[o + 7] = field.rgb[i * 3] * k; inst[o + 8] = field.rgb[i * 3 + 1] * k; inst[o + 9] = field.rgb[i * 3 + 2] * k; inst[o + 10] = Math.min(1, dn * 1.6); n++;
  }
  sel.count = n; return sel;
}
