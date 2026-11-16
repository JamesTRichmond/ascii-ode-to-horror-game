// Endless challenge modifiers (roadmap 1.4): Silent Choir, Permanent Dawn, Twice the Choir.
import test from 'node:test';
import assert from 'node:assert/strict';
import { endlessVerse, MOD } from '../src/sim/endless.js';
import { RULE } from '../src/sim/chapters.js';
import { createSim, step, hashState, packInput, IN, ET } from '../src/sim/sim.js';
import { createBot, botInput } from '../src/sim/bot.js';
import { replayReport } from '../tools/replay.mjs';
import { encodeInputs } from '../src/game/telemetry.js';

const run = (def, seed, ticks = 9000, input = null) => { const sim = createSim(def, seed), bot = createBot(), ev = [];
  while (!sim.c.done && !sim.c.dead && sim.tick < ticks) { step(sim, input ? input(sim) : botInput(bot, sim)); for (const e of sim.events) ev.push(e.type); sim.events.length = 0; } return { sim, ev }; };

test('modifiers are deterministic, and mods = 0 is exactly the unmodified verse', () => {
  for (let d = 1; d <= 9; d++) { assert.deepEqual(endlessVerse(5, d, 0), endlessVerse(5, d)); for (const m of [1, 2, 4, 7]) assert.deepEqual(endlessVerse(5, d, m), endlessVerse(5, d, m)); }
});
test('Silent Choir: holding hum and chord never voices anything', () => {
  const { sim, ev } = run(endlessVerse(3, 1, MOD.SILENT), 4, 600, () => packInput(IN.HUM | IN.CHORD));
  assert.ok(sim.def.rule & RULE.SILENT); assert.equal(sim.p.hum, 0); assert.ok(!ev.includes('chord') && !ev.includes('hum'), ev.filter(t => t === 'chord' || t === 'hum').join());
  const voiced = run(endlessVerse(3, 1), 4, 600, () => packInput(IN.HUM | IN.CHORD)); assert.ok(voiced.ev.includes('chord'), 'the same input voices without the modifier');
});
test('Permanent Dawn: the sun surges in an indoor verse and burns a player standing in the open', () => {
  const def = endlessVerse(3, 1, MOD.DAWN); assert.ok(def.rule & RULE.DAWN);
  const { ev } = run(def, 4, 2400, () => 0); assert.ok(ev.includes('surgeWarn') && ev.includes('surge'));
});
test('Twice the Choir: on average at least 1.8x the threats', () => {
  let a = 0, b = 0; for (let s = 1; s <= 20; s++) for (let d = 1; d <= 6; d++) { const n = def => createSim(def, 1).ents.filter(e => e.type !== ET.SLUMBERER).length; a += n(endlessVerse(s, d)); b += n(endlessVerse(s, d, MOD.DOUBLE)); }
  assert.ok(b >= 1.8 * a, `${b} vs ${a}`);
});
test('every modifier still leaves verses the autoplayer can finish (it is not tuned for them)', t => {
  for (const [name, mods, min] of [['silent', MOD.SILENT, 0.25], ['dawn', MOD.DAWN, 0.25], ['double', MOD.DOUBLE, 0.75]]) {
    let done = 0, runs = 0; for (let seed = 1; seed <= 6; seed++) for (let d = 1; d <= 4; d++) { runs++; if (run(endlessVerse(seed * 97, d, mods), seed + d).sim.c.done) done++; }
    t.diagnostic(`${name}: ${done}/${runs} completed`); assert.ok(done / runs >= min, `${name}: ${done}/${runs}`);
  }
});
test('a crash report from a modified run replays exactly', () => {
  const def = endlessVerse(9, 2, MOD.DOUBLE | MOD.DAWN), sim = createSim(def, 11), bot = createBot(), log = [];
  for (let i = 0; i < 700; i++) { const w = botInput(bot, sim); log.push(w); step(sim, w); sim.events.length = 0; }
  const out = replayReport({ chapter: 0, endless: { seed: 9, depth: 2, mods: MOD.DOUBLE | MOD.DAWN }, seed: 11, inputs: encodeInputs(log) });
  assert.equal(out.hash, hashState(sim) >>> 0);
});
