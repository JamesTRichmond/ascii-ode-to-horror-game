#!/usr/bin/env node
// Deterministic replay of a crash report or a regression fixture.
// Usage: node tools/replay.mjs <report.json> [--until tick] [--trace]
// Input: { chapter (1-9, or 0 with endless), endless: {seed, depth} | null, seed, base: {tick, state} | null, inputs (RLE), inputsFrom, tick?, hash? }
// Reconstructs the chapter (from the serialized base state when the log starts mid-run), replays every input tick-by-tick, and checks the final tick/hash when the
// report carries them. Exit code 0 = reproduced (or replayed cleanly), 1 = divergence, 2 = bad input.
import fs from 'node:fs';
import { createSim, step, hashState, deserialize } from '../src/sim/sim.js';
import { endlessVerse } from '../src/sim/endless.js';
import { decodeInputs } from '../src/game/telemetry.js';

export function replayReport(r, opts = {}) {
  const def = r.endless ? endlessVerse(r.endless.seed, r.endless.depth) : r.chapter - 1;
  let sim;
  if (r.base?.state) { // the log starts at base.tick: a restored checkpoint, or a re-based long session
    sim = deserialize(Int32Array.from(r.base.state), r.endless ? def : null);
    if (r.base.tick != null && sim.tick !== r.base.tick) throw new Error(`base state is at tick ${sim.tick}, report says ${r.base.tick}`);
  } else {
    if (r.inputsFrom) throw new Error(`report starts at tick ${r.inputsFrom} with no base state; the log was truncated and cannot be replayed from the chapter start`);
    sim = createSim(def, r.seed);
  }
  const inputs = decodeInputs(r.inputs || []), until = opts.until ?? inputs.length, events = [];
  for (let i = 0; i < Math.min(until, inputs.length); i++) { step(sim, inputs[i]); if (opts.trace) for (const e of sim.events) events.push({ tick: sim.tick, type: e.type, a: e.a }); sim.events.length = 0; }
  const out = { sim, tick: sim.tick, hash: hashState(sim) >>> 0, done: sim.c.done, dead: sim.c.dead, events };
  // a report from a throwing step: after the completed ticks, apply the failing word once to reproduce the exception
  // (null = it no longer throws). Measured values above are taken first, at the replay boundary.
  if (r.failingInput != null && opts.until == null) { try { step(sim, r.failingInput); out.threw = null; } catch (e) { out.threw = String(e?.message || e); } }
  return out;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const file = process.argv[2]; if (!file) { console.error('usage: node tools/replay.mjs <report.json> [--until tick] [--trace]'); process.exit(2); }
  let r; try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('cannot read report:', e.message); process.exit(2); }
  const i = process.argv.indexOf('--until'), out = replayReport(r, { until: i > 0 ? +process.argv[i + 1] : undefined, trace: process.argv.includes('--trace') });
  console.log(JSON.stringify({ chapter: r.chapter, endless: r.endless, seed: r.seed, replayedTicks: out.tick, hash: out.hash.toString(16), done: out.done, dead: out.dead, ...('threw' in out ? { failingInputThrew: out.threw } : {}) }));
  if (out.events.length) for (const e of out.events) console.log(e.tick, e.type, e.a);
  const expectHash = r.hash ?? r.expect?.hash, expectTick = r.tick ?? r.expect?.tick;
  if (expectHash != null && (out.hash !== (typeof expectHash === 'string' ? parseInt(expectHash, 16) : expectHash) >>> 0 || (expectTick != null && out.tick !== expectTick))) { console.error(`DIVERGED: expected tick ${expectTick} hash ${Number(expectHash).toString(16)}`); process.exit(1); }
  console.log(expectHash != null ? 'REPRODUCED' : 'REPLAYED');
}
