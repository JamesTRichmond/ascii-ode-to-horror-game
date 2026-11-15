// Game acceptance: all nine chapters exist, map to their stanza, and can be completed start to
// finish by the deterministic autoplayer. Chapter 9 is checked for both endings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, step, hashState, TICK_HZ, packInput, IN } from '../src/sim/sim.js';
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
test('chapter 5: a guttered flame can be relit where the player began, even with every brazier unlit', () => {
  const sim = createSim(4, 104); assert.equal(sim.c.lit, 0); assert.equal(sim.p.flame, 1);
  for (let i = 0; i < 60; i++) { step(sim, packInput(IN.HUM)); sim.events.length = 0; }
  assert.equal(sim.p.flame, 0, 'humming gutters the flame'); assert.equal(sim.c.lit, 0, 'no brazier is lit to relight from');
  step(sim, packInput(IN.USE)); assert.equal(sim.p.flame, 1, 'the hearth at the start relights it'); assert.ok(sim.events.some(e => e.type === 'relight'));
});
test('both chapter 9 endings emit the completion event the presenter waits for, exactly once', () => {
  for (const ending of [1, 2]) {
    const sim = createSim(8, 108), bot = createBot({ ending }), seen = [];
    while (!sim.c.done && !sim.c.dead && sim.tick < 300 * TICK_HZ) { step(sim, botInput(bot, sim)); for (const e of sim.events) seen.push(e.type); sim.events.length = 0; }
    assert.equal(sim.c.ending, ending); assert.equal(seen.filter(t => t === 'complete').length, 1, `ending ${ending}: one 'complete'`); assert.equal(seen.filter(t => t === 'ending').length, 1);
  }
});

test('a finished chapter is frozen: further steps change neither the tick nor the state hash', () => {
  const sim = createSim(0, 7), bot = createBot({ ending: 2 });
  while (!sim.c.done && !sim.c.dead && sim.tick < 300 * TICK_HZ) step(sim, botInput(bot, sim));
  assert.ok(sim.c.done, 'chapter 1 completes');
  const tick = sim.tick, h = hashState(sim);
  for (let i = 0; i < 30; i++) step(sim, packInput({ f: 1 }));
  assert.equal(sim.tick, tick); assert.equal(hashState(sim), h);
});
