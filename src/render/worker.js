// Render worker (roadmap 1.2): runs the whole Nocturne pipeline (G-buffer, light, fog, quadtree, flow, glyph
// selection) off the main thread. The shell sends the canonical simulation state and the interpolated view each
// frame; the worker returns the glyph instance stream as a transferable buffer. Browser module worker; tests run it
// under Node worker_threads through tests/worker-bootstrap.mjs, which provides `self`.
import { parseAtlas } from './atlas.js';
import { createPipeline, setScene, adoptScene, renderFrame, burst } from './pipeline.js';
import { deserialize } from '../sim/sim.js';

let post, atlas = null, noise = null, pl = null, def = null;
const handle = msg => {
  try {
    if (msg.type === 'init') { atlas = parseAtlas(msg.glyphs); noise = new Uint8Array(msg.noise); post({ type: 'ready' }); return; }
    if (msg.type === 'scene') { def = msg.def; if (!pl || pl.quality !== msg.quality) pl = createPipeline(atlas, noise, msg.quality); Object.assign(pl.opts, msg.opts || {}); setScene(pl, deserialize(msg.state, def)); return; }
    if (msg.type === 'adopt') { const next = createPipeline(atlas, noise, msg.quality); if (pl && pl.world) adoptScene(next, pl); pl = next; Object.assign(pl.opts, msg.opts || {}); return; }
    if (msg.type === 'frame') {
      if (!pl || !pl.world) { post({ type: 'frame', id: msg.id, inst: new Float32Array(0), count: 0, stats: null }, []); return; }
      const sim = deserialize(msg.state, def); Object.assign(pl.opts, msg.opts || {}); if (msg.flash > pl.flash) pl.flash = msg.flash;
      for (const b of msg.bursts || []) burst(pl, ...b);
      renderFrame(pl, { ...msg.view, sim }, msg.dt);
      const n = pl.sel.count * 11, inst = pl.sel.inst.slice(0, n); // INSTANCE_FLOATS = 11
      post({ type: 'frame', id: msg.id, inst, count: pl.sel.count, w: pl.w, h: pl.h, quality: pl.quality, stats: { ms: { ...pl.stats.ms }, tris: pl.stats.tris, cascade: pl.stats.cascade, exposure: pl.stats.exposure, qt: { ...pl.qt.stats, byLevel: [...pl.qt.stats.byLevel] }, sel: { ...pl.sel.stats } } }, [inst.buffer]);
    }
  } catch (e) { post({ type: 'error', message: String(e?.message || e), stack: String(e?.stack || '') }); }
};
post = (m, t) => self.postMessage(m, t); self.onmessage = e => handle(e.data);
