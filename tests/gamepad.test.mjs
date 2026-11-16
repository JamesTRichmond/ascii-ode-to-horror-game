import test from 'node:test';
import assert from 'node:assert/strict';
import { gamepadInput, menuIntent, deadzone, PAD, TURN_MAX } from '../src/game/gamepad.js';
import { IN } from '../src/sim/sim.js';

const pad = ({ axes = [0, 0, 0, 0], down = [] } = {}) => ({ connected: true, axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })) });

test('a resting or drifting stick is silent (radial dead zone)', () => {
  assert.deepEqual(gamepadInput(pad({ axes: [0.15, -0.12, 0.18, 0] })), { buttons: 0, turn: 0 });
  assert.deepEqual(deadzone(0.1, 0.1), [0, 0]); const [x, y] = deadzone(1, 0); assert.equal(x, 1); assert.equal(y, 0);
});
test('the left stick and D-pad walk; a diagonal sets both axes', () => {
  assert.equal(gamepadInput(pad({ axes: [0, -1] })).buttons, IN.FWD);
  assert.equal(gamepadInput(pad({ axes: [0.7, 0.7] })).buttons, IN.BACK | IN.RIGHT);
  assert.equal(gamepadInput(pad({ down: [PAD.UP, PAD.LEFT] })).buttons, IN.FWD | IN.LEFT);
  const a = gamepadInput(pad({ axes: [0, -1] })).stick; assert.equal(a[0], 0); assert.ok(a[1] < -0.99, 'the analogue left stick is carried for screen-relative heading');
  assert.equal(gamepadInput(pad({ down: [PAD.UP] })).stick, undefined, 'the D-pad alone leaves no analogue stick');
});
test('the right stick turns with a response curve and sensitivity', () => {
  const full = gamepadInput(pad({ axes: [0, 0, 1, 0] })).turn, half = gamepadInput(pad({ axes: [0, 0, 0.6, 0] })).turn, left = gamepadInput(pad({ axes: [0, 0, -1, 0] })).turn;
  assert.equal(full, TURN_MAX); assert.equal(left, -TURN_MAX); assert.ok(half > 0 && half < full * 0.5, `curve: ${half}`);
  assert.equal(gamepadInput(pad({ axes: [0, 0, 1, 0] }), 2).turn, 2 * TURN_MAX);
});
test('triggers and face buttons voice, hold breath and use', () => {
  assert.equal(gamepadInput(pad({ down: [PAD.RT] })).buttons, IN.HUM); assert.equal(gamepadInput(pad({ down: [PAD.LT] })).buttons, IN.HOLD);
  assert.equal(gamepadInput(pad({ down: [PAD.RB] })).buttons, IN.CHORD); assert.equal(gamepadInput(pad({ down: [PAD.X] })).buttons, IN.CHORD); assert.equal(gamepadInput(pad({ down: [PAD.A] })).buttons, IN.USE);
  const half = pad(); half.buttons[PAD.RT] = { pressed: false, value: 0.5 }; assert.equal(gamepadInput(half).buttons, IN.HUM, 'analog trigger past threshold');
});
test('menus respond to edges only, so a held button does not repeat', () => {
  const rest = pad(), down = pad({ down: [PAD.DOWN] }), stick = pad({ axes: [0, 0.9] }), a = pad({ down: [PAD.A] });
  assert.equal(menuIntent(down, rest), 'down'); assert.equal(menuIntent(down, down), null); assert.equal(menuIntent(stick, rest), 'down'); assert.equal(menuIntent(stick, stick), null);
  assert.equal(menuIntent(a, rest), 'activate'); assert.equal(menuIntent(pad({ down: [PAD.B] }), rest), 'back'); assert.equal(menuIntent(pad({ down: [PAD.START] }), rest), 'start');
  assert.equal(menuIntent(pad({ down: [PAD.UP] }), rest), 'up'); assert.equal(menuIntent(pad({ down: [PAD.RIGHT] }), rest), 'right'); assert.equal(menuIntent(pad({ axes: [-0.9, 0] }), rest), 'left'); assert.equal(menuIntent({ connected: false }, rest), null);
});
