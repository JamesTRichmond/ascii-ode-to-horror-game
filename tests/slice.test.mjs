// Vertical-slice acceptance (Phase 2): Chapter 1 is completable by the deterministic autoplayer,
// and its input log replays to the same canonical state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, step, hashState, serialize, TICK_HZ } from '../src/sim/sim.js';
import { CHAPTERS, STANZAS } from '../src/sim/chapters.js';
import { createBot, botInput } from '../src/sim/bot.js';

test('chapter 1 is built from stanza 1 and is completable; the run replays exactly', t => {
  assert.equal(CHAPTERS[0].title, 'Lone Sea-Breakers'); assert.equal(STANZAS[0][2], 'Wandering by lone sea-breakers,');
  const sim = createSim(0, 100), bot = createBot(), log = []; let voicedAt = -1;
  while (!sim.c.done && !sim.c.dead && sim.tick < 240 * TICK_HZ) { const w = botInput(bot, sim); log.push(w); step(sim, w); sim.events.length = 0; if (voicedAt < 0 && sim.p.breath > 0) voicedAt = sim.tick; }
  t.diagnostic(`completed in ${(sim.tick / TICK_HZ).toFixed(1)} s, hp ${sim.p.hp}, measures ${sim.p.measures}/3, first voice at tick ${voicedAt}, hash ${hashState(sim).toString(16)}`);
  assert.equal(sim.c.done, 1); assert.equal(sim.p.measures, 3); assert.ok(voicedAt > 0, 'mute until the first measure');
  const replay = createSim(0, 100); for (const w of log) step(replay, w); assert.equal(hashState(replay), hashState(sim));
  for (const v of serialize(sim)) assert.ok(Number.isInteger(v));
});
