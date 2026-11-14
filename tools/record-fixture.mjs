#!/usr/bin/env node
// Record an autoplayer run as a replayable regression fixture (same format as a crash report).
// Usage: node tools/record-fixture.mjs <name> <chapter 1-9 | endless:<seed>:<depth>> [seed] [maxTicks]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSim, step, hashState } from '../src/sim/sim.js';
import { createBot, botInput } from '../src/sim/bot.js';
import { endlessVerse } from '../src/sim/endless.js';
import { encodeInputs } from '../src/game/telemetry.js';
const [name, which, seedArg, maxArg] = process.argv.slice(2);
if (!name || !which) { console.error('usage: node tools/record-fixture.mjs <name> <chapter|endless:seed:depth> [seed] [maxTicks]'); process.exit(2); }
const endless = which.startsWith('endless:') ? { seed: +which.split(':')[1], depth: +which.split(':')[2] } : null, chapter = endless ? 0 : +which;
const seed = +(seedArg || (endless ? endless.seed + endless.depth : 100 + chapter - 1)), max = +(maxArg || 18000);
const sim = createSim(endless ? endlessVerse(endless.seed, endless.depth) : chapter - 1, seed), bot = createBot(), log = [];
while (!sim.c.done && !sim.c.dead && sim.tick < max) { const w = botInput(bot, sim); log.push(w); step(sim, w); sim.events.length = 0; }
const fixture = { schema: 1, kind: 'regression', name, chapter, endless, seed, inputsFrom: 0, inputs: encodeInputs(log), expect: { tick: sim.tick, hash: hashState(sim) >>> 0, done: sim.c.done, dead: sim.c.dead, hp: sim.p.hp } };
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests/regressions', `${name}.json`);
fs.writeFileSync(out, JSON.stringify(fixture) + '\n'); console.log(`${out}: ${log.length} ticks, ${fixture.inputs.length / 2} runs, hash ${fixture.expect.hash.toString(16)}`);
