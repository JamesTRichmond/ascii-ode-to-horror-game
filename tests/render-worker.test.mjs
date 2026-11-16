// Render worker (roadmap 1.2): the off-thread pipeline must produce exactly what the in-thread pipeline produces.
// Runs src/render/worker.js under Node worker_threads (tests/worker-bootstrap.mjs) with the messages the browser client sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { root, assets } from './helpers.mjs';
import { createPipeline, setScene, renderFrame, burst } from '../src/render/pipeline.js';
import { createSim, step, serialize } from '../src/sim/sim.js';
import { createBot, botInput } from '../src/sim/bot.js';
import { viewOf, snapshot } from '../src/game/view.js';

test('worker output is identical to the in-thread pipeline, frame by frame, including bursts and tier adoption', async () => {
  const w = new Worker(new URL('./worker-bootstrap.mjs', import.meta.url)), inbox = [], waiters = [];
  w.unref(); w.on('message', m => { const r = waiters.shift(); if (r) r(m); else inbox.push(m); }); w.on('error', e => { const r = waiters.shift(); if (r) r({ type: 'error', message: e.message }); });
  try { const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise(r => waiters.push(r)));
  const glyphs = fs.readFileSync(path.join(root, 'assets/atlas/glyphs.bin')), noise = fs.readFileSync(path.join(root, 'assets/atlas/bluenoise.bin'));
  w.postMessage({ type: 'init', glyphs: glyphs.buffer.slice(glyphs.byteOffset, glyphs.byteOffset + glyphs.byteLength), noise: new Uint8Array(noise) }); assert.equal((await next()).type, 'ready');
  const { atlas, noise: nz } = assets(), pl = createPipeline(atlas, nz, 'low'); // one pipeline across chapters, as in the game (setScene on the same pipeline)
  let last = null;
  for (const chapter of [1, 4, 7]) {
    const sim = last = createSim(chapter, 400 + chapter), bot = createBot();
    for (let t = 0; t < 60; t++) { step(sim, botInput(bot, sim)); sim.events.length = 0; }
    setScene(pl, sim); w.postMessage({ type: 'scene', quality: 'low', def: sim.def, state: serialize(sim), opts: {} });
    for (let f = 0; f < 6; f++) {
      const prev = snapshot(sim); step(sim, botInput(bot, sim)); sim.events.length = 0; const view = viewOf(prev, sim, 0.5), { sim: _, ...plain } = view, bursts = f === 2 ? [[2, 1.2, 3, 30, 3, [1, 0.2, 0.1], 0.7, null]] : [];
      for (const b of bursts) burst(pl, ...b); renderFrame(pl, view, 1 / 30);
      w.postMessage({ type: 'frame', id: f, state: serialize(sim), view: plain, dt: 1 / 30, opts: {}, flash: 0, bursts }); const m = await next();
      assert.equal(m.type, 'frame', m.message); assert.equal(m.count, pl.sel.count, `chapter ${chapter + 1} frame ${f}: glyph count`);
      assert.deepEqual(Buffer.from(m.inst.buffer, m.inst.byteOffset, m.inst.byteLength), Buffer.from(pl.sel.inst.buffer, 0, pl.sel.count * 11 * 4), `chapter ${chapter + 1} frame ${f}: instance stream`);
    }
  }
  w.postMessage({ type: 'adopt', quality: 'medium', opts: {} }); const sim = last, prev = snapshot(sim); step(sim, 0); // a tier change mid-chapter keeps the scene
  const { sim: _s, ...plain } = viewOf(prev, sim, 1); w.postMessage({ type: 'frame', id: 99, state: serialize(sim), view: plain, dt: 1 / 30, opts: {}, flash: 1, bursts: [] }); const m = await next();
  assert.equal(m.w, 400); assert.ok(m.count > 0, 'adopted medium-tier pipeline renders');
  } finally { await w.terminate(); } // a failed assertion must not leave the worker holding the test process open
});
