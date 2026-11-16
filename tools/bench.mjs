#!/usr/bin/env node
// Render-stage benchmark. Usage: node tools/bench.mjs [quality=medium] [frames=40] [camera=first|dimetric]
// Chapters 1, 3, 6 and 9 with the autoplayer moving (two ticks per frame); prints the p50 of every pipeline stage and
// the p50/p95 of the whole frame (ms).
import { assets } from '../tests/helpers.mjs';
import { createPipeline, setScene, renderFrame } from '../src/render/pipeline.js';
import { createSim, step } from '../src/sim/sim.js';
import { createBot, botInput } from '../src/sim/bot.js';
import { viewOf, snapshot } from '../src/game/view.js';
const { atlas, noise } = assets(), q = process.argv[2] || 'medium', N = +(process.argv[3] || 40), camera = process.argv[4] || 'first', stages = {};
for (const i of [0, 2, 5, 8]) {
  const pl = createPipeline(atlas, noise, q), sim = createSim(i, 300 + i), bot = createBot(); setScene(pl, sim);
  for (let f = 0; f < N; f++) { const prev = snapshot(sim); for (let k = 0; k < 2; k++) { step(sim, botInput(bot, sim)); sim.events.length = 0; } renderFrame(pl, { ...viewOf(prev, sim, 1), camera }, 1 / 30); if (f >= 5) for (const [k, v] of Object.entries(pl.stats.ms)) (stages[k] ||= []).push(v); }
}
const p50 = a => [...a].sort((x, y) => x - y)[a.length >> 1], p95 = a => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))];
console.log(`${q} ${camera} (${process.version}): ` + Object.entries(stages).map(([k, v]) => `${k} ${p50(v).toFixed(2)}`).join(' | ') + ` ms | frame p95 ${p95(stages.total).toFixed(2)} ms`);
