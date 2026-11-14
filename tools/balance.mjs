#!/usr/bin/env node
// Pacing and difficulty report: runs the deterministic autoplayer at two skill levels over N seeds
// per chapter and tabulates survival, time, damage taken, alerts and hits.
// Usage: node tools/balance.mjs [seeds=12] [--json]
import { createSim, step, TICK_HZ } from '../src/sim/sim.js';
import { createBot, botInput } from '../src/sim/bot.js';
import { CHAPTERS } from '../src/sim/chapters.js';

const seeds = +(process.argv[2] || 12), json = process.argv.includes('--json'), rows = [];
for (let c = 0; c < CHAPTERS.length; c++) for (const skill of [1, 0]) {
  let done = 0, died = 0, time = 0, dmg = 0, alerts = 0, hits = 0, gasps = 0;
  for (let k = 1; k <= seeds; k++) {
    const sim = createSim(c, k * 7919), bot = createBot({ skill });
    while (!sim.c.done && !sim.c.dead && sim.tick < 300 * TICK_HZ) { step(sim, botInput(bot, sim)); for (const e of sim.events) { if (e.type === 'alert') alerts++; if (e.type === 'hurt') { hits++; dmg += e.a; } if (e.type === 'gasp') gasps++; } sim.events.length = 0; }
    if (sim.c.done) { done++; time += sim.tick / TICK_HZ; } else if (sim.c.dead) died++;
  }
  rows.push({ chapter: c + 1, title: CHAPTERS[c].title, skill: skill ? 'careful' : 'careless', completed: `${done}/${seeds}`, died, meanTime: done ? +(time / done).toFixed(1) : null, damagePerRun: +(dmg / seeds).toFixed(1), hitsPerRun: +(hits / seeds).toFixed(1), alertsPerRun: +(alerts / seeds).toFixed(1), gaspsPerRun: +(gasps / seeds).toFixed(1) });
}
if (json) console.log(JSON.stringify(rows, null, 1));
else { console.log('| Ch | Title | Player | Completed | Died | Mean time (s) | Damage/run | Hits/run | Alerts/run | Gasps/run |\n|---|---|---|---|---|---|---|---|---|---|'); for (const r of rows) console.log(`| ${r.chapter} | ${r.title} | ${r.skill} | ${r.completed} | ${r.died} | ${r.meanTime ?? '—'} | ${r.damagePerRun} | ${r.hitsPerRun} | ${r.alertsPerRun} | ${r.gaspsPerRun} |`); }
