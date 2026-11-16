// Render client: the same API as pipeline.js (createPipeline, setScene, adoptScene, renderFrame, burst), backed either
// by the in-thread pipeline ('local') or by a module Web Worker ('worker'). In worker mode the shell keeps a proxy
// with the fields it reads (w, h, quality, opts, stats, sel.inst/count/stats, qt.stats, cam.yaw, flash); each frame
// posts the serialized simulation state plus the interpolated view (including the camera mode and the player pose it
// carries), and draws the newest instance stream received.
// One frame is in flight at a time: if the worker is still busy, the newest view replaces the queued one (no backlog).
import * as local from './pipeline.js';
import { QUALITY } from './pipeline.js';
import { serialize } from '../sim/sim.js';
import { scriptURL } from '../game/safe-html.js';
export { QUALITY };

const C = { mode: 'local', worker: null, ready: null, raw: null, onError: null, nextId: 1 };
/** Choose 'worker' or 'local' for pipelines created from now on; `raw` = {glyphs: ArrayBuffer, noise: Uint8Array}. */
export function configureRenderer(mode, raw, onError) {
  C.raw = raw || C.raw; C.onError = onError || C.onError;
  C.mode = mode === 'worker' && typeof Worker !== 'undefined' ? 'worker' : 'local';
  if (C.mode === 'local' && C.worker) { C.worker.terminate(); C.worker = null; C.ready = null; }
  return C.mode;
}
export const rendererMode = () => C.mode;
/** After a worker crash: discard it; the next pipeline spawns a fresh one. */
export function restartWorker() { if (C.worker) { C.worker.terminate(); C.worker = null; C.ready = null; } }
function spawn() {
  if (C.worker) return; const w = C.worker = new Worker(scriptURL(new URL('./worker.js', import.meta.url)), { type: 'module' });
  C.ready = new Promise(res => { w.onmessage = e => { if (e.data.type === 'ready') { res(); return; } try { route(e.data); } catch (err) { C.onError?.({ message: String(err?.message || err), stack: String(err?.stack || '') }); } }; }); // a fault while applying a result is a crash like any other, never an uncaught error
  w.onerror = e => { C.onError?.({ message: e.message || 'render worker failed', stack: `${e.filename || ''}:${e.lineno || ''}` }); };
  w.postMessage({ type: 'init', glyphs: C.raw.glyphs.slice(0), noise: C.raw.noise.slice(0) });
}
let current = null;
function route(m) {
  if (m.type === 'error') { C.onError?.({ message: `render worker: ${m.message}`, stack: m.stack }); return; }
  const p = current; if (!p || m.type !== 'frame') return; p.busy = false; if (!m.stats || m.w !== p.w || m.h !== p.h) { if (p.queued) { const q = p.queued; p.queued = null; dispatch(p, q); } return; } // a frame from before a tier change is dropped
  p.sel.inst = m.inst; p.sel.count = m.count; p.sel.stats = m.stats.sel; p.qt.stats = m.stats.qt; Object.assign(p.stats, { ms: m.stats.ms, tris: m.stats.tris, player: m.stats.player, cascade: m.stats.cascade, exposure: m.stats.exposure }); p.frames++;
  if (p.queued) { const q = p.queued; p.queued = null; dispatch(p, q); }
}
export function createPipeline(atlas, noise, quality = 'high') {
  if (C.mode === 'local') return local.createPipeline(atlas, noise, quality);
  spawn(); const [w, h] = QUALITY[quality] || QUALITY.high;
  const p = { remote: true, w, h, quality, opts: { exposure: 1, fogScale: 1, bounces: 1, reducedMotion: false, etfIterations: 2 }, stats: { ms: { gbuffer: 0, light: 0, fog: 0, tree: 0, flow: 0, select: 0, total: 0 }, tris: 0, player: 0, cascade: null },
    sel: { inst: new Float32Array(0), count: 0, stats: { switchRate: 0 } }, qt: { stats: { leaves: 0, overflow: 0, byLevel: [0, 0, 0, 0], flips: 0 } }, cam: { yaw: 0 }, flash: 0, bursts: [], busy: false, queued: null, frames: 0, sim: null };
  current = p; return p;
}
const post = m => C.ready.then(() => C.worker?.postMessage(m));
export function setScene(p, sim) { if (!p.remote) return local.setScene(p, sim); p.sim = sim; p.busy = false; p.queued = null; post({ type: 'scene', quality: p.quality, def: sim.def, state: serialize(sim), opts: { ...p.opts } }); return p; }
export function adoptScene(p, from) { if (!p.remote) return local.adoptScene(p, from); post({ type: 'adopt', quality: p.quality, opts: { ...p.opts } }); return p; }
export function burst(p, ...args) { if (!p.remote) return local.burst(p, ...args); if (p.bursts.length < 64) p.bursts.push(args); }
/** Capture a frame now (state and view belong together), send it later if the worker is busy. */
function capture(p, view, dt) { const { sim, ...plain } = view; p.cam.yaw = view.yaw; return { state: serialize(sim), view: plain, dt }; }
function dispatch(p, f) { p.busy = true; post({ type: 'frame', id: C.nextId++, ...f, opts: { ...p.opts }, flash: p.flash, bursts: p.bursts.splice(0) }); p.flash = 0; }
/** Local: render now. Worker: hand the frame to the worker (or replace the queued one) and return the proxy at once. */
export function renderFrame(p, view, dt) {
  if (!p.remote) return local.renderFrame(p, view, dt);
  const f = capture(p, view, dt);
  if (p.busy) { f.dt = Math.min(0.25, (p.queued ? p.queued.dt : 0) + dt); p.queued = f; return p; }
  dispatch(p, f); return p;
}
