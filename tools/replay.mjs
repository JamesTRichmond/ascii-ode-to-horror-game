#!/usr/bin/env node
// Deterministic replay of a crash report or a regression fixture.
// Usage: node tools/replay.mjs <report.json> [--until tick] [--trace]
// Input: { chapter (1-9, or 0 with endless), endless: {seed, depth} | null, seed, base: {tick, state} | null, inputs (RLE), inputsFrom, tick?, hash? }
// Reconstructs the chapter (from the serialized base state when the log starts mid-run), replays every input tick-by-tick, and checks the final tick/hash when the
// report carries them. Exit code 0 = reproduced (or replayed cleanly), 1 = divergence, 2 = bad input.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSim, step, hashState, deserialize } from '../src/sim/sim.js';
import { endlessVerse } from '../src/sim/endless.js';
import { decodeInputs } from '../src/game/telemetry.js';

export function replayReport(r, opts = {}) {
  if (!r || typeof r !== 'object') throw new Error('report is not an object');
  if (!r.endless && !(Number.isInteger(r.chapter) && r.chapter >= 1 && r.chapter <= 9)) throw new Error(`chapter must be 1-9 (or endless {seed, depth}), got ${r.chapter}`);
  const rle = r.inputs ?? []; if (!Array.isArray(rle) || rle.length % 2 || rle.some((v, k) => !Number.isInteger(v) || (k % 2 === 1 && v < 1))) throw new Error('inputs must be run-length pairs of integers [word, count >= 1, ...]');
  const def = r.endless ? endlessVerse(r.endless.seed, r.endless.depth) : r.chapter - 1;
  let sim;
  if (r.base?.state) { // the log starts at base.tick: a restored checkpoint, or a re-based long session
    sim = deserialize(Int32Array.from(r.base.state), r.endless ? def : null);
    if (r.base.tick != null && sim.tick !== r.base.tick) throw new Error(`base state is at tick ${sim.tick}, report says ${r.base.tick}`);
  } else {
    if (r.inputsFrom) throw new Error(`report starts at tick ${r.inputsFrom} with no base state; the log was truncated and cannot be replayed from the chapter start`);
    sim = createSim(def, r.seed);
  }
  // opts.until is an absolute tick: replay stops before stepping past it (a base state can start the log mid-run)
  const inputs = decodeInputs(r.inputs || []), events = []; let i = 0;
  for (; i < inputs.length && (opts.until == null || sim.tick < opts.until); i++) { step(sim, inputs[i]); if (opts.trace) for (const e of sim.events) events.push({ tick: sim.tick, type: e.type, a: e.a }); sim.events.length = 0; }
  const out = { sim, tick: sim.tick, hash: hashState(sim) >>> 0, done: sim.c.done, dead: sim.c.dead, events, partial: i < inputs.length };
  // a report from a throwing step: after the completed ticks, apply the failing word once to reproduce the exception
  // (null = it no longer throws). Measured values above are taken first, at the replay boundary.
  if (r.failingInput != null && !out.partial) { try { step(sim, r.failingInput); out.threw = null; } catch (e) { out.threw = String(e?.message || e); } }
  return out;
}
/** What a report expects: a fixture's expect block (the fixed run) first, then the crash's own tick/hash. Hashes are
 *  normalised once to unsigned 32-bit (numbers, or hex strings as printed by this tool). Each field is optional. */
export function expectations(r) {
  const x = r.expect || {}, h = x.hash ?? r.hash, hash = h == null ? null : (typeof h === 'string' ? parseInt(h, 16) : h) >>> 0;
  return { tick: x.tick ?? r.tick ?? null, hash, done: x.done ?? null, dead: x.dead ?? null };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) { // exact entry point, any OS
  const file = process.argv[2]; if (!file) { console.error('usage: node tools/replay.mjs <report.json> [--until tick] [--trace]'); process.exit(2); }
  let r; try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('cannot read report:', e.message); process.exit(2); }
  const i = process.argv.indexOf('--until'), until = i > 0 ? +process.argv[i + 1] : undefined;
  if (until !== undefined && !(Number.isInteger(until) && until >= 0)) { console.error('--until needs a tick number'); process.exit(2); }
  let out; try { out = replayReport(r, { until, trace: process.argv.includes('--trace') }); } catch (e) { console.error('cannot replay report:', e?.message || e); process.exit(2); } // bad input, not divergence
  console.log(JSON.stringify({ chapter: r.chapter, endless: r.endless, seed: r.seed, replayedTicks: out.tick, hash: out.hash.toString(16), done: out.done, dead: out.dead, ...('threw' in out ? { failingInputThrew: out.threw } : {}) }));
  if (out.events.length) for (const e of out.events) console.log(e.tick, e.type, e.a);
  if (out.partial) { console.log(`REPLAYED (partial: stopped at tick ${out.tick}; expectations apply to a full replay)`); process.exit(0); }
  const e = expectations(r), bad = [];
  if (e.tick != null && out.tick !== e.tick) bad.push(`tick ${out.tick}, expected ${e.tick}`);
  if (e.hash != null && out.hash !== e.hash) bad.push(`hash ${out.hash.toString(16)}, expected ${e.hash.toString(16)}`);
  for (const k of ['done', 'dead']) if (e[k] != null && out[k] !== e[k]) bad.push(`${k} ${out[k]}, expected ${e[k]}`);
  if (bad.length) { console.error('DIVERGED: ' + bad.join('; ')); process.exit(1); }
  console.log(e.tick != null || e.hash != null ? 'REPRODUCED' : 'REPLAYED');
}
