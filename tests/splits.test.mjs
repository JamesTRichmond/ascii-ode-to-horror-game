import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, formatTicks, formatDelta } from '../src/game/splits.js';
import { createSim, step } from '../src/sim/sim.js';
import { createBot, botInput } from '../src/sim/bot.js';

test('time formats from ticks', () => { assert.equal(formatTicks(0), '0:00.00'); assert.equal(formatTicks(60 * 75 + 30), '1:15.50'); assert.equal(formatDelta(-90), '−1.50'); assert.equal(formatDelta(6), '+0.10'); });
test('splits compare with the personal best and track gold splits; a slower run keeps the PB', () => {
  const a = createRun(); a.onEvent({ type: 'measure', a: 1 }, 600); a.onEvent({ type: 'measure', a: 2 }, 1500); a.onEvent({ type: 'complete' }, 2400); const ra = a.finish(2400);
  assert.ok(ra.newPb); assert.equal(ra.record.pb.length, 3); assert.equal(ra.sumOfBest, 2400);
  const b = createRun(ra.record), s1 = b.onEvent({ type: 'measure', a: 1 }, 540), s2 = b.onEvent({ type: 'measure', a: 2 }, 1560); b.onEvent({ type: 'complete' }, 2460);
  assert.equal(s1.delta, -60); assert.ok(s1.gold); assert.equal(s2.delta, 60); assert.ok(!s2.gold);
  const rb = b.finish(2460); assert.ok(!rb.newPb, 'slower exit keeps the PB'); assert.equal(rb.record.gold['Measure 1'], 540); assert.equal(rb.record.gold['Measure 2'], 900, 'a slower segment keeps the old gold'); assert.equal(rb.sumOfBest, 540 + 900 + 900, 'sum of best = best segment of each split');
  assert.equal(b.onEvent({ type: 'measure', a: 1 }, 9999), null, 'one split per objective'); assert.equal(b.onEvent({ type: 'step' }, 1), null);
});
test('a real autoplayed chapter produces ordered splits ending at the exit, at its completion tick', () => {
  const sim = createSim(2, 102), bot = createBot(), run = createRun(); let end = 0;
  while (!sim.c.done && !sim.c.dead && sim.tick < 12000) { step(sim, botInput(bot, sim)); for (const e of sim.events) run.onEvent(e, sim.tick); sim.events.length = 0; } end = sim.tick;
  assert.ok(sim.c.done); assert.deepEqual(run.splits.map(s => s.label), ['Measure 1', 'Measure 2', 'Measure 3', 'Measure 4', 'The way opens', 'Exit'].filter(l => run.splits.some(s => s.label === l)));
  assert.equal(run.splits.at(-1).label, 'Exit'); assert.equal(run.splits.at(-1).tick, end); for (let i = 1; i < run.splits.length; i++) assert.ok(run.splits[i].tick >= run.splits[i - 1].tick);
});
