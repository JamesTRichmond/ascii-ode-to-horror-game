// Live-ops report: synthetic sessions through the real telemetry module and simulation, then aggregation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetry } from '../src/game/telemetry.js';
import { createSim, step, packInput, IN } from '../src/sim/sim.js';
import { createBot, botInput } from '../src/sim/bot.js';
import { parseEvents, aggregate, heatmap, renderReport } from '../tools/lib/telemetry-report.mjs';

globalThis.addEventListener ||= () => {};
function sessions() { // 6 sessions: chapter 4 attempts that die (random wandering) and completions of chapter 1 by the autoplayer
  const all = [];
  for (let s = 0; s < 6; s++) {
    const T = createTelemetry({ version: 't' }); T.track('session_start', { tier: 'medium' });
    T.track('chapter_start', { chapter: 1 }); const a = createSim(0, 100 + s), bot = createBot();
    while (!a.c.done && a.tick < 9000) { step(a, botInput(bot, a)); for (const e of a.events) T.event(e, a); a.events.length = 0; }
    T.track('chapter_start', { chapter: 4 }); const b = createSim(3, 200 + s); let r = 7 + s;
    while (!b.c.dead && !b.c.done && b.tick < 6000) { r = (r * 1103515245 + 12345) >>> 0; step(b, packInput(IN.FWD | (r & 1 ? IN.TURNL : 0) | (r & 16 ? IN.HUM : 0))); for (const e of b.events) T.event(e, b); b.events.length = 0; }
    T.perf('medium', Array(40).fill(20)); if (s === 2) T.crash(new Error('boom'), 'frame');
    all.push(T.report());
  }
  return all;
}
test('reports, JSON arrays and JSON Lines all parse to the same events', () => {
  const reps = sessions().slice(0, 2), ev = parseEvents(JSON.stringify(reps));
  assert.equal(parseEvents(reps.map(r => JSON.stringify(r)).join('\n')).length, ev.length); assert.equal(parseEvents(JSON.stringify(ev)).length, ev.length);
  assert.equal(parseEvents(ev.map(e => JSON.stringify(e)).join('\n') + '\nnot json\n').length, ev.length, 'bad lines are skipped');
});
test('the funnel, deaths with map cells, perf and crashes aggregate correctly', () => {
  const agg = aggregate(parseEvents(JSON.stringify(sessions())));
  assert.equal(agg.sessions, 6); const c1 = agg.funnel[0], c4 = agg.funnel[3];
  assert.equal(c1.starts, 6); assert.equal(c1.completes, 6); assert.equal(c1.completionRate, 1); assert.ok(c1.medianSeconds > 0);
  assert.equal(c4.starts, 6); assert.ok(c4.deaths >= 1 && c4.completes === 0, `chapter 4 deaths ${c4.deaths}`);
  assert.equal(Object.values(agg.heat[4]).reduce((a, b) => a + b, 0), c4.deaths, 'every death has a map cell');
  assert.equal(agg.perf.medium.reports, 6); assert.deepEqual(agg.crashes, [{ message: 'boom', count: 1 }]);
});
test('the heatmap is the chapter map with deaths drawn in the density ramp', () => {
  const map = heatmap(1, { '5,3': 1, '6,3': 4 }).split('\n'); assert.equal(map[3][6], '@'); assert.ok('.:-=+*#%'.includes(map[3][5])); assert.ok(map[0].includes('░') || map[0].includes('·'));
  const text = renderReport(aggregate(parseEvents(JSON.stringify(sessions())))); assert.match(text, /Chapter funnel/); assert.match(text, /Deaths — chapter 4/); assert.match(text, /holds 30 fps|BELOW 30 fps|p95/);
});
