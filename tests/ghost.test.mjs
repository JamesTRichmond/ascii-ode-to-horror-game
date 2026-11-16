// Ghost runs: a recorded completion replays exactly beside the player, and the renderer draws it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, step } from '../src/sim/sim.js';
import { createBot, botInput } from '../src/sim/bot.js';
import { recordGhost, startGhost, stepGhost, ghostPose } from '../src/game/ghost.js';
import { specimen } from './helpers.mjs';

const bestRun = (ch, seed) => { const sim = createSim(ch, seed), bot = createBot({ ending: 2 }), log = [], path = []; while (!sim.c.done && !sim.c.dead && sim.tick < 9000) { const w = botInput(bot, sim); log.push(w); step(sim, w); sim.events.length = 0; path.push([sim.p.x, sim.p.z]); } return { sim, log, path }; };

test('a ghost walks exactly the recorded path, tick for tick, and stops when its run ends', () => {
  const run = bestRun(0, 100); assert.ok(run.sim.c.done, 'chapter 1 completed by the autoplayer');
  const rec = JSON.parse(JSON.stringify(recordGhost(0, 100, run.log, run.sim.tick))), g = startGhost(rec, 0, 100);
  for (let t = 0; t < run.path.length; t++) { stepGhost(g); assert.deepEqual([g.sim.p.x, g.sim.p.z], run.path[t], `tick ${t + 1}`); }
  assert.ok(g.sim.c.done); assert.equal(ghostPose(g, 1, 1), null, 'a finished ghost is not drawn');
  assert.ok(rec.inputs.length < run.log.length * 2, 'stored run-length encoded');
});
test('a record only plays for its own chapter and seed', () => {
  const rec = recordGhost(2, 103, [1, 1, 1], 3); assert.equal(startGhost(rec, 2, 104), null); assert.equal(startGhost(rec, 3, 103), null); assert.ok(startGhost(rec, 2, 103));
  assert.equal(startGhost(null, 2, 103), null); assert.equal(startGhost({ chapter: 2, seed: 103, inputs: 'x' }, 2, 103), null);
});
test('the renderer draws the ghost as its own glyph figure with a faint light', async () => {
  const { renderFrame } = await import('../src/render/pipeline.js'), { viewOf } = await import('../src/game/view.js'), s = specimen('low', 1);
  s.frame(); assert.ok(!s.pl.instances.has('ghost')); const before = s.pl.sel.count;
  const v = viewOf(s.sim, s.sim, 1); v.ghost = { x: s.sim.p.x / 512 + 1.5, z: s.sim.p.z / 512 - 2, yaw: 1 }; // a few metres in front of the camera
  renderFrame(s.pl, v, 1 / 60); assert.ok(s.pl.instances.has('ghost')); assert.notEqual(s.pl.sel.count, before);
});
