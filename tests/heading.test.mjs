// Screen-relative movement under the dimetric camera: the shell turns W/A/S/D and the stick into the simulation's
// facing-relative word (turn toward the screen direction, then FWD). The simulation never learns about the camera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenInput, wrapTurn } from '../src/game/heading.js';
import { DIMETRIC } from '../src/render/camera.js';
import { createSim, step, hashState, packInput, IN } from '../src/sim/sim.js';

const YAW = DIMETRIC.yaw, A = 4096 / (Math.PI * 2), toAng = rad => Math.round(rad * A) & 4095;
// The camera's right vector is (-sin yaw, cos yaw) = yaw + 90° (see camera.js), so screen right is yaw + π/2.
const up = toAng(YAW), right = toAng(YAW + Math.PI / 2), down = toAng(YAW + Math.PI), left = toAng(YAW - Math.PI / 2);

test('screen up/down/left/right become the camera-frame headings, emitted as turn + FWD', () => {
  for (const [bits, want] of [[IN.FWD, up], [IN.BACK, down], [IN.LEFT, left], [IN.RIGHT, right], [IN.FWD | IN.RIGHT, toAng(YAW + Math.PI / 4)], [IN.BACK | IN.LEFT, toAng(YAW - Math.PI * 3 / 4)]]) {
    const r = screenInput(bits | IN.HUM, null, 0, YAW);
    assert.equal(r.buttons, IN.FWD | IN.HUM, 'strafes are folded into the heading; other bits pass through');
    assert.equal((0 + r.turn) & 4095, want, `heading for bits ${bits}`);
  }
  assert.equal(screenInput(IN.FWD | IN.BACK, null, 0, YAW).turn, 0, 'opposite keys cancel'); assert.equal(screenInput(IN.FWD | IN.BACK, null, 0, YAW).buttons, 0);
});

test('idle input leaves the facing alone and keeps the mouse or stick turn; turn keys still turn in place', () => {
  assert.deepEqual(screenInput(IN.HUM | IN.TURNR, null, 1234, YAW, 17), { buttons: IN.HUM | IN.TURNR, turn: 17 });
  assert.deepEqual(screenInput(0, [0, 0], 1234, YAW), { buttons: 0, turn: 0 });
  assert.equal(screenInput(IN.FWD | IN.TURNR, null, 0, YAW).buttons, IN.FWD, 'while walking the heading owns the facing');
});

test('the turn is the shortest way round and never exceeds the input word range', () => {
  assert.equal(screenInput(IN.FWD, null, up, YAW).turn, 0, 'already facing the way: no turn');
  assert.equal(screenInput(IN.FWD, null, (up + 100) & 4095, YAW).turn, -100); assert.equal(screenInput(IN.FWD, null, (up - 100) & 4095, YAW).turn, 100);
  assert.equal(wrapTurn(0, 2048), 2047, 'a half turn clamps to the word'); assert.equal(wrapTurn(0, 2049), -2047); assert.equal(wrapTurn(10, 4000), -106);
  assert.equal(packInput(IN.FWD, screenInput(IN.FWD, null, down, YAW).turn), packInput(IN.FWD, 2047), 'a reversal packs without overflow');
});

test('the left stick gives an analogue heading, taking precedence over the digital bits', () => {
  const r = screenInput(IN.LEFT, [0.5, -0.5], 0, YAW); // stick up-right while a key says left
  assert.equal(r.buttons, IN.FWD); assert.equal(r.turn & 4095, toAng(YAW + Math.PI / 4));
  const s = screenInput(0, [0, 0.3], 0, YAW); assert.equal(s.turn & 4095, down, 'a small deflection still names a direction (the dead zone was applied upstream)');
});

test('a run played with screen-relative input is a plain input log: it replays headless to the same hash', () => {
  const words = [], live = createSim(0, 7), seq = [IN.FWD, IN.FWD, IN.RIGHT, IN.RIGHT | IN.FWD, IN.BACK, 0, 0, IN.LEFT | IN.HUM, IN.LEFT, IN.FWD];
  for (let t = 0; t < 120; t++) { const bits = seq[Math.floor(t / 12) % seq.length], r = screenInput(bits, null, live.p.ang, YAW); const w = packInput(r.buttons, r.turn); words.push(w); step(live, w); }
  assert.notEqual(live.p.x + live.p.z, createSim(0, 7).p.x + createSim(0, 7).p.z, 'the singer moved');
  const facingUp = toAng(YAW); assert.ok(Math.abs(((live.p.ang - facingUp + 2048) & 4095) - 2048) <= 1, 'after walking screen-up the facing is the camera forward');
  const replay = createSim(0, 7); for (const w of words) step(replay, w);
  assert.equal(hashState(replay), hashState(live), 'the same words, fed headless, reach the same state');
});
