// Visual-regression goldens: every chapter rendered headlessly through the full CPU pipeline (G-buffer, light, fog,
// quadtree, flow, glyph selection) and the reference CPU compositor, from a fixed camera and seed. The image
// metrics tolerate last-bit floating point differences between runtimes, but catch any visible change in lighting,
// glyph choice or composition.
import { assets } from '../../tests/helpers.mjs';
import { createPipeline, setScene, renderFrame } from '../../src/render/pipeline.js';
import { compositeCPU } from '../../src/render/output_cpu.js';
import { createSim, step } from '../../src/sim/sim.js';
import { CHAPTERS } from '../../src/sim/chapters.js';
import { createBot, botInput } from '../../src/sim/bot.js';
import { viewOf, snapshot } from '../../src/game/view.js';

export const GOLDEN_QUALITY = 'low', GOLDEN_FRAMES = 8, GOLDEN_TICKS = 90;
/** RGB (no alpha) of chapter `i` after GOLDEN_TICKS autoplayer ticks and GOLDEN_FRAMES rendered frames, seen through
 *  `camera` ('first' = the singer's eye, 'dimetric' = the fixed overhead view). */
export function renderChapter(i, mutate = null, camera = 'first') {
  const { atlas, noise, atlasPx } = assets(), pl = createPipeline(atlas, noise, GOLDEN_QUALITY), sim = createSim(i, 300 + i), bot = createBot({ ending: 2 }); mutate?.(pl, sim);
  for (let t = 0; t < GOLDEN_TICKS; t++) { step(sim, botInput(bot, sim)); sim.events.length = 0; }
  setScene(pl, sim); const prev = snapshot(sim);
  for (let f = 0; f < GOLDEN_FRAMES; f++) renderFrame(pl, { ...viewOf(prev, sim, 1), camera }, 1 / 30);
  const rgba = new Uint8ClampedArray(pl.w * pl.h * 4); compositeCPU(rgba, pl.w, pl.h, 1, pl.sel.inst, pl.sel.count, atlas, atlasPx);
  const rgb = new Uint8Array(pl.w * pl.h * 3); for (let k = 0; k < pl.w * pl.h; k++) { rgb[k * 3] = rgba[k * 4]; rgb[k * 3 + 1] = rgba[k * 4 + 1]; rgb[k * 3 + 2] = rgba[k * 4 + 2]; }
  return { w: pl.w, h: pl.h, rgb, glyphs: pl.sel.count };
}
export const chapterCount = () => CHAPTERS.length;

/** Image comparison: mean absolute error (0-255), share of pixels off by more than 24 levels in any channel, and a
 *  diff image (red = brighter than golden, cyan = darker, grey = unchanged context). */
export function compare(a, b, w, h) {
  let sum = 0, off = 0; const diff = new Uint8Array(w * h * 3);
  for (let k = 0; k < w * h; k++) {
    let mx = 0, signed = 0; for (let c = 0; c < 3; c++) { const d = a[k * 3 + c] - b[k * 3 + c]; sum += Math.abs(d); mx = Math.max(mx, Math.abs(d)); signed += d; }
    if (mx > 24) off++;
    const g = (b[k * 3] + b[k * 3 + 1] + b[k * 3 + 2]) / 9, o = k * 3;
    if (mx > 24) { if (signed > 0) { diff[o] = 255; diff[o + 1] = diff[o + 2] = 40; } else { diff[o] = 40; diff[o + 1] = diff[o + 2] = 255; } } else diff[o] = diff[o + 1] = diff[o + 2] = g;
  }
  return { mae: sum / (w * h * 3), offShare: off / (w * h), diff };
}
