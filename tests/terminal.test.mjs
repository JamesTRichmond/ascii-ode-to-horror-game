// Terminal renderer: TextGrid runs -> ANSI, key handling for raw terminals, and the headless player end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, specimen } from './helpers.mjs';
import { TextGrid } from '../src/render/output_2d.js';
import { runsToAnsi, visible, createKeyState } from '../src/term/ansi.js';
import { IN } from '../src/sim/sim.js';

test('a full frame paints every cell once; an unchanged frame writes nothing; one change is one small run', () => {
  const { pl, atlas } = specimen('low', 2), g = new TextGrid(80, 24); g.fromInstances(pl.sel.inst, pl.sel.count, atlas, pl.w, pl.h, true);
  const full = runsToAnsi(g.diff(true)); assert.equal([...visible(full)].length, 80 * 24); assert.match(full, /\x1b\[38;2;\d+;\d+;\d+m/);
  g.fromInstances(pl.sel.inst, pl.sel.count, atlas, pl.w, pl.h, true); assert.equal(runsToAnsi(g.diff()), '');
  g.set(10, 5, 0x2591, 1, 0.2, 0.1); const one = runsToAnsi(g.diff(), 1); assert.equal(visible(one), '░'); assert.match(one, /^\x1b\[7;11H/, 'row offset for the HUD line');
});
test('box-drawing glyphs are kept for terminals and replaced only for canvas text', () => {
  const { pl, atlas } = specimen('low', 2), a = new TextGrid(120, 40), b = new TextGrid(120, 40);
  a.fromInstances(pl.sel.inst, pl.sel.count, atlas, pl.w, pl.h, true); b.fromInstances(pl.sel.inst, pl.sel.count, atlas, pl.w, pl.h);
  const box = t => [...t.ch].filter(c => c >= 0x2500 && c < 0x2580).length; assert.equal(box(b), 0); assert.ok(box(a) >= 0);
});
test('raw terminals report presses, never releases: a press holds its button briefly, repeats keep it', () => {
  const k = createKeyState(IN, 180); k.press('w', 0); k.press('\x1b[D', 0); assert.equal(k.buttons(100), IN.FWD | IN.TURNL); assert.equal(k.buttons(200), 0);
  k.press('W', 300); assert.equal(k.buttons(400), IN.FWD, 'shifted letters map too'); assert.equal(k.press('z', 0), false);
});
test('the headless player renders a real chapter to an ANSI file', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ode-term-')), 'frame.ans');
  execFileSync(process.execPath, [path.join(root, 'tools/terminal.mjs'), '--chapter', '3', '--frames', '6', '--cols', '64', '--rows', '20', '--dump', file], { stdio: 'pipe' });
  const s = fs.readFileSync(file, 'utf8'); assert.match(s, /^\x1b\[\?1049h/); assert.match(s, /\x1b\[\?1049l$/); assert.match(visible(s), /ODE · 3\. Nineveh and Babel · ♥ 100\/100/);
  assert.ok([...visible(s)].length >= 64 * 20);
});
