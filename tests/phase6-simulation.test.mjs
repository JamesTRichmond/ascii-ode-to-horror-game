// Nocturne phase 6 acceptance — simulation, output and the loop.
// Fixture: "Replay 10,000 ticks twice and compare canonical state. Check seed divergence and
//           integer-only authoritative fields."
import test from 'node:test';
import assert from 'node:assert/strict';
import { specimen, assets } from './helpers.mjs';
import { createSim, step, serialize, deserialize, hashState, packInput, IN, TICK_HZ } from '../src/sim/sim.js';
import { isin, icos, isqrt, iatan2, xorshift, fnv1a, ANG } from '../src/sim/fixed.js';
import { consumeTicks, TICK, MAX_CATCHUP, interpolation } from '../src/game/loop.js';
import { INSTANCE_FLOATS } from '../src/render/select.js';
import { TextGrid } from '../src/render/output_2d.js';
import { compositeCPU } from '../src/render/output_cpu.js';
import { CHAPTERS } from '../src/sim/chapters.js';

const ARENA = { id: 1, title: 'Arena', rule: 0, need: 99, indoor: 0, map: ['rrrrrrrrrrrrrr', 'rggfgggggggfgr', 'rgggggrrgggggr', 'rgMgggggggMggr', 'rgggggPggggggr', 'rgfggggggrgggr', 'rggggrgggggfgr', 'rrrrrrrrrrrrrr'] };
/** A combat log: seeded pseudo-random inputs; when the player is unwritten the session restarts with the next seed. */
function session(seed, ticks, onTick) {
  let rng = seed >>> 0, sim = createSim(ARENA, seed), run = 0;
  for (let t = 0; t < ticks; t++) {
    rng = xorshift(rng); const buttons = (rng & 1 ? IN.FWD : 0) | (rng & 2 ? IN.RIGHT : 0) | ((rng >> 2) % 5 === 0 ? IN.HUM : 0) | ((rng >> 5) % 23 === 0 ? IN.CHORD : 0) | ((rng >> 10) % 11 === 0 ? IN.HOLD : 0);
    step(sim, packInput(buttons, ((rng >>> 16) % 81) - 40)); sim.events.length = 0; onTick?.(sim, t);
    if (sim.c.dead) sim = createSim(ARENA, seed + ++run);
  }
  return sim;
}
test('10,000-tick combat log replays to identical canonical state hashes at every tick', t => {
  const a = new Uint32Array(10000), b = new Uint32Array(10000); let deaths = 0;
  const simA = session(12345, 10000, (s, i) => { a[i] = hashState(s); if (s.c.dead) deaths++; }); session(12345, 10000, (s, i) => { b[i] = hashState(s); });
  for (let i = 0; i < 10000; i++) if (a[i] !== b[i]) assert.fail(`diverged at tick ${i}`);
  t.diagnostic(`final hash ${a[9999].toString(16)}, ${new Set(a).size} distinct states, ${deaths} restarts, final tick ${simA.tick}`); assert.ok(new Set(a).size > 9000, 'the log exercises changing state');
});
test('different seeds diverge', () => { assert.notEqual(hashState(session(12345, 2000)), hashState(session(54321, 2000))); });
test('authoritative state is integer-only', () => {
  const s = session(777, 3000); for (const v of serialize(s)) assert.ok(Number.isInteger(v));
  for (const obj of [s.p, s.c, ...s.ents, ...s.picks]) for (const [k, v] of Object.entries(obj)) assert.ok(Number.isInteger(v), `${k} = ${v}`);
  assert.ok(Number.isInteger(s.rng) && Number.isInteger(s.tick));
});
test('integer math: trig, sqrt and atan2 are exact-integer and well behaved', () => {
  for (let a = 0; a < ANG; a++) { const s = isin(a), c = icos(a); assert.ok(Number.isInteger(s) && Number.isInteger(c)); assert.ok(Math.abs(s / 4096 - Math.sin((a / ANG) * 2 * Math.PI)) < 0.002); assert.equal(isin(a + ANG), s); assert.equal(isin(a + 2048), s === 0 ? 0 : -s); assert.ok(!Object.is(s, -0)); }
  for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 1e6, 123456789, 2 ** 40 + 1]) { const r = isqrt(n); assert.ok(r * r <= n && (r + 1) * (r + 1) > n); }
  for (let i = 0; i < 360; i++) { const a = (i / 360) * 2 * Math.PI, got = iatan2(Math.round(Math.sin(a) * 5000), Math.round(Math.cos(a) * 5000)); let d = Math.abs(got - (i / 360) * ANG); d = Math.min(d, ANG - d); assert.ok(d < 6, `atan2 at ${i} deg off by ${d} units`); }
  assert.equal(fnv1a(Int32Array.of(1, 2, 3)), fnv1a(Int32Array.of(1, 2, 3))); assert.notEqual(fnv1a(Int32Array.of(1, 2, 3)), fnv1a(Int32Array.of(1, 2, 4)));
});
test('save/load preserves the next random draw: a restored state replays identically', () => {
  let rng = 99; const inputs = Array.from({ length: 900 }, () => { rng = xorshift(rng); return packInput((rng & 1 ? IN.FWD : 0) | (rng & 4 ? IN.LEFT : 0) | ((rng >> 4) % 7 === 0 ? IN.HUM : 0), (rng >>> 20) % 61 - 30); });
  const live = createSim(ARENA, 4242); for (let i = 0; i < 400; i++) { step(live, inputs[i]); live.events.length = 0; }
  const restored = deserialize(Int32Array.from(JSON.parse(JSON.stringify(Array.from(serialize(live))))), ARENA); assert.equal(hashState(restored), hashState(live)); assert.equal(restored.rng, live.rng);
  for (let i = 400; i < 900; i++) { step(live, inputs[i]); step(restored, inputs[i]); live.events.length = restored.events.length = 0; if (hashState(live) !== hashState(restored)) assert.fail(`restored state diverged at tick ${i}`); }
});
test('every chapter serialises and restores at tick 0 and mid-run', () => {
  for (let c = 0; c < CHAPTERS.length; c++) { const s = createSim(c, 5); assert.equal(hashState(deserialize(serialize(s))), hashState(s)); for (let i = 0; i < 200; i++) { step(s, packInput(IN.FWD | IN.TURNR)); s.events.length = 0; } assert.equal(hashState(deserialize(serialize(s))), hashState(s), CHAPTERS[c].title); }
});

test('fixed timestep is decoupled from render rate: 30, 60, 144 and irregular frame pacing simulate the same ticks', () => {
  const run = frameTimes => { const st = { acc: 0 }, sim = createSim(ARENA, 7); let n = 0; for (const dt of frameTimes) { const k = consumeTicks(st, dt); for (let i = 0; i < k; i++) { step(sim, packInput(n % 90 < 60 ? IN.FWD : IN.TURNL)); sim.events.length = 0; n++; } } return { n, hash: hashState(sim), tick: sim.tick, alpha: interpolation(st) }; };
  const secs = 10, r30 = run(Array(secs * 30).fill(1 / 30)), r60 = run(Array(secs * 60).fill(1 / 60)), r144 = run(Array(secs * 144).fill(1 / 144)), jitter = run(Array.from({ length: secs * 60 }, (_, i) => (1 / 60) * (i % 3 === 0 ? 1.6 : 0.7)));
  for (const r of [r30, r60, r144, jitter]) { assert.ok(Math.abs(r.n - secs * TICK_HZ) <= 1, `${r.n} ticks`); assert.ok(r.alpha >= 0 && r.alpha <= 1); }
  const same = createSim(ARENA, 7); for (let i = 0; i < r60.n; i++) { step(same, packInput(i % 90 < 60 ? IN.FWD : IN.TURNL)); same.events.length = 0; } assert.equal(r60.hash, hashState(same), 'state depends only on the tick-indexed input log');
  if (r30.n === r144.n) assert.equal(r30.hash, r144.hash);
});
test('catch-up is capped and the backlog policy is explicit', () => {
  const st = { acc: 0 }; assert.equal(consumeTicks(st, 1.0), MAX_CATCHUP); assert.equal(st.acc, 0, 'backlog dropped: slowdown, not a spiral'); assert.equal(consumeTicks(st, TICK * 2.5), 2); assert.ok(Math.abs(st.acc - TICK * 0.5) < 1e-12);
});
test('rendering never mutates or draws randomness from the simulation', () => {
  const s = specimen('low', 0), before = hashState(s.sim), rng = s.sim.rng; for (let f = 0; f < 5; f++) s.frame(); assert.equal(hashState(s.sim), before); assert.equal(s.sim.rng, rng);
});

test('instance stream: fixed 11-float layout, finite, within capacity, atlas-addressable', t => {
  const { pl, atlas } = specimen('high', 2), sel = pl.sel; assert.equal(INSTANCE_FLOATS, 11); assert.ok(sel.count > 3000 && sel.count * INSTANCE_FLOATS <= sel.inst.length); assert.ok(pl.qt.count <= pl.qt.capacity);
  for (let i = 0; i < sel.count; i++) { const o = i * 11, g = sel.inst[o + 6]; assert.ok(Number.isInteger(g) && g >= 0 && g < atlas.count); for (let k = 0; k < 11; k++) assert.ok(Number.isFinite(sel.inst[o + k])); assert.ok(sel.inst[o + 7] >= 0 && sel.inst[o + 10] > 0 && sel.inst[o + 10] <= 1); }
  t.diagnostic(`${sel.count} instances, ${(sel.count * 44 / 1024).toFixed(0)} KiB uploaded per frame, one draw call`);
});
test('CPU reference compositor draws the same stream (fallback path)', () => {
  const { pl, atlas } = specimen('low', 2), { atlasPx } = assets(), img = new Uint8ClampedArray(pl.w * pl.h * 4); compositeCPU(img, pl.w, pl.h, 1, pl.sel.inst, pl.sel.count, atlas, atlasPx);
  let lit = 0; for (let i = 0; i < img.length; i += 4) if (img[i] + img[i + 1] + img[i + 2] > 60) lit++; assert.ok(lit > pl.w * pl.h * 0.03, `${lit} lit pixels`);
});
test('dirty-run text fallback: unchanged frames cost nothing, one changed cell is one run, runs coalesce by colour', t => {
  const g = new TextGrid(120, 45); assert.equal(g.diff().length, 45, 'first frame draws every row once'); for (let x = 0; x < 120; x++) g.set(x, 3, 65 + (x % 26), 1, 1, 1); const first = g.diff(); assert.equal(first.length, 1, 'one coalesced run for a same-colour row'); assert.equal(first[0].text.length, 120);
  for (let x = 0; x < 120; x++) g.set(x, 3, 65 + (x % 26), 1, 1, 1); assert.equal(g.diff().length, 0, 'identical frame: no runs');
  g.set(40, 3, 35, 1, 1, 1); const one = g.diff(); assert.equal(one.length, 1); assert.equal(one[0].text, '#'); assert.equal(one[0].x, 40);
  g.set(10, 3, 35, 2, 0.1, 0.1); g.set(11, 3, 35, 2, 0.1, 0.1); g.set(12, 3, 35, 0.1, 2, 0.1); assert.equal(g.diff().length, 2, 'colour change splits a run');
  const { pl, atlas } = specimen('high', 2), grid = new TextGrid(160, 60); grid.fromInstances(pl.sel.inst, pl.sel.count, atlas, pl.w, pl.h); const full = grid.diff(true).length; grid.fromInstances(pl.sel.inst, pl.sel.count, atlas, pl.w, pl.h); const again = grid.diff().length;
  t.diagnostic(`real frame on a 160x60 grid: full redraw ${full} runs / ${grid.stats.fullCells} cells; unchanged next frame ${again} runs`); assert.equal(again, 0); assert.ok(full > 50 && full < grid.stats.fullCells);
});
