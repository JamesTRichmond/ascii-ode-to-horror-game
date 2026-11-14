// Game acceptance: all nine chapters exist, map to their stanza, and can be completed start to
// finish by the deterministic autoplayer. Chapter 9 is checked for both endings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, step, hashState, TICK_HZ } from '../src/sim/sim.js';
import { CHAPTERS, STANZAS, RULE } from '../src/sim/chapters.js';
import { createBot, botInput } from '../src/sim/bot.js';

export function playthrough(chapter, seed, limitSeconds = 300, ending = 2) {
  const sim = createSim(chapter, seed), bot = createBot({ ending }), log = [];
  while (!sim.c.done && !sim.c.dead && sim.tick < limitSeconds * TICK_HZ) { const w = botInput(bot, sim); log.push(w); step(sim, w); sim.events.length = 0; }
  return { sim, log };
}
test('nine chapters, one per stanza, eight lines each', () => {
  assert.equal(CHAPTERS.length, 9); assert.equal(STANZAS.length, 9);
  CHAPTERS.forEach((c, i) => { assert.equal(c.id, i + 1); assert.equal(STANZAS[i].length, 8); assert.ok(c.title && c.hint && c.map.length >= 5); });
  assert.equal(STANZAS[0][0], 'We are the music makers,'); assert.equal(STANZAS[8][7], 'And a singer who sings no more.');
  assert.deepEqual(CHAPTERS.map(c => c.rule), [RULE.MUTE_START, RULE.FOUNDATIONS, RULE.PHASE_TIMER, RULE.BREATH_HUNT, RULE.BRAZIERS, RULE.MULTITUDE, RULE.LAYERS, RULE.DAWN, RULE.FINALE], 'each chapter owns exactly one rule');
});
for (let c = 0; c < CHAPTERS.length; c++) {
  test(`chapter ${c + 1} "${CHAPTERS[c].title}" is completable and its run replays exactly`, t => {
    const { sim, log } = playthrough(c, 100 + c);
    t.diagnostic(`${sim.c.done ? 'completed' : sim.c.dead ? 'DIED' : 'TIMED OUT'} in ${(sim.tick / TICK_HZ).toFixed(1)} s, hp ${sim.p.hp}, measures ${sim.p.measures}/${CHAPTERS[c].need}, hash ${hashState(sim).toString(16)}`);
    assert.equal(sim.c.dead, 0, 'the autoplayer survives'); assert.equal(sim.c.done, 1, 'the autoplayer reaches the exit'); assert.ok(sim.p.measures >= CHAPTERS[c].need, 'the gate opened on its condition');
    const replay = createSim(c, 100 + c), mute = CHAPTERS[c].rule & RULE.MUTE_START; for (const w of log) { step(replay, w); if (mute && replay.p.measures === 0) assert.equal(replay.p.breath, 0, 'mute until the first measure'); } assert.equal(hashState(replay), hashState(sim), 'input log replays to the same state');
  });
}
test('chapter 9 has two endings: sing (1) and silence (2)', () => {
  assert.equal(playthrough(8, 108, 300, 2).sim.c.ending, 2); const sung = playthrough(8, 108, 300, 1).sim; assert.equal(sung.c.done, 1); assert.equal(sung.c.ending, 1);
});
