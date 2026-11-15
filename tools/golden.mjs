#!/usr/bin/env node
// Cross-runtime determinism goldens. Usage: node tools/golden.mjs [--write]
// Runs the autoplayer on every chapter and on three Endless verses for a fixed number of ticks and prints the
// state hash after every 300 ticks. --write stores them in tests/golden/determinism.json; the test compares.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSim, step, hashState } from '../src/sim/sim.js';
import { CHAPTERS } from '../src/sim/chapters.js';
import { endlessVerse } from '../src/sim/endless.js';
import { createBot, botInput } from '../src/sim/bot.js';

export const GOLDEN_TICKS = 2400, GOLDEN_EVERY = 300;
export function goldenRuns() {
  const targets = [...CHAPTERS.map((c, i) => [`chapter-${c.id}`, i, 200 + i]), ...[1, 3, 6].map(d => [`endless-11-${d}`, endlessVerse(11, d), 50 + d])];
  const out = {};
  for (const [name, def, seed] of targets) {
    const sim = createSim(def, seed), bot = createBot({ ending: 2 }), hashes = [];
    for (let t = 1; t <= GOLDEN_TICKS; t++) { step(sim, botInput(bot, sim)); sim.events.length = 0; if (t % GOLDEN_EVERY === 0) hashes.push((hashState(sim) >>> 0).toString(16)); }
    out[name] = { seed, hashes, end: sim.c.done ? 'done' : sim.c.dead ? 'dead' : 'running' };
  }
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const runs = goldenRuns(), file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests/golden/determinism.json');
  if (process.argv.includes('--write')) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ node: process.version, ticks: GOLDEN_TICKS, every: GOLDEN_EVERY, runs }, null, 1) + '\n'); console.log('wrote', file); }
  else console.log(JSON.stringify(runs));
}
