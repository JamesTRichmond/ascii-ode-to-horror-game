import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodePNG } from '../tools/lib/png.mjs';
import { parseAtlas } from '../src/render/atlas.js';
import { createPipeline, setScene, renderFrame } from '../src/render/pipeline.js';
import { createSim, step } from '../src/sim/sim.js';
import { viewOf } from '../src/game/view.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = f => fs.readFileSync(path.join(root, f));
export const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
let cached;
export function assets() {
  if (cached) return cached;
  const bin = read('assets/atlas/glyphs.bin'), png = decodePNG(read('assets/atlas/atlas.png'));
  cached = { atlas: parseAtlas(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)), noise: new Uint8Array(read('assets/atlas/bluenoise.bin')), atlasPx: png, manifest: JSON.parse(read('assets/atlas/manifest.json')) };
  return cached;
}
// Canonical specimen scene (fixed camera and seed) used for every matched-camera comparison:
// a furred creature and a tall figure on grass in front of stone, with one measure (arcane light).
export const SPECIMEN = { id: 1, title: 'Specimen', rule: 0, need: 9, indoor: 0, startAng: 3072, map: ['rrrrrrrrrrr', 'rgggggggggr', 'rggggggMggr', 'rggggTggggr', 'rgggggggggr', 'rggggggfggr', 'rgggggggggr', 'rggggPggggr', 'rrrrrrrrrrr'] };
export function specimen(quality = 'high', frames = 3, mutate) {
  const { atlas, noise } = assets(), pl = createPipeline(atlas, noise, quality), sim = createSim(SPECIMEN, 100);
  sim.ents.push({ type: 3, x: 5 * 1024 + 700, z: 5 * 1024 + 200, ang: 600, hp: 0, mode: 8, timer: 1e9, tx: 0, tz: 0, aux: 0, hx: 0, hz: 0 });
  sim.ents[0].mode = 8; sim.ents[0].timer = 1e9;
  if (mutate) mutate(sim, pl);
  setScene(pl, sim);
  for (let f = 0; f < frames; f++) renderFrame(pl, viewOf(sim, sim, 1), 1 / 60);
  return { pl, sim, atlas, noise, frame: (dt = 1 / 60) => renderFrame(pl, viewOf(sim, sim, 1), dt), tick: input => { step(sim, input); sim.events.length = 0; } };
}
export const median3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
export const quantile = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
