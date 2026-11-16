import test from 'node:test';
import assert from 'node:assert/strict';
import { roomAcoustics, impulseResponse, measureRT60 } from '../src/game/reverb.js';
import { createSim } from '../src/sim/sim.js';
import { CHAPTERS } from '../src/sim/chapters.js';
import { endlessVerse } from '../src/sim/endless.js';

test('Sabine on a known hall: 10 x 6 cell stone room, 3 m ceiling', () => {
  const map = ['############', ...Array.from({ length: 6 }, (_, i) => '#' + (i === 2 ? 'P' : '.') + '.........#'), '############'];
  const r = roomAcoustics(createSim({ id: 1, title: 't', rule: 0, need: 0, indoor: 1, map }, 1));
  assert.equal(r.area, 240); assert.equal(r.perimeter, 64); assert.equal(r.volume, 720);
  const expect = 0.161 * 720 / (0.08 * 64 * 3 + 0.12 * 240 + 0.08 * 240); assert.ok(Math.abs(r.rt60 - Math.min(4.5, expect)) < 0.01, `${r.rt60} vs ${expect}`);
  assert.ok(r.taps.length >= 8 && r.taps[0][0] < 0.02, 'early reflections from nearby walls');
});
test('the generated tail decays at the room RT60 (Schroeder T20 within 10%)', t => {
  for (const rt60 of [0.4, 1.2, 2.5]) { const [L] = impulseResponse({ rt60, taps: [[0.006, 0.2]] }, 24000, 3), m = measureRT60(L, 24000); t.diagnostic(`target ${rt60}s measured ${m.toFixed(3)}s`); assert.ok(Math.abs(m - rt60) / rt60 < 0.1, `${rt60}: ${m}`); }
});
test('every chapter gets plausible acoustics: indoor halls ring longer than open shores; deterministic', t => {
  const rts = CHAPTERS.map((c, i) => { const r = roomAcoustics(createSim(i, 1)); t.diagnostic(`chapter ${c.id} ${c.indoor ? 'indoor' : 'outdoor'}: RT60 ${r.rt60}s, ${r.taps.length} early taps`); return [c.indoor, r.rt60]; });
  const ind = rts.filter(r => r[0]).map(r => r[1]), out = rts.filter(r => !r[0]).map(r => r[1]);
  assert.ok(Math.min(...ind) > Math.max(...out), `indoor ${ind} vs outdoor ${out}`);
  const a = impulseResponse(roomAcoustics(createSim(2, 1)), 22050, 9), b = impulseResponse(roomAcoustics(createSim(2, 1)), 22050, 9); assert.deepEqual(a[0].slice(0, 2000), b[0].slice(0, 2000));
  assert.ok(roomAcoustics(createSim(endlessVerse(7, 2), 1)).rt60 > 0.25);
});
