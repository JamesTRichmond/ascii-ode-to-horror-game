import test from 'node:test';
import assert from 'node:assert/strict';
import { bearing, direction, captionFor, heartbeatCaption, createCaptionStack } from '../src/game/soundcaptions.js';
import { createSim, ET } from '../src/sim/sim.js';

// Player facing ang = 0 looks along +x; the sim's strafe-right vector is (-sin, cos), i.e. +z.
const P = (ang = 0) => ({ x: 10240, z: 10240, ang });
test('bearings follow the simulation frame: ahead, right, behind, left', () => {
  const p = P(0), dir = (x, z) => direction(bearing(p, x, z).deg).word;
  assert.equal(dir(15360, 10240), 'ahead'); assert.equal(dir(10240, 15360), 'right'); assert.equal(dir(5120, 10240), 'behind'); assert.equal(dir(10240, 5120), 'left');
  assert.equal(dir(15360, 15360), 'ahead right'); assert.equal(direction(bearing(P(1024), 10240, 15360).deg).word, 'ahead', 'turning 90° right puts +z ahead');
});
test('events become captions with direction and distance; global sounds have none', () => {
  const p = P(0), c = captionFor({ type: 'alert', a: ET.FORSAKER, x: 10240 - 3 * 1024, z: 10240 }, p);
  assert.equal(c.text, 'A Forsaker shrieks — behind, near'); assert.equal(c.arrow, '↓');
  assert.equal(captionFor({ type: 'surgeWarn', x: 0, z: 0 }, p).text, 'A rising cry: shelter now'); assert.equal(captionFor({ type: 'step', x: 0, z: 0 }, p), null);
  assert.match(captionFor({ type: 'wall', x: 10240 + 12 * 1024, z: 10240 }, p).text, /ahead, far$/);
});
test('the heartbeat caption follows the same threat rules and names the nearest threat', () => {
  const sim = createSim(0, 1); sim.ents = [{ type: ET.FORSAKER, x: sim.p.x + 1500, z: sim.p.z, mode: 1 }]; sim.p.ang = 0;
  assert.match(heartbeatCaption(sim).text, /^Your heart pounds — A Forsaker ahead$/);
  sim.ents[0].x = sim.p.x + 9000; assert.equal(heartbeatCaption(sim), null, 'calm when the threat is far');
  sim.ents = [{ type: ET.SLUMBERER, x: sim.p.x + 500, z: sim.p.z, mode: 0 }]; assert.equal(heartbeatCaption(sim), null, 'the Slumberer never raises the heartbeat');
});
test('the caption stack merges repeats, keeps the newest three, and expires', () => {
  const s = createCaptionStack(3, 1); s.push({ text: 'a', arrow: '↑', key: 'a' }); s.push({ text: 'a', arrow: '→', key: 'a' });
  assert.deepEqual(s.lines(), ['→ [a] ×2']); for (const k of 'bcd') s.push({ text: k, arrow: '•', key: k });
  assert.deepEqual(s.lines(), ['• [d]', '• [c]', '• [b]']); s.tick(1.1); assert.deepEqual(s.lines(), []);
});
