#!/usr/bin/env node
// Headless frame capture through the real pipeline + CPU compositor.
// Usage: node tools/snapshot.mjs <out.png> [chapter=1] [ticks=120] [quality=high] [debugMode] [scale=3]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG } from './lib/png.mjs';
import { parseAtlas } from '../src/render/atlas.js';
import { createPipeline, setScene, renderFrame } from '../src/render/pipeline.js';
import { compositeCPU, debugImage } from '../src/render/output_cpu.js';
import { createSim, step } from '../src/sim/sim.js';
import { viewOf } from '../src/game/view.js';
import { botInput, createBot } from '../src/sim/bot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function loadAssets() {
  const bin = fs.readFileSync(path.join(root, 'assets/atlas/glyphs.bin'));
  return { atlas: parseAtlas(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)), noise: new Uint8Array(fs.readFileSync(path.join(root, 'assets/atlas/bluenoise.bin'))), atlasPx: (() => { const p = decodePNG(fs.readFileSync(path.join(root, 'assets/atlas/atlas.png'))); return { pixels: p.pixels, w: p.w, h: p.h, channels: p.channels }; })() };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [out, chapter = '1', ticks = '120', quality = 'high', mode = '', scale = '3'] = process.argv.slice(2);
  const SPECIMEN = { id: 1, title: 'Specimen', rule: 0, need: 9, indoor: 0, startAng: 3072, map: ['rrrrrrrrrrr', 'rgggggggggr', 'rgggggggggr', 'rggggTggggr', 'rgggggggggr', 'rggggggfggr', 'rgggggggggr', 'rggggPggggr', 'rrrrrrrrrrr'] };
  const { atlas, noise, atlasPx } = loadAssets(), pl = createPipeline(atlas, noise, quality), sim = createSim(chapter === 'specimen' ? SPECIMEN : +chapter - 1, 100), bot = createBot();
  if (chapter === 'specimen') { sim.ents.push({ type: 3, x: 5 * 1024 + 700, z: 5 * 1024 + 200, ang: 1500, hp: 0, mode: 8, timer: 1e9, tx: 0, tz: 0, aux: 0, hx: 0, hz: 0 }); sim.ents[0].mode = 8; sim.ents[0].timer = 1e9; sim.ents[0].ang = 600; }
  setScene(pl, sim);
  for (let t = 0; t < +ticks; t++) { step(sim, chapter === 'specimen' ? 0 : botInput(bot, sim)); sim.events.length = 0; if (t % 2 === 0 && t > +ticks - 20) renderFrame(pl, viewOf(sim, sim, 1), 1 / 30); }
  renderFrame(pl, viewOf(sim, sim, 1), 1 / 30);
  const S = mode ? 1 : +scale, img = new Uint8ClampedArray(pl.w * S * pl.h * S * 4);
  if (mode) debugImage(img, pl, mode); else compositeCPU(img, pl.w, pl.h, S, pl.sel.inst, pl.sel.count, atlas, atlasPx);
  const rgb = new Uint8Array(pl.w * S * pl.h * S * 3); for (let i = 0; i < rgb.length / 3; i++) { rgb[i * 3] = img[i * 4]; rgb[i * 3 + 1] = img[i * 4 + 1]; rgb[i * 3 + 2] = img[i * 4 + 2]; }
  fs.writeFileSync(out, encodePNG(pl.w * S, pl.h * S, rgb, 3));
  console.log(JSON.stringify({ chapter: +chapter, tick: sim.tick, leaves: pl.qt.stats, glyphs: pl.sel.stats, ms: Object.fromEntries(Object.entries(pl.stats.ms).map(([k, v]) => [k, +v.toFixed(1)])), tris: pl.stats.tris, cascade: pl.stats.cascade }));
}
