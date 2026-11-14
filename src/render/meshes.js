// Procedural geometry: ellipsoids and tubes with authored surface tangents, assembled into creatures.
// Tangents run along fur/fibre direction and feed the surface-flow stage.
import { MAT } from '../shared/materials.js';

class Builder {
  constructor() { this.p = []; this.n = []; this.t = []; this.m = []; this.i = []; }
  vert(p, n, t, m) { this.p.push(...p); this.n.push(...n); this.t.push(...t); this.m.push(m); return this.m.length - 1; }
  sphere(c, r, m, nu = 12, nv = 8) {
    const base = this.m.length;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = (i / nu) * Math.PI * 2, v = (j / nv) * Math.PI, sx = Math.sin(v) * Math.cos(u), sy = Math.cos(v), sz = Math.sin(v) * Math.sin(u);
      const nx = sx / r[0], ny = sy / r[1], nz = sz / r[2], l = Math.hypot(nx, ny, nz) || 1;
      // fibres run from the pole downward along meridians
      const tx = Math.cos(v) * Math.cos(u), ty = -Math.sin(v), tz = Math.cos(v) * Math.sin(u), tl = Math.hypot(tx, ty, tz) || 1;
      this.vert([c[0] + sx * r[0], c[1] + sy * r[1], c[2] + sz * r[2]], [nx / l, ny / l, nz / l], [tx / tl, ty / tl, tz / tl], m);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = base + j * (nu + 1) + i, b = a + nu + 1; this.i.push(a, a + 1, b, a + 1, b + 1, b); }
    return this;
  }
  tube(pts, radii, m, steps = 7) {
    const base = this.m.length, n = pts.length;
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)]; let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const tl = Math.hypot(...t) || 1; t = t.map(x => x / tl);
      const ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let u = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]]; const ul = Math.hypot(...u) || 1; u = u.map(x => x / ul);
      const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
      for (let s = 0; s <= steps; s++) { const th = (s / steps) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th), nr = [u[0] * c + v[0] * sn, u[1] * c + v[1] * sn, u[2] * c + v[2] * sn]; this.vert([pts[k][0] + nr[0] * radii[k], pts[k][1] + nr[1] * radii[k], pts[k][2] + nr[2] * radii[k]], nr, t, m); }
    }
    for (let k = 0; k < n - 1; k++) for (let s = 0; s < steps; s++) { const a = base + k * (steps + 1) + s, b = a + steps + 1; this.i.push(a, b, a + 1, a + 1, b, b + 1); }
    return this;
  }
  build() { return { pos: Float32Array.from(this.p), nrm: Float32Array.from(this.n), tan: Float32Array.from(this.t), mat: Uint8Array.from(this.m), tris: Uint16Array.from(this.i), vcount: this.m.length }; }
}
export const builder = () => new Builder();

function figure(b, m, o = {}) { // an upright, too-tall person-shape. Local +x is forward.
  const hgt = o.height ?? 2.1, arm = o.arm ?? 0.95, lean = o.lean ?? 0.12, head = o.head ?? 0.17, off = o.z ?? 0;
  b.tube([[0, 0.02, off], [lean * 0.3, hgt * 0.45, off], [lean, hgt * 0.8, off]], [0.2, 0.24, 0.17], m, 8);
  b.sphere([lean + 0.03, hgt * 0.8 + head * 1.25, off], [head, head * 1.3, head], o.headMat ?? m, 10, 7);
  for (const s of [-1, 1]) {
    b.tube([[lean, hgt * 0.76, off + s * 0.2], [lean + 0.14, hgt * 0.76 - arm * 0.5, off + s * 0.3], [lean + 0.34, hgt * 0.76 - arm, off + s * 0.27]], [0.065, 0.05, 0.03], m, 6);
    b.tube([[0, hgt * 0.42, off + s * 0.1], [0.03, 0.02, off + s * 0.13]], [0.1, 0.06], m, 6);
  }
  for (const s of [-1, 1]) b.sphere([lean + head * 0.85, hgt * 0.8 + head * 1.35, off + s * head * 0.4], [0.03, 0.035, 0.03], o.eye ?? MAT.EMBER, 6, 4);
  return b;
}
function spider(b, m) { // the guide's Dusk Widow, re-authored at game scale; local +x forward
  b.sphere([-0.6, 0.95, 0], [0.85, 0.6, 0.72], m, 16, 10).sphere([0.45, 0.72, 0], [0.5, 0.38, 0.46], m, 12, 8).sphere([0.92, 0.62, 0], [0.3, 0.24, 0.3], m, 10, 6);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    const zx = [-0.9, -0.3, 0.45, 1.2][i];
    b.tube([[0.1 + i * 0.2, 0.75, s * 0.3], [zx * 0.75, 1.05 + (i % 2) * 0.1, s * [0.95, 1.2, 1.25, 1.0][i]], [zx * 1.3, 0.3, s * [1.4, 1.8, 1.85, 1.5][i]], [zx * 1.45, 0.02, s * [1.5, 1.95, 2.0, 1.6][i]]], [0.11, 0.09, 0.045, 0.012], m, 6);
    for (let k = 0; k < 2 && i < 2; k++) b.sphere([1.12 - k * 0.05, 0.72 - k * 0.04, s * (0.08 + k * 0.07 + i * 0.05)], [0.03, 0.03, 0.03], MAT.EMBER, 6, 4);
  }
  return b;
}

const cache = new Map();
/** Mesh archetypes by name. Built once. */
export function getMesh(name) {
  if (cache.has(name)) return cache.get(name);
  const b = builder();
  switch (name) {
    case 'forsaker': figure(b, MAT.FUR, { height: 2.3, arm: 1.25, lean: 0.22 }); break;
    case 'crowned': figure(b, MAT.CLOTH, { height: 2.5, arm: 1.0, lean: 0.05, headMat: MAT.BONE }); for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; b.tube([[0.08 + Math.cos(a) * 0.19, 2.42, Math.sin(a) * 0.19], [0.08 + Math.cos(a) * 0.24, 2.72, Math.sin(a) * 0.24]], [0.04, 0.008], MAT.GOLD, 5); } break;
    case 'trampler': spider(b, MAT.FUR); break;
    case 'mirth': figure(b, MAT.PALE, { height: 1.5, arm: 1.3, lean: 0.35, head: 0.24 }); break;
    case 'triune': for (const [z, hh, mm] of [[-0.42, 2.2, MAT.CLOTH], [0, 2.7, MAT.FUR], [0.42, 1.9, MAT.PALE]]) figure(b, mm, { height: hh, z, arm: 1.1, lean: 0.15 }); b.sphere([0, 1.0, 0], [0.42, 0.75, 0.7], MAT.FUR, 12, 8); break;
    case 'husk': b.tube([[0, 2.9, 0], [0, 2.35, 0]], [0.015, 0.015], MAT.BONE, 4); figure(b, MAT.BONE, { height: 1.9, arm: 0.9, lean: 0.02, eye: MAT.BONE }); break;
    case 'builder': figure(b, MAT.WOOD, { height: 2.0, arm: 1.2, lean: 0.3, eye: MAT.WOOD, head: 0.2 }); break;
    case 'marcher': figure(b, MAT.CLOTH, { height: 1.85, arm: 0.8, lean: 0.08, eye: MAT.CLOTH }); break;
    case 'chorister': figure(b, MAT.GLORY, { height: 2.6, arm: 1.4, lean: 0, eye: MAT.ARCANE }); b.tube(Array.from({ length: 9 }, (_, i) => [Math.cos(i / 8 * 6.283) * 0.42, 2.95, Math.sin(i / 8 * 6.283) * 0.42]), Array(9).fill(0.035), MAT.GLORY, 5); break;
    case 'comer': figure(b, MAT.GLORY, { height: 3.0, arm: 1.7, lean: -0.05, eye: MAT.GLORY, head: 0.22 }); break;
    case 'slumberer': b.tube([[-0.9, 0.2, 0], [0, 0.26, 0], [0.75, 0.22, 0]], [0.12, 0.24, 0.18], MAT.PALE, 8).sphere([0.98, 0.24, 0], [0.19, 0.17, 0.17], MAT.PALE, 10, 7).tube([[0.5, 0.25, 0.25], [0, 0.12, 0.42], [-0.4, 0.08, 0.36]], [0.06, 0.05, 0.03], MAT.PALE, 6); break;
    case 'measure': for (const [a, c] of [[[0, 0.55, 0], [0, -0.55, 0]], [[0.3, 0, 0], [-0.3, 0, 0]], [[0, 0, 0.3], [0, 0, -0.3]]]) b.tube([a, [0, 0, 0], c], [0.012, 0.11, 0.012], MAT.ARCANE, 5); break;
    case 'flame': b.tube([[0, 0, 0], [0.04, 0.3, 0.02], [-0.03, 0.62, -0.02], [0.02, 0.95, 0]], [0.2, 0.24, 0.13, 0.01], MAT.FLAME, 7); break;
    case 'moon': b.sphere([0, 0, 0], [1, 1, 1], MAT.BONE, 14, 10); break;
    case 'sun': b.sphere([0, 0, 0], [1, 1, 1], MAT.GLORY, 14, 10); break;
    default: throw new Error('unknown mesh ' + name);
  }
  const mesh = b.build(); mesh.name = name; cache.set(name, mesh); return mesh;
}

/**
 * Transform a mesh instance into world space with procedural animation.
 * inst: {x,y,z,yaw,scale, sway (m), phase, squash}. Writes wp/wn/wt (allocated on the instance).
 */
export function transformMesh(mesh, inst, time) {
  const n = mesh.vcount;
  if (!inst.wp || inst.wp.length !== n * 3) { inst.wp = new Float32Array(n * 3); inst.wn = new Float32Array(n * 3); inst.wt = new Float32Array(n * 3); inst.pp = new Float32Array(n * 3); inst.fresh = true; }
  else inst.pp.set(inst.wp);
  const c = Math.cos(inst.yaw), s = Math.sin(inst.yaw), sc = inst.scale ?? 1, sq = inst.squash ?? 1, sway = inst.sway ?? 0, ph = inst.phase ?? 0, { pos, nrm, tan } = mesh, { wp, wn, wt } = inst;
  for (let v = 0; v < n; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    if (sway) { const k = y * sway; x += Math.sin(time * 2.1 + ph + y * 1.7) * k; z += Math.cos(time * 1.7 + ph * 1.3 + y * 2.3) * k * 0.7; }
    wp[v * 3] = inst.x + (x * c - z * s) * sc; wp[v * 3 + 1] = inst.y + y * sc * sq; wp[v * 3 + 2] = inst.z + (x * s + z * c) * sc;
    wn[v * 3] = nrm[v * 3] * c - nrm[v * 3 + 2] * s; wn[v * 3 + 1] = nrm[v * 3 + 1]; wn[v * 3 + 2] = nrm[v * 3] * s + nrm[v * 3 + 2] * c;
    wt[v * 3] = tan[v * 3] * c - tan[v * 3 + 2] * s; wt[v * 3 + 1] = tan[v * 3 + 1]; wt[v * 3 + 2] = tan[v * 3] * s + tan[v * 3 + 2] * c;
  }
  if (inst.fresh) { inst.pp.set(wp); inst.fresh = false; }
}
