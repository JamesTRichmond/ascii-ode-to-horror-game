// Directional radiance cascades in plan view (guide phase 3, task 2-2).
// The world is a height-field grid, so transport is solved on its occupancy grid: each cascade
// level trades spatial for angular resolution and traces a longer interval; levels are merged
// near-to-far through transmittance:  L = L_near + T_near * L_far.
// This is 2.5D transport with a bounded, damped bounce loop. It is not 3D multi-bounce GI.
// Merging uses the "bilinear fix": where a wall lies between a probe and the upper-cascade probes it interpolates, each
// of the four upper probes is reached by its own ray from the lower interval's start to that probe's interval start, so
// an upper probe on the far side of a wall cannot contribute light it sees but this probe cannot (the classic leak at
// wall ends). A summed-area table of occupancy keeps the plain, single-ray merge wherever the region is clear.
export const TEXELS_PER_CELL = 4;
export const LEVELS = 4;

export function createCascades(tw, th) {
  const levels = [];
  for (let l = 0; l < LEVELS; l++) {
    const step = 4 * 2 ** l, dirs = 8 * 2 ** l, nx = Math.ceil(tw / step), ny = Math.ceil(th / step);
    levels.push({ level: l, step, dirs, nx, ny, near: l === 0 ? 0 : 4 * (2 ** l - 1), far: 4 * (2 ** (l + 1) - 1), data: new Float32Array(nx * ny * dirs * 3), valid: new Uint8Array(nx * ny) });
  }
  const p = levels[0];
  return {
    tw, th, levels, emit: new Float32Array(tw * th * 3), bounce: new Float32Array(tw * th * 3), solid: new Uint8Array(tw * th),
    // gathered probe grid (one probe per level-0 cell): fluence + 4 axis irradiances
    nx: p.nx, ny: p.ny, fluence: new Float32Array(p.nx * p.ny * 3), irr: [0, 1, 2, 3].map(() => new Float32Array(p.nx * p.ny * 3)), valid: p.valid,
    stats: { residual: 0, bounces: 0, ms: 0, bytes: levels.reduce((s, v) => s + v.data.byteLength, 0) },
  };
}

function sampleFar(l, x, y, angle, out) { // bilinear in space and angle; invalid probes are excluded, not read as black
  const px = x / l.step - 0.5, py = y / l.step - 0.5, ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
  const di = ((angle / (Math.PI * 2)) * l.dirs - 0.5 + l.dirs) % l.dirs, a = Math.floor(di), b = (a + 1) % l.dirs, t = di - a;
  let r = 0, g = 0, bl = 0, ws = 0;
  for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
    const xx = Math.max(0, Math.min(l.nx - 1, ix + dx)), yy = Math.max(0, Math.min(l.ny - 1, iy + dy)), pi = yy * l.nx + xx;
    if (!l.valid[pi]) continue;
    const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy), o = pi * l.dirs * 3;
    r += (l.data[o + a * 3] * (1 - t) + l.data[o + b * 3] * t) * w; g += (l.data[o + a * 3 + 1] * (1 - t) + l.data[o + b * 3 + 1] * t) * w; bl += (l.data[o + a * 3 + 2] * (1 - t) + l.data[o + b * 3 + 2] * t) * w; ws += w;
  }
  if (ws > 1e-4) { out[0] = r / ws; out[1] = g / ws; out[2] = bl / ws; } else { out[0] = out[1] = out[2] = 0; }
}

/** Radiance of one upper probe in a direction (angular interpolation only). */
function probeDir(l, pi, angle, out) {
  const di = ((angle / (Math.PI * 2)) * l.dirs - 0.5 + l.dirs) % l.dirs, a = Math.floor(di), b = (a + 1) % l.dirs, t = di - a, o = pi * l.dirs * 3;
  out[0] = l.data[o + a * 3] * (1 - t) + l.data[o + b * 3] * t; out[1] = l.data[o + a * 3 + 1] * (1 - t) + l.data[o + b * 3 + 1] * t; out[2] = l.data[o + a * 3 + 2] * (1 - t) + l.data[o + b * 3 + 2] * t;
}
/** March emission/occlusion from (sx, sy) to (ex, ey) in texels; @returns transmittance left (0 if a surface was hit), accumulating into acc. */
function march(c, sx, sy, ex, ey, Tstep, acc) {
  const { tw, th, emit, bounce, solid } = c, len = Math.hypot(ex - sx, ey - sy), n = Math.max(1, Math.round(len)), dx = (ex - sx) / n, dy = (ey - sy) / n; let trans = 1;
  for (let k = 0; k < n; k++) {
    const x = Math.floor(sx + dx * (k + 0.5)), y = Math.floor(sy + dy * (k + 0.5)); if (x < 0 || x >= tw || y < 0 || y >= th) return -trans; // left the grid: sky
    const i = y * tw + x;
    if (solid[i]) { acc[0] += trans * bounce[i * 3]; acc[1] += trans * bounce[i * 3 + 1]; acc[2] += trans * bounce[i * 3 + 2]; return 0; }
    acc[0] += trans * emit[i * 3] * 0.15; acc[1] += trans * emit[i * 3 + 1] * 0.15; acc[2] += trans * emit[i * 3 + 2] * 0.15; trans *= Tstep;
  }
  return trans;
}
function trace(c, sigma, sky, fix = true) {
  const { tw, th, emit, bounce, solid, levels } = c, far = [0, 0, 0], Tstep = Math.exp(-sigma), seg = [0, 0, 0], up4 = [0, 0, 0];
  // occupancy summed-area table: any solid texel inside a box in O(1)
  const W1 = tw + 1, sat = c.sat && c.sat.length === W1 * (th + 1) ? c.sat : (c.sat = new Int32Array(W1 * (th + 1)));
  for (let y = 0; y < th; y++) { let row = 0; for (let x = 0; x < tw; x++) { row += solid[y * tw + x]; sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1] + row; } }
  const anySolid = (x0, y0, x1, y1) => { x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(tw, Math.ceil(x1) + 1); y1 = Math.min(th, Math.ceil(y1) + 1); return x1 > x0 && y1 > y0 && sat[y1 * W1 + x1] - sat[y0 * W1 + x1] - sat[y1 * W1 + x0] + sat[y0 * W1 + x0] > 0; };
  c.stats.fixedRays = 0;
  for (let li = LEVELS - 1; li >= 0; li--) {
    const l = levels[li], up = levels[li + 1];
    for (let py = 0; py < l.ny; py++) for (let px = 0; px < l.nx; px++) {
      const ox = (px + 0.5) * l.step, oy = (py + 0.5) * l.step, pi = py * l.nx + px;
      l.valid[pi] = solid[Math.min(th - 1, oy | 0) * tw + Math.min(tw - 1, ox | 0)] ? 0 : 1;
      for (let d = 0; d < l.dirs; d++) {
        const angle = ((d + 0.5) / l.dirs) * Math.PI * 2, cs = Math.cos(angle), sn = Math.sin(angle); let trans = 1, r = 0, g = 0, b = 0, escaped = false;
        for (let t = l.near + 0.5; t < l.far; t++) {
          const x = Math.floor(ox + cs * t), y = Math.floor(oy + sn * t);
          if (x < 0 || x >= tw || y < 0 || y >= th) { escaped = true; break; }
          const i = y * tw + x;
          if (solid[i]) { r += trans * bounce[i * 3]; g += trans * bounce[i * 3 + 1]; b += trans * bounce[i * 3 + 2]; trans = 0; break; } // surface: reflected radiance, then stop
          r += trans * emit[i * 3] * 0.15; g += trans * emit[i * 3 + 1] * 0.15; b += trans * emit[i * 3 + 2] * 0.15; trans *= Tstep;
        }
        if (escaped) { r += trans * sky[0]; g += trans * sky[1]; b += trans * sky[2]; }
        else if (trans > 0 && up && !fix) { sampleFar(up, ox, oy, angle, far); r += trans * far[0]; g += trans * far[1]; b += trans * far[2]; } // plain merge (low tier)
        else if (trans > 0 && up) {
          // the four upper probes bilinear interpolation would use, and where each one's interval starts
          const qx = ox / up.step - 0.5, qy = oy / up.step - 0.5, ix = Math.floor(qx), iy = Math.floor(qy), fx = qx - ix, fy = qy - iy, sx = ox + cs * l.near, sy = oy + sn * l.near;
          // per upper probe: if the segment from this interval's start to that probe's interval start crosses no solid
          // texel (O(1) summed-area test on its bounding box), the single ray already traced stands in for it (the
          // plain merge); otherwise that probe alone is reached by its own ray (the bilinear fix)
          let R = 0, G = 0, B = 0, ws = 0;
          for (let k = 0; k < 4; k++) {
            const xx = Math.max(0, Math.min(up.nx - 1, ix + (k & 1))), yy = Math.max(0, Math.min(up.ny - 1, iy + (k >> 1))), qi = yy * up.nx + xx; if (!up.valid[qi]) continue;
            const w = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy); if (w <= 0) continue;
            const ex = (xx + 0.5) * up.step + cs * l.far, ey = (yy + 0.5) * up.step + sn * l.far;
            if (!anySolid(Math.min(sx, ex), Math.min(sy, ey), Math.max(sx, ex), Math.max(sy, ey))) { probeDir(up, qi, angle, up4); R += (r + trans * up4[0]) * w; G += (g + trans * up4[1]) * w; B += (b + trans * up4[2]) * w; ws += w; continue; }
            c.stats.fixedRays++; seg[0] = seg[1] = seg[2] = 0; let tr = march(c, sx, sy, ex, ey, Tstep, seg);
            if (tr < 0) { tr = -tr; seg[0] += tr * sky[0]; seg[1] += tr * sky[1]; seg[2] += tr * sky[2]; } else if (tr > 0) { probeDir(up, qi, angle, up4); seg[0] += tr * up4[0]; seg[1] += tr * up4[1]; seg[2] += tr * up4[2]; }
            R += seg[0] * w; G += seg[1] * w; B += seg[2] * w; ws += w;
          }
          if (ws > 1e-4) { r = R / ws; g = G / ws; b = B / ws; }
        }
        else if (trans > 0) { r += trans * sky[0]; g += trans * sky[1]; b += trans * sky[2]; }
        const o = (pi * l.dirs + d) * 3; l.data[o] = r; l.data[o + 1] = g; l.data[o + 2] = b;
      }
    }
  }
}
function gather(c) {
  const l = c.levels[0], n = l.nx * l.ny, AX = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let p = 0; p < n; p++) {
    let fr = 0, fg = 0, fb = 0; const acc = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let d = 0; d < l.dirs; d++) {
      const a = ((d + 0.5) / l.dirs) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a), o = (p * l.dirs + d) * 3, r = l.data[o], g = l.data[o + 1], b = l.data[o + 2];
      fr += r; fg += g; fb += b;
      for (let k = 0; k < 4; k++) { const w = Math.max(0, cs * AX[k][0] + sn * AX[k][1]); acc[k][0] += r * w; acc[k][1] += g * w; acc[k][2] += b * w; }
    }
    c.fluence[p * 3] = fr / l.dirs; c.fluence[p * 3 + 1] = fg / l.dirs; c.fluence[p * 3 + 2] = fb / l.dirs;
    // a surface with normal +x receives light arriving FROM +x, i.e. radiance sampled toward +x
    for (let k = 0; k < 4; k++) for (let ch = 0; ch < 3; ch++) c.irr[k][p * 3 + ch] = (acc[k][ch] / l.dirs) * 2.2;
  }
}
/** Inject reflected light: solid texels facing open space re-emit albedo * gain * incident fluence. */
function inject(c, albedo, gain) {
  const { tw, th, solid, bounce } = c, l = c.levels[0]; let delta = 0, total = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x; if (!solid[i]) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= tw || yy >= th || solid[yy * tw + xx]) continue;
      const p = Math.min(l.ny - 1, (yy / l.step) | 0) * l.nx + Math.min(l.nx - 1, (xx / l.step) | 0);
      r += c.fluence[p * 3]; g += c.fluence[p * 3 + 1]; b += c.fluence[p * 3 + 2]; n++;
    }
    const k = n ? (albedo * gain) / n : 0, nr = r * k, ng = g * k, nb = b * k;
    delta += Math.abs(nr - bounce[i * 3]) + Math.abs(ng - bounce[i * 3 + 1]) + Math.abs(nb - bounce[i * 3 + 2]); total += nr + ng + nb;
    bounce[i * 3] = nr; bounce[i * 3 + 1] = ng; bounce[i * 3 + 2] = nb;
  }
  return total > 1e-9 ? delta / total : 0;
}

/**
 * Solve transport. opts: {sigma (extinction per texel), sky [r,g,b], bounces (0..4), albedo, gain (<1), keepBounce,
 *   bilinearFix (default true: occlusion-correct merge; false: plain bilinear merge, cheaper, leaks at wall ends)}
 * With keepBounce the previous solve's reflected field is reused, giving one temporal bounce per call.
 */
export function solveCascades(c, opts = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0, sigma = opts.sigma ?? 0.018, sky = opts.sky ?? [0, 0, 0];
  const bounces = Math.max(0, Math.min(4, opts.bounces ?? 1)), albedo = opts.albedo ?? 0.5, gain = Math.min(0.95, opts.gain ?? 0.8);
  if (!opts.keepBounce) c.bounce.fill(0);
  const fix = opts.bilinearFix !== false; trace(c, sigma, sky, fix); gather(c); let residual = 0;
  for (let b = 0; b < bounces; b++) { residual = inject(c, albedo, gain); trace(c, sigma, sky, fix); gather(c); }
  c.stats.residual = residual; c.stats.bounces = bounces; c.stats.ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return c;
}

/** Splat a point emitter (metres) into the emission field. */
export function addEmitter(c, xm, zm, radiusM, rgb, texelM) {
  const cx = xm / texelM, cy = zm / texelM, r = Math.max(0.75, radiusM / texelM), x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(c.tw - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(c.th - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d > r) continue;
    const i = (y * c.tw + x) * 3, w = 1 - d / r; c.emit[i] += rgb[0] * w; c.emit[i + 1] += rgb[1] * w; c.emit[i + 2] += rgb[2] * w;
  }
}
