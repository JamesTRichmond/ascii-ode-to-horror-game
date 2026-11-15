// Live-ops acceptance: telemetry privacy, crash reports that replay, Endless Choir hook, hotfix tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './helpers.mjs';
import { createTelemetry, encodeInputs, decodeInputs } from '../src/game/telemetry.js';
import { endlessVerse, weeklySeed } from '../src/sim/endless.js';
import { createSim, step, hashState, serialize, deserialize, TICK_HZ, TILE, solidAt, flood } from '../src/sim/sim.js';
import { createBot, botInput } from '../src/sim/bot.js';
import { replayReport } from '../tools/replay.mjs';

globalThis.addEventListener ||= () => {};
const sent = [], sender = (url, body) => { sent.push({ url, body }); return true; };
test('telemetry is off by default and never sends without an endpoint', () => {
  sent.length = 0;
  const off = createTelemetry({ version: 't', send: sender }); off.track('x'); assert.equal(sent.length, 0); assert.equal(off.events.length, 1, 'recorded locally for the player to inspect');
  const noEndpoint = createTelemetry({ version: 't', enabled: true, send: sender }); noEndpoint.track('x'); assert.equal(sent.length, 0);
  const on = createTelemetry({ version: 't', enabled: true, endpoint: '/api/t', send: sender }); on.track('chapter_start', { chapter: 2 }); assert.equal(sent.length, 1); assert.equal(on.sent, 1);
  const e = JSON.parse(sent[0].body); assert.deepEqual(Object.keys(e).sort(), ['chapter', 'schema', 'session', 't', 'type', 'version']);
});
test('crash report: replay context, stripped URLs, no personal fields; and it replays exactly', () => {
  const sim = createSim(0, 100), bot = createBot(), log = []; for (let i = 0; i < 900; i++) { const w = botInput(bot, sim); log.push(w); step(sim, w); sim.events.length = 0; }
  const T = createTelemetry({ version: '9.9.9', getState: () => ({ chapter: 1, endless: null, seed: 100, tick: sim.tick, hash: hashState(sim) >>> 0, log, tier: 'low' }) });
  const err = new Error('boom'); err.stack = 'Error: boom\n    at f (https://example.test/src/render/select.js:10:5)';
  const r = T.crash(err, 'frame');
  assert.equal(r.message, 'boom'); assert.ok(!/https?:/.test(r.stack), 'origins stripped'); assert.equal(r.inputsFrom, 0);
  for (const k of ['user', 'userId', 'email', 'ip', 'name', 'device']) assert.ok(!(k in r), k);
  const out = replayReport(JSON.parse(JSON.stringify(r))); assert.equal(out.tick, 900); assert.equal(out.hash, r.hash);
  assert.deepEqual(decodeInputs(encodeInputs(log)), log); assert.ok(encodeInputs(log).length < log.length * 2);
});
test('Endless Choir: deterministic, always well-formed, and the early verses are completable', t => {
  assert.deepEqual(endlessVerse(42, 3), endlessVerse(42, 3)); assert.notDeepEqual(endlessVerse(42, 3).map, endlessVerse(43, 3).map);
  for (let seed = 1; seed <= 20; seed++) for (let depth = 1; depth <= 12; depth++) {
    const def = endlessVerse(seed, depth), sim = createSim(def, seed), f = new Int16Array(sim.w * sim.h); flood(sim, f, sim.p.x >> 10, sim.p.z >> 10);
    assert.equal(def.map.join('').split('P').length, 2, 'one start'); assert.equal(def.map.join('').split('X').length, 2, 'one exit');
    for (const m of sim.picks) assert.ok(f[(m.z >> 10) * sim.w + (m.x >> 10)] < 32767, `measure reachable s${seed} d${depth}`);
    let gateOk = false; for (let i = 0; i < sim.tiles.length; i++) if (sim.tiles[i] === TILE.GATE) for (const d of [1, -1, sim.w, -sim.w]) if (f[i + d] < 32767) gateOk = true; assert.ok(gateOk, `exit reachable s${seed} d${depth}`);
    for (let i = 0; i < sim.tiles.length; i++) if (sim.tiles[i] === TILE.BRAZ) assert.ok([1, -1, sim.w, -sim.w].some(d => f[i + d] < 32767), 'brazier reachable');
    assert.equal(hashState(deserialize(serialize(sim), def)), hashState(sim));
  }
  const times = [];
  for (let seed = 1; seed <= 3; seed++) for (let depth = 1; depth <= 5; depth++) { const sim = createSim(endlessVerse(seed, depth), seed + depth), bot = createBot(); while (!sim.c.done && !sim.c.dead && sim.tick < 240 * TICK_HZ) { step(sim, botInput(bot, sim)); sim.events.length = 0; } assert.equal(sim.c.done, 1, `verse s${seed} d${depth}`); times.push((sim.tick / TICK_HZ).toFixed(0)); }
  t.diagnostic(`verse completion times (s): ${times.join(' ')}`);
  assert.equal(weeklySeed(new Date(Date.UTC(2026, 10, 14))), 202646); assert.equal(weeklySeed(new Date(Date.UTC(2027, 0, 1))), 202653);
});
test('hotfix tool bumps every version site and opens a changelog entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ode-hotfix-')); fs.mkdirSync(path.join(dir, 'src/game'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' })); fs.writeFileSync(path.join(dir, 'src/game/main.js'), "export const VERSION = '1.0.0';\n"); fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n');
  execFileSync(process.execPath, [path.join(root, 'tools/hotfix.mjs'), 'patch', 'Fix the thing'], { env: { ...process.env, HOTFIX_ROOT: dir } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '1.0.1'); assert.match(fs.readFileSync(path.join(dir, 'src/game/main.js'), 'utf8'), /'1\.0\.1'/); assert.match(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), /## 1\.0\.1[\s\S]*Fix the thing/);
  fs.rmSync(dir, { recursive: true });
});

test('perf telemetry separates CPU work time from the interval between frames', () => {
  const T = createTelemetry({ version: 't' }), cpu = Array.from({ length: 100 }, (_, i) => 10 + (i % 10)), intervals = Array.from({ length: 100 }, (_, i) => (i < 90 ? 16.7 : 50));
  T.perf('medium', cpu, intervals); const e = T.events.at(-1);
  assert.deepEqual([e.cpuP50, e.cpuP95, e.intervalP50, e.intervalP95], [15, 19, 16.7, 50], 'a frame that waits on the display shows only in the interval');
  T.perf('medium', cpu, []); assert.ok(!('intervalP95' in T.events.at(-1)), 'no interval figures from too few samples');
});

test('endless verses never produce campaign death or chapter_complete events', () => {
  const T = createTelemetry({ version: 't' }), sim = createSim(endlessVerse(7, 2), 9);
  T.event({ type: 'death' }, sim); T.event({ type: 'complete' }, sim); assert.equal(T.events.length, 0);
  T.event({ type: 'death' }, createSim(0, 1)); assert.equal(T.events.at(-1).type, 'death');
});

test('crash report from a restored or re-based run carries its base state and replays from it exactly', () => {
  for (const [def, endless] of [[3, null], [endlessVerse(7, 2), { seed: 7, depth: 2 }]]) {
    const sim = createSim(def, 104), bot = createBot();
    for (let i = 0; i < 400; i++) { step(sim, botInput(bot, sim)); sim.events.length = 0; }
    const base = { tick: sim.tick, state: Array.from(serialize(sim)) }, log = []; // what the shell records at restore / re-base
    for (let i = 0; i < 500 && !sim.c.done && !sim.c.dead; i++) { const w = botInput(bot, sim); log.push(w); step(sim, w); sim.events.length = 0; }
    const T = createTelemetry({ version: 't', getState: () => ({ chapter: endless ? 0 : 4, endless, seed: 104, tick: sim.tick, hash: hashState(sim) >>> 0, log, base }) });
    const r = JSON.parse(JSON.stringify(T.crash(new Error('late'))));
    assert.equal(r.inputsFrom, 0); assert.equal(r.base.tick, 400);
    const out = replayReport(r); assert.equal(out.tick, r.tick); assert.equal(out.hash, r.hash, endless ? 'endless' : 'campaign');
    assert.throws(() => replayReport({ ...r, base: null, inputsFrom: 400 }), /no base state/, 'a truncated log without a base is rejected');
  }
});
