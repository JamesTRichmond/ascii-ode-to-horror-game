#!/usr/bin/env node
// ODE in a terminal: the real simulation and the full glyph pipeline, drawn with 24-bit ANSI colour.
// Usage: node tools/terminal.mjs [--chapter 1] [--quality low] [--cols N] [--rows N] [--autoplay]
//        node tools/terminal.mjs --frames 30 --dump frame.ans   (render N frames headless, write the last as ANSI)
// Keys: W A S D walk · ← → or Q R turn · Space hum · F chord · H hold breath · E use · Esc or Ctrl-C quit
import fs from 'node:fs';
import { assets } from '../tests/helpers.mjs';
import { createPipeline, setScene, renderFrame } from '../src/render/pipeline.js';
import { TextGrid } from '../src/render/output_2d.js';
import { createSim, step, IN, packInput, TICK_HZ, TUNE } from '../src/sim/sim.js';
import { CHAPTERS } from '../src/sim/chapters.js';
import { createBot, botInput } from '../src/sim/bot.js';
import { viewOf, snapshot } from '../src/game/view.js';
import { enter, leave, runsToAnsi, createKeyState, ESC } from '../src/term/ansi.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; }, flag = k => process.argv.includes('--' + k);
const chapter = Math.max(1, Math.min(CHAPTERS.length, +arg('chapter', 1))) - 1, quality = arg('quality', 'low'), frames = +arg('frames', 0), dump = arg('dump', null);
const cols = +arg('cols', process.stdout.columns || 120), rows = +arg('rows', (process.stdout.rows || 40) - 2);
const { atlas, noise } = assets(), pl = createPipeline(atlas, noise, quality), sim = createSim(chapter, 1000 + chapter), bot = flag('autoplay') || frames ? createBot({ ending: 2 }) : null;
const grid = new TextGrid(cols, rows), keys = createKeyState(IN); let prev = snapshot(sim), alert = '', alertT = 0, turnAcc = 0;
setScene(pl, sim);

function hud() {
  const p = sim.p, def = sim.def, need = def.need ? ` · ◆ ${p.measures}/${def.need}` : '';
  const line = ` ODE · ${def.id}. ${def.title} · ♥ ${p.hp}/${TUNE.hpMax} · ≋ ${Math.round(p.breath / 10)}%${need}${sim.c.done ? ' · THE WAY IS WRITTEN' : sim.c.dead ? ' · UNWRITTEN' : ''}${alert ? ' · ' + alert : ''}`;
  return `${ESC}1;1H${ESC}38;2;233;196;106m${ESC}2K${[...line].slice(0, cols).join('')}`;
}
function frame(dt, full) {
  const view = viewOf(prev, sim, 1); renderFrame(pl, view, dt);
  grid.fromInstances(pl.sel.inst, pl.sel.count, atlas, pl.w, pl.h, true);
  return hud() + runsToAnsi(grid.diff(full), 1);
}
function tick(now) {
  prev = snapshot(sim);
  for (let k = 0; k < 2; k++) { // 60 Hz simulation, 30 Hz terminal frames
    const word = bot ? botInput(bot, sim) : packInput(keys.buttons(now), 0); step(sim, word);
    for (const e of sim.events) if (['alert', 'measure', 'gate', 'hurt', 'death', 'complete', 'surge', 'phase'].includes(e.type)) { alert = e.type.toUpperCase(); alertT = 1.6; }
    sim.events.length = 0;
  }
  if ((alertT -= 1 / 30) <= 0) alert = '';
}

if (frames) { // headless: render N frames and dump the final full frame
  let last = ''; for (let f = 0; f < frames; f++) { tick(f * 33); last = frame(1 / 30, true); }
  const out = enter() + last + leave(); if (dump) fs.writeFileSync(dump, out); else process.stdout.write(out);
  console.error(`terminal: ${cols}x${rows} cells, ${pl.sel.count} glyphs, tick ${sim.tick}`); process.exit(0);
}
if (!process.stdin.isTTY) { console.error('terminal: needs an interactive terminal (or use --frames N --dump file)'); process.exit(2); }
const quit = code => { clearInterval(loop); process.stdout.write(leave()); process.stdin.setRawMode(false); process.exit(code); };
process.stdout.write(enter()); process.stdin.setRawMode(true); process.stdin.setEncoding('utf8');
process.stdin.on('data', s => { if (s === '\x03' || s === '\x1b') quit(0); for (const k of s.match(/\x1b\[[A-D]|[\s\S]/g) || []) keys.press(k, Date.now()); });
process.on('SIGINT', () => quit(130)); process.stdout.on('resize', () => process.stdout.write(`${ESC}2J`));
let first = true; const loop = setInterval(() => { tick(Date.now()); process.stdout.write(frame(1 / 30, first)); first = false; }, 1000 / 30);
