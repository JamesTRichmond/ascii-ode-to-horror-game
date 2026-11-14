// Pacing acceptance: the designed tension curve (docs/NARRATIVE_MAP.md "Difficulty and pacing intent")
// is checked against damage taken by a careless autoplayer, and every chapter stays completable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, step, TICK_HZ } from '../src/sim/sim.js';
import { createBot, botInput } from '../src/sim/bot.js';

function measure(c, skill, seeds = 3) {
  let dmg = 0, done = 0;
  for (let k = 1; k <= seeds; k++) { const sim = createSim(c, k * 7919), bot = createBot({ skill }); while (!sim.c.done && !sim.c.dead && sim.tick < 300 * TICK_HZ) { step(sim, botInput(bot, sim)); for (const e of sim.events) if (e.type === 'hurt') dmg += e.a; sim.events.length = 0; } if (sim.c.done) done++; }
  return { dmg: dmg / seeds, done };
}
test('tension curve: the high-pressure chapters (4, 6, 8) hurt a careless player more than the calm ones (1, 5, 9)', t => {
  const d = Array.from({ length: 9 }, (_, c) => measure(c, 0));
  t.diagnostic('careless damage per run: ' + d.map((r, i) => `${i + 1}:${r.dmg.toFixed(0)}`).join(' '));
  for (const r of d) assert.equal(r.done, 3, 'a careless player can still finish every chapter');
  const calm = Math.max(d[0].dmg, d[4].dmg, d[8].dmg); for (const hi of [3, 5, 7]) assert.ok(d[hi].dmg > calm, `chapter ${hi + 1} (${d[hi].dmg}) vs calm max ${calm}`);
  assert.ok(d[1].dmg > d[0].dmg, 'chapter 2 spikes above chapter 1');
});
