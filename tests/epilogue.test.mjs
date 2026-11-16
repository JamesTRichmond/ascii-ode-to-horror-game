// Epilogue (roadmap 1.3): deterministic, voiceless, completable, replayable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { epilogueDef, EPILOGUE, EPILOGUE_OPENING, EPILOGUE_CLOSING } from '../src/sim/epilogue.js';
import { createSim, step, hashState, packInput, IN, ET } from '../src/sim/sim.js';
import { createBot, botInput } from '../src/sim/bot.js';
import { replayReport } from '../tools/replay.mjs';
import { encodeInputs } from '../src/game/telemetry.js';
import { createTelemetry } from '../src/game/telemetry.js';

test('the epilogue is a fixed, stanza-less verse: Chapter 9 theme, no measures, three husks and the Three-in-One', () => {
  const a = epilogueDef(), b = epilogueDef(); assert.deepEqual(a, b); assert.equal(a.id, 9); assert.ok(a.epilogue); assert.equal(a.need, 0);
  const tiles = a.map.join(''); assert.ok(!tiles.includes('M')); const sim = createSim(a, EPILOGUE.simSeed);
  assert.equal(sim.ents.filter(e => e.type === ET.HUSK).length, 3); assert.equal(sim.ents.filter(e => e.type === ET.TRIUNE).length, 1);
  assert.equal(EPILOGUE_OPENING.length, 4); assert.ok(EPILOGUE_CLOSING.every(t => t.length > 40));
});
test('the singer has no voice: hum and chord do nothing for the whole epilogue', () => {
  const sim = createSim(epilogueDef(), EPILOGUE.simSeed), seen = new Set();
  for (let t = 0; t < 600 && !sim.c.dead; t++) { step(sim, packInput(IN.HUM | IN.CHORD)); assert.equal(sim.p.hum, 0); for (const e of sim.events) seen.add(e.type); sim.events.length = 0; }
  assert.ok(!seen.has('chord'));
});
test('the autoplayer can walk it to the shore, and a crash report from it replays exactly', () => {
  const sim = createSim(epilogueDef(), EPILOGUE.simSeed), bot = createBot(), log = [];
  while (!sim.c.done && !sim.c.dead && sim.tick < 9000) { const w = botInput(bot, sim); log.push(w); step(sim, w); sim.events.length = 0; }
  assert.ok(sim.c.done, `done at ${sim.tick}`);
  const out = replayReport({ chapter: 0, epilogue: true, seed: EPILOGUE.simSeed, inputs: encodeInputs(log) }); assert.equal(out.hash, hashState(sim) >>> 0); assert.equal(out.tick, sim.tick);
});
test('epilogue deaths are not counted as Chapter 9 deaths in telemetry', () => {
  const T = createTelemetry({ version: 't' }); T.event({ type: 'death' }, createSim(epilogueDef(), 1)); assert.equal(T.events.length, 0);
});
