#!/usr/bin/env node
// Long-running simulation fuzzer. Usage: node tools/fuzz.mjs [runs per target=200] [ticks=3000] [first seed=1]
// Targets: the nine chapters and Endless verses at depths 1-6 (seed 7). Prints the first failing seed with a
// reproduction command; exit 1 on any violation.
import { fuzzRun } from './lib/fuzz.mjs';
import { CHAPTERS } from '../src/sim/chapters.js';
import { endlessVerse } from '../src/sim/endless.js';
const [runs = 200, ticks = 3000, first = 1] = process.argv.slice(2).map(Number);
const targets = [...CHAPTERS.map((c, i) => [`chapter ${c.id}`, i]), ...[1, 2, 3, 4, 5, 6].map(d => [`endless 7/${d}`, endlessVerse(7, d)])];
let total = 0, ended = 0; const t0 = performance.now();
for (const [name, def] of targets) for (let k = 0; k < runs; k++) {
  const seed = first + k, r = fuzzRun(def, seed, ticks); total++; if (r.dead || r.done) ended++;
  if (!r.ok) { console.error(`FAIL ${name} seed ${seed} at tick ${r.tick}: ${r.violations.join('; ')}`); process.exit(1); }
}
console.log(`fuzz: ${total} runs x ${ticks} ticks over ${targets.length} targets, 0 violations, ${ended} runs ended (death or exit), ${((performance.now() - t0) / 1000).toFixed(1)} s`);
