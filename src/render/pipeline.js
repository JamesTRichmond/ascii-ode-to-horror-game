// Frame pipeline. Order is fixed by the guide: resolve continuous geometry -> transported light
// and fog -> adaptive leaves -> surface flow -> glyph selection with temporal history -> output.
import { createGBuffer, makeCamera, setCamera, copyCamera, traceWorld, rasterMesh, worldVelocity, CELL } from './gbuffer.js';
import { createCascades, solveCascades, addEmitter, TEXELS_PER_CELL } from './cascades.js';
import { shade, createFog, integrateFog, compositeFog, directionalShadow } from './light.js';
import { createQuadtree, subdivide } from './quadtree.js';
import { createFlow, computeFlow } from './flow.js';
import { createSelector, selectGlyphs, appendTrails } from './select.js';
import { DecayField } from './temporal.js';
import { getMesh, transformMesh } from './meshes.js';
import { buildWorld, syncWorld } from './world.js';
import { ET } from '../sim/sim.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
const norm3 = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
export const QUALITY = { low: [320, 180, 6000], medium: [400, 225, 9000], high: [480, 270, 13000] };

/** Per-chapter atmosphere. All radiometric values are scene-linear. */
export const THEMES = {
  1: { ambient: [0.03, 0.04, 0.05], skyTop: [0.003, 0.005, 0.011], skyHorizon: [0.012, 0.02, 0.03], dir: norm3([0.35, 0.7, 0.6]), dirColor: [1.1, 1.25, 1.45], fog: 0.02, fogH: 2.6, fogAmb: [0.012, 0.022, 0.03], stars: 1, body: 'moon', exposure: 1.7 },
  2: { ambient: [0.04, 0.04, 0.05], skyTop: [0.004, 0.004, 0.01], skyHorizon: [0.02, 0.016, 0.022], dir: norm3([0.5, 0.75, 0.3]), dirColor: [0.7, 0.7, 0.85], fog: 0.014, fogH: 4, fogAmb: [0.014, 0.014, 0.02], stars: 0.6, body: 'moon', exposure: 1.7 },
  3: { ambient: [0.075, 0.064, 0.05], skyTop: [0, 0, 0], skyHorizon: [0, 0, 0], dir: [0, 1, 0], dirColor: [0, 0, 0], fog: 0.03, fogH: 2.2, fogAmb: [0.014, 0.012, 0.01], stars: 0, exposure: 2.2 },
  4: { ambient: [0.06, 0.085, 0.07], skyTop: [0, 0, 0], skyHorizon: [0, 0, 0], dir: [0, 1, 0], dirColor: [0, 0, 0], fog: 0.026, fogH: 3, fogAmb: [0.008, 0.016, 0.012], stars: 0, exposure: 1.9 },
  5: { lantern: 0.3, ambient: [0.006, 0.006, 0.008], skyTop: [0, 0, 0], skyHorizon: [0, 0, 0], dir: [0, 1, 0], dirColor: [0, 0, 0], fog: 0.022, fogH: 4, fogAmb: [0.002, 0.002, 0.003], stars: 0, exposure: 2.0 },
  6: { ambient: [0.03, 0.022, 0.02], skyTop: [0.02, 0.012, 0.02], skyHorizon: [0.09, 0.04, 0.025], dir: norm3([-0.8, 0.3, 0.2]), dirColor: [0.5, 0.3, 0.18], fog: 0.03, fogH: 3.5, fogAmb: [0.05, 0.028, 0.02], stars: 0.2, exposure: 1.5 },
  7: { ambient: [0.06, 0.054, 0.04], skyTop: [0, 0, 0], skyHorizon: [0, 0, 0], dir: [0, 1, 0], dirColor: [0, 0, 0], fog: 0.03, fogH: 5, fogAmb: [0.03, 0.026, 0.014], stars: 0, exposure: 1.6 },
  8: { ambient: [0.03, 0.026, 0.03], skyTop: [0.02, 0.025, 0.05], skyHorizon: [0.25, 0.14, 0.07], dir: norm3([0.9, 0.22, 0.05]), dirColor: [0.8, 0.55, 0.3], fog: 0.012, fogH: 3, fogAmb: [0.05, 0.035, 0.03], stars: 0.15, body: 'sun', exposure: 1.3 },
  9: { lantern: 0.15, ambient: [0.09, 0.09, 0.085], skyTop: [0.12, 0.16, 0.22], skyHorizon: [0.5, 0.45, 0.36], dir: norm3([-0.3, 0.8, -0.4]), dirColor: [1.3, 1.2, 1.0], fog: 0.016, fogH: 3, fogAmb: [0.16, 0.15, 0.13], stars: 0, body: 'sun', exposure: 1.0 },
};
const MESH_OF = { [ET.FORSAKER]: 'forsaker', [ET.CROWNED]: 'crowned', [ET.TRAMPLER]: 'trampler', [ET.MIRTH]: 'mirth', [ET.TRIUNE]: 'triune', [ET.HUSK]: 'husk', [ET.BUILDER]: 'builder', [ET.MARCHER]: 'marcher', [ET.CHORISTER]: 'chorister', [ET.COMER]: 'comer', [ET.SLUMBERER]: 'slumberer' };
const UNIT_M = CELL / 1024; // simulation units -> metres

export function createPipeline(atlas, noise, quality = 'high') {
  const [w, h, cap] = QUALITY[quality] || QUALITY.high;
  const pl = {
    w, h, quality, atlas, noise, gb: createGBuffer(w, h), cam: makeCamera(w, h), prevCam: makeCamera(w, h), qt: createQuadtree(w, h, cap), flow: createFlow(w, h), fog: createFog(w, h, 4),
    sel: createSelector(w, h, cap, atlas, noise), trails: new DecayField(900), world: null, cascades: null, shadow: null, instances: new Map(), firstFrame: true, time: 0,
    opts: { exposure: 1, fogScale: 1, bounces: 1, reducedMotion: false, etfIterations: 2 }, flash: 0, humLevel: 0,
    stats: { ms: { gbuffer: 0, light: 0, fog: 0, tree: 0, flow: 0, select: 0, total: 0 }, tris: 0, cascade: null },
    env: null,
  };
  return pl;
}

export function setScene(pl, sim) {
  pl.world = buildWorld(sim); pl.cascades = createCascades(sim.w * TEXELS_PER_CELL, sim.h * TEXELS_PER_CELL);
  // static atmosphere: low mist banks over water, settling dust indoors (fog bodies in the heterogeneous field)
  const mist = []; let k = 0;
  for (let z = 1; z < sim.h - 1; z += 3) for (let x = 1; x < sim.w - 1; x += 4) {
    const t = sim.tiles[z * sim.w + x], water = t === 126 || t === 61, open = !sim.def.indoor || t === 46;
    if ((water || (sim.def.indoor && open)) && (k++ % (water ? 2 : 3)) === 0 && mist.length < 60) mist.push((x + 0.5) * 2, water ? 0.25 : 0.6, (z + 0.5) * 2, water ? 4.5 : 3.5, water ? 0.07 : 0.035);
  }
  pl.mist = mist;
  pl.shadow = new Uint8Array(pl.cascades.tw * pl.cascades.th).fill(1); pl.instances.clear(); pl.trails.clear(); pl.firstFrame = true; pl.world.dirty = true;
  pl.sel.prev.slotOf.fill(-1); pl.sel.cur.slotOf.fill(-1);
}

function instance(pl, key) { let i = pl.instances.get(key); if (!i) { i = { x: 0, y: 0, z: 0, yaw: 0, scale: 1 }; pl.instances.set(key, i); } i.used = true; return i; }

/**
 * Render one frame from an interpolated view of the simulation.
 * view: {x,z (metres), yaw (rad), bob, ents:[{type,x,z,yaw,mode}], sim}
 */
export function renderFrame(pl, view, dt) {
  const t0 = now(), { gb, cam, prevCam, world, cascades: c, fog, sim: _ } = pl, sim = view.sim, th = THEMES[sim.def.id], ms = pl.stats.ms;
  pl.time += pl.opts.reducedMotion ? 0 : dt; const time = pl.time;
  copyCamera(prevCam, cam); setCamera(cam, view.x, 1.62 + (view.hold ? -0.25 : 0), view.z, view.yaw, pl.opts.reducedMotion ? 0 : view.bob || 0);
  if (pl.firstFrame) copyCamera(prevCam, cam);
  syncWorld(world, sim, dt);
  // ---- G-buffer ----
  traceWorld(gb, world, cam); worldVelocity(gb, cam, prevCam);
  for (const i of pl.instances.values()) i.used = false;
  let id = 1, tris = 0; const blobs = [];
  const draw = (key, name, x, y, z, yaw, o = {}) => { const mesh = getMesh(name), inst = instance(pl, key); inst.x = x; inst.y = y; inst.z = z; inst.yaw = yaw; inst.scale = o.scale ?? 1; inst.sway = o.sway ?? 0; inst.phase = o.phase ?? 0; inst.squash = o.squash ?? 1; transformMesh(mesh, inst, time); tris += rasterMesh(gb, cam, prevCam, mesh, inst.wp, inst.wn, inst.wt, inst.pp, Math.min(255, id++)); };
  view.ents.forEach((e, k) => {
    if (e.mode === 9) return;
    if (e.type === ET.SIGH) { blobs.push(e.x, 1.3, e.z, 2.6, 0.9); return; }
    if ((e.type === ET.CHORISTER) && sim.c.phase !== 1) return;
    const dx = e.x - cam.x, dz = e.z - cam.z; if (dx * cam.fx + dz * cam.fz < -1.5 || dx * dx + dz * dz > 70 * 70) return;
    const stag = e.mode === 8, husk = e.type === ET.HUSK && e.mode === 0;
    draw('e' + k, MESH_OF[e.type], e.x, husk ? 0.45 : 0, e.z, e.yaw, { sway: stag ? 0.09 : e.type === ET.SLUMBERER ? 0 : 0.028, phase: k * 1.7, squash: stag ? 0.86 : 1 });
  });
  sim.picks.forEach((m, k) => { if (!m.taken) draw('m' + k, 'measure', m.x * UNIT_M, 1.25 + Math.sin(time * 1.3 + k) * 0.12, m.z * UNIT_M, time * 0.9 + k, { scale: 0.9 }); });
  for (let z = 0; z < sim.h; z++) for (let x = 0; x < sim.w; x++) if (sim.tiles[z * sim.w + x] === 66 && sim.dyn[z * sim.w + x]) draw('b' + (z * sim.w + x), 'flame', (x + 0.5) * CELL, 0.9, (z + 0.5) * CELL, time * 0.6, { sway: 0.08, phase: x });
  if (th.body) draw('sky', th.body, cam.x + th.dir[0] * 320, cam.y + th.dir[1] * 320, cam.z + th.dir[2] * 320, 0, { scale: th.body === 'sun' ? 30 : 15 });
  for (const [k, i] of pl.instances) if (!i.used) pl.instances.delete(k);
  pl.stats.tris = tris; const t1 = now(); ms.gbuffer = t1 - t0;
  // ---- transported light ----
  const T = TEXELS_PER_CELL, tm = CELL / T; c.emit.fill(0);
  for (let z = 0; z < world.h; z++) for (let x = 0; x < world.w; x++) { const s = world.floorH[z * world.w + x] > 1.6 ? 1 : 0; for (let j = 0; j < T; j++) c.solid.fill(s, (z * T + j) * c.tw + x * T, (z * T + j) * c.tw + x * T + T); }
  const p = sim.p; pl.humLevel += ((p.hum ? 1 : 0) - pl.humLevel) * Math.min(1, dt * 6); pl.flash *= Math.exp(-dt / 0.35);
  const hum = pl.humLevel * (1.5 + 0.35 * Math.sin(time * 9)) + pl.flash * 6;
  addEmitter(c, view.x, view.z, 1.2, [0.12 + 0.5 * hum, 0.14 + 1.3 * hum, 0.16 + 1.2 * hum], tm); // the singer always carries a faint presence
  if (p.flame) addEmitter(c, view.x + cam.fx * 0.6, view.z + cam.fz * 0.6, 1.0, [1.5, 0.66, 0.16].map(v => v * (0.85 + 0.15 * Math.sin(time * 11))), tm);
  for (const m of sim.picks) if (!m.taken) addEmitter(c, m.x * UNIT_M, m.z * UNIT_M, 0.9, [0.35, 1.05, 1.2], tm);
  for (let z = 0; z < sim.h; z++) for (let x = 0; x < sim.w; x++) { const t = sim.tiles[z * sim.w + x], i = z * sim.w + x;
    if (t === 66 && sim.dyn[i]) for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) addEmitter(c, (x + 0.5 + ox * 0.75) * CELL, (z + 0.5 + oz * 0.75) * CELL, 0.8, [2.6, 1.2, 0.3], tm);
    if (t === 88 && sim.c.gateOpen) addEmitter(c, (x + 0.5) * CELL, (z + 0.5) * CELL, 1.2, [0.5, 1.5, 1.7], tm); }
  for (const e of view.ents) if ((e.type === ET.CHORISTER && sim.c.phase === 1) || e.type === ET.COMER) addEmitter(c, e.x, e.z, 1.1, [1.3, 1.1, 0.6], tm);
  const surge = sim.def.dawn ? (sim.c.stage === 2 ? 1 : sim.c.stage === 1 ? 0.35 : 0.08) : 0;
  const sky = th.skyHorizon.map((v, k) => v * 0.6 + th.ambient[k] + surge * [1.6, 1.0, 0.5][k]);
  solveCascades(c, { sigma: th.fog * tm * pl.opts.fogScale, sky, bounces: pl.opts.bounces, albedo: 0.5, gain: 0.8 });
  if (world.dirty) { if (th.dirColor[0] > 0) directionalShadow(world, th.dir, pl.shadow); world.dirty = false; }
  const apart = sim.def.glory && sim.c.phase === 1 ? 2.2 : 1, dirK = sim.def.dawn ? 0.25 + surge * 2.2 : 1;
  const lantern = { intensity: (th.lantern ?? 0.55) * (1 + 1.6 * pl.humLevel) + pl.flash * 2, falloff: 0.09, color: p.flame ? [1.0, 0.62, 0.3] : [0.72, 0.86, 0.95] };
  const env = pl.env = { lantern, ambient: th.ambient.map(v => v * apart), skyTop: th.skyTop, skyHorizon: th.skyHorizon.map(v => v * (1 + surge * 2)), dir: { d: th.dir, color: th.dirColor.map(v => v * dirK) }, shadow: th.dirColor[0] > 0 ? pl.shadow : null, cascades: c, time, exposure: th.exposure * pl.opts.exposure, stars: th.stars, dt };
  shade(gb, cam, env); const t2 = now(); ms.light = t2 - t1;
  fog.sigma = th.fog * pl.opts.fogScale * apart; fog.height = th.fogH; fog.ambient = th.fogAmb.map(v => v * (1 + surge * 3)); fog.blobs = pl.mist && pl.mist.length ? pl.mist.concat(blobs) : blobs.length ? blobs : null;
  integrateFog(fog, gb, cam, env, pl.noise); compositeFog(fog, gb); const t3 = now(); ms.fog = t3 - t2;
  // ---- adaptive leaves, flow, glyphs ----
  subdivide(pl.qt, gb); const t4 = now(); ms.tree = t4 - t3;
  computeFlow(pl.flow, gb, cam, { noise: pl.noise, etfIterations: pl.opts.etfIterations }); const t5 = now(); ms.flow = t5 - t4;
  selectGlyphs(pl.sel, gb, pl.qt, pl.flow, cam, prevCam, { dt: pl.firstFrame ? 0 : dt });
  pl.trails.update(pl.opts.reducedMotion ? dt * 4 : dt); appendTrails(pl.sel, pl.trails, gb, cam);
  const t6 = now(); ms.select = t6 - t5; ms.total = t6 - t0; pl.stats.cascade = c.stats; pl.firstFrame = false;
  return pl;
}

/** Emit a burst of decaying glyphs (chord, unwriting, pickups). Suppressed shockwaves in reduced-motion mode. */
export function burst(pl, x, y, z, count, speed, rgb, tau = 0.7, dirYaw = null) {
  if (pl.opts.reducedMotion) { count = Math.min(count, 6); speed = 0; tau = Math.min(tau, 0.25); }
  for (let i = 0; i < count; i++) {
    const a = dirYaw === null ? i * 2.39996 : dirYaw + ((i * 0.618) % 1 - 0.5) * 1.3, r = 0.3 + ((i * 0.37) % 1) * 0.7, el = ((i * 0.73) % 1 - 0.35) * 0.9;
    pl.trails.emit(x, y, z, Math.cos(a) * speed * r, el * speed * 0.5, Math.sin(a) * speed * r, 0.55 + 0.45 * ((i * 0.29) % 1), tau * (0.6 + ((i * 0.53) % 1) * 0.8), rgb);
  }
}
