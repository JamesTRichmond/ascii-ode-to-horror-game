// Multi-channel signed distance field generation from outline edges (after Chlumsky's msdfgen):
// corner detection -> edge colouring -> per-channel signed pseudo-distance, with a winding-number
// reference used to fix the global sign and to repair pixels where the median disagrees with truth.
const cross = (a, b) => a[0] * b[1] - a[1] * b[0], dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], len = a => Math.hypot(a[0], a[1]);
const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const median3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

const point = (e, t) => e.p.length === 2
  ? [e.p[0][0] + (e.p[1][0] - e.p[0][0]) * t, e.p[0][1] + (e.p[1][1] - e.p[0][1]) * t]
  : [(1 - t) * (1 - t) * e.p[0][0] + 2 * t * (1 - t) * e.p[1][0] + t * t * e.p[2][0], (1 - t) * (1 - t) * e.p[0][1] + 2 * t * (1 - t) * e.p[1][1] + t * t * e.p[2][1]];
function direction(e, t) {
  if (e.p.length === 2) return sub(e.p[1], e.p[0]);
  const a = sub(e.p[1], e.p[0]), b = sub(e.p[2], e.p[1]);
  const d = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return d[0] === 0 && d[1] === 0 ? sub(e.p[2], e.p[0]) : d;
}

/** Signed distance from q to edge e: {d, ortho, t}. Sign is cross(q - curve, direction). */
function signedDistance(e, q) {
  let t;
  if (e.p.length === 2) { const ab = sub(e.p[1], e.p[0]); t = dot(sub(q, e.p[0]), ab) / dot(ab, ab); }
  else { // closest point on a quadratic: coarse scan + Newton on d/dt |B(t)-q|^2
    let best = Infinity; t = 0;
    for (let i = 0; i <= 8; i++) { const s = i / 8, p = point(e, s), d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < best) { best = d; t = s; } }
    const a = sub(e.p[1], e.p[0]), b = sub(sub(e.p[2], e.p[1]), a);
    for (let i = 0; i < 6; i++) {
      const p = sub(point(e, t), q), d1 = [2 * (a[0] + b[0] * t), 2 * (a[1] + b[1] * t)], d2 = [2 * b[0], 2 * b[1]];
      const f = dot(p, d1), g = dot(d1, d1) + dot(p, d2); if (Math.abs(g) < 1e-12) break;
      t -= f / g; if (t < -0.5 || t > 1.5) break;
    }
  }
  const tc = Math.min(1, Math.max(0, t)), p = point(e, tc), aq = sub(q, p), dir = nrm(direction(e, tc));
  const dist = len(aq), sign = cross(aq, dir) < 0 ? -1 : 1;
  const ortho = t > 0 && t < 1 ? 0 : Math.abs(dot(dir, dist ? [aq[0] / dist, aq[1] / dist] : [0, 0]));
  return { d: sign * dist, ortho, t };
}
/** Extend the edge as a line beyond its end points so corners stay sharp. */
function pseudoDistance(e, q, sd) {
  if (sd.t < 0) { const dir = nrm(direction(e, 0)), aq = sub(q, e.p[0]); if (dot(aq, dir) < 0) { const ps = cross(aq, dir); if (Math.abs(ps) <= Math.abs(sd.d)) return ps; } }
  else if (sd.t > 1) { const dir = nrm(direction(e, 1)), bq = sub(q, e.p[e.p.length - 1]); if (dot(bq, dir) > 0) { const ps = cross(bq, dir); if (Math.abs(ps) <= Math.abs(sd.d)) return ps; } }
  return sd.d;
}

function splitThirds(e) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const t0 = i / 3, t1 = (i + 1) / 3;
    if (e.p.length === 2) out.push({ p: [point(e, t0), point(e, t1)] });
    else { const a = point(e, t0), c = point(e, t1), d0 = direction(e, t0), h = (t1 - t0); out.push({ p: [a, [a[0] + d0[0] * h, a[1] + d0[1] * h], c] }); }
  }
  return out;
}
const RED = 1, GREEN = 2, BLUE = 4, WHITE = 7, COLORS = [RED | GREEN, GREEN | BLUE, RED | BLUE]; // yellow, cyan, magenta

/** Assign channel colours so that the two edges meeting at every sharp corner share exactly one... two channels differ. */
export function colorEdges(contours, angleThreshold = 3) {
  const crossT = Math.sin(angleThreshold);
  return contours.map(c => {
    const corners = [];
    for (let i = 0; i < c.length; i++) {
      const a = nrm(direction(c[(i + c.length - 1) % c.length], 1)), b = nrm(direction(c[i], 0));
      if (dot(a, b) <= 0 || Math.abs(cross(a, b)) > crossT) corners.push(i);
    }
    if (corners.length === 0) { for (const e of c) e.color = WHITE; return c; }
    if (corners.length === 1) {
      let edges = c.slice(corners[0]).concat(c.slice(0, corners[0]));
      if (edges.length < 3) edges = edges.length === 1 ? splitThirds(edges[0]) : edges.flatMap(e => splitThirds(e).slice(0, 3));
      const n = edges.length;
      edges.forEach((e, i) => { e.color = [COLORS[2], WHITE, COLORS[0]][Math.floor(i * 3 / n)]; });
      return edges;
    }
    const start = corners[0], n = c.length; let ci = 0, spline = 0; const nc = corners.length;
    for (let i = 0; i < n; i++) {
      const idx = (start + i) % n;
      if (spline + 1 < nc && corners[spline + 1] === idx) { spline++; ci = (ci + 1) % 3; if (spline === nc - 1 && ci === 0) ci = 1; }
      c[idx].color = COLORS[ci];
    }
    return c;
  });
}

function winding(flat, q) { // non-zero winding of flattened polylines around q
  let w = 0;
  for (const poly of flat) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (a[1] <= q[1]) { if (b[1] > q[1] && cross(sub(b, a), sub(q, a)) > 0) w++; }
    else if (b[1] <= q[1] && cross(sub(b, a), sub(q, a)) < 0) w--;
  }
  return w;
}
export function flatten(contours, steps = 12) {
  return contours.map(c => c.flatMap(e => e.p.length === 2 ? [e.p[0]] : Array.from({ length: steps }, (_, i) => point(e, i / steps))));
}

/**
 * @param contours coloured contours in pixel space (y down)
 * @returns {{msdf:Float32Array, sdf:Float32Array, repaired:number}} msdf: w*h*3 signed distances in px (positive inside)
 */
export function generateMSDF(contours, w, h) {
  const edges = contours.flat(), flat = flatten(contours), msdf = new Float32Array(w * h * 3), sdf = new Float32Array(w * h);
  let agree = 0, total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = [x + 0.5, y + 0.5], best = [null, null, null]; let minAbs = Infinity;
    for (const e of edges) {
      const sd = signedDistance(e, q), ad = Math.abs(sd.d);
      if (ad < minAbs) minAbs = ad;
      for (let k = 0; k < 3; k++) if (e.color & (1 << k)) {
        const b = best[k];
        if (!b || ad < Math.abs(b.sd.d) - 1e-9 || (Math.abs(ad - Math.abs(b.sd.d)) <= 1e-9 && sd.ortho < b.sd.ortho)) best[k] = { e, sd };
      }
    }
    const inside = winding(flat, q) !== 0, i = y * w + x;
    sdf[i] = inside ? minAbs : -minAbs;
    for (let k = 0; k < 3; k++) msdf[i * 3 + k] = best[k] ? pseudoDistance(best[k].e, q, best[k].sd) : -1e3;
    const m = median3(msdf[i * 3], msdf[i * 3 + 1], msdf[i * 3 + 2]);
    if (Math.abs(sdf[i]) > 0.75) { total++; if ((m > 0) === inside) agree++; }
  }
  if (total && agree * 2 < total) for (let i = 0; i < msdf.length; i++) msdf[i] = -msdf[i];
  let repaired = 0;
  for (let i = 0; i < w * h; i++) { // error correction against the winding reference
    const m = median3(msdf[i * 3], msdf[i * 3 + 1], msdf[i * 3 + 2]);
    if ((m > 0) !== (sdf[i] > 0) || Math.abs(m - sdf[i]) > 1.25) { msdf[i * 3] = msdf[i * 3 + 1] = msdf[i * 3 + 2] = sdf[i]; repaired++; }
  }
  return { msdf, sdf, repaired };
}

/** Analytic SDF for procedural glyphs: union of capsules (strokes), discs and boxes, in px. All channels equal. */
export function proceduralSDF(shapes, w, h) {
  const sdf = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = [x + 0.5, y + 0.5]; let d = -1e3;
    for (const s of shapes) {
      let v;
      if (s.type === 'disc') v = s.r - Math.hypot(q[0] - s.c[0], q[1] - s.c[1]);
      else if (s.type === 'box') { const dx = Math.max(s.x0 - q[0], q[0] - s.x1), dy = Math.max(s.y0 - q[1], q[1] - s.y1); v = -(Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)); }
      else { const ab = sub(s.b, s.a), t = Math.min(1, Math.max(0, dot(sub(q, s.a), ab) / (dot(ab, ab) || 1))); v = s.r - Math.hypot(q[0] - s.a[0] - ab[0] * t, q[1] - s.a[1] - ab[1] * t); }
      if (v > d) d = v;
    }
    sdf[y * w + x] = d;
  }
  return sdf;
}
