import test from 'node:test';
import assert from 'node:assert/strict';
import { relativePosition, occlusion, occlusionFilter } from '../src/game/spatial.js';

const grid = rows => { const h = rows.length, w = rows[0].length, tiles = new Uint8Array(w * h); rows.forEach((r, z) => [...r].forEach((c, x) => { tiles[z * w + x] = c.charCodeAt(0); })); return { w, h, tiles, dyn: new Uint8Array(w * h) }; };
const at = (cx, cz) => [cx * 1024 + 512, cz * 1024 + 512];

test('listener-relative positions: ahead is -Z, the simulation right is +X, 1 cell = 2 m', () => {
  const L = { x: 0, z: 0, yaw: 0 };
  assert.deepEqual(Object.values(relativePosition(L, 2048, 0)).map(v => +v.toFixed(6) + 0), [0, 0, -4]);
  assert.deepEqual(Object.values(relativePosition(L, 0, 1024)).map(v => +v.toFixed(6) + 0), [2, 0, 0]);
  const turned = relativePosition({ x: 0, z: 0, yaw: Math.PI / 2 }, 0, 1024); assert.ok(Math.abs(turned.z + 2) < 1e-9 && Math.abs(turned.x) < 1e-9, 'after a right turn, +z is ahead');
});
test('occlusion counts the solid cells the line of sound crosses', () => {
  const s = grid(['..........', '....#.....', '....#..#..', '..........']);
  assert.equal(occlusion(s, ...at(1, 2), ...at(8, 2)), 2, 'two walls on row 2');
  assert.equal(occlusion(s, ...at(1, 3), ...at(8, 3)), 0, 'clear row');
  assert.equal(occlusion(s, ...at(1, 0), ...at(8, 0)), 0); assert.equal(occlusion(s, ...at(4, 0), ...at(4, 3)), 2, 'vertical through two wall cells');
  assert.equal(occlusion(s, ...at(2, 1), ...at(6, 1)), 1);
});
test('a diagonal never slips between two diagonal walls, and the end cells are ignored', () => {
  const s = grid(['....', '.#..', '..#.', '....']);
  assert.ok(occlusion(s, ...at(0, 0), ...at(3, 3)) >= 1);
  const t = grid(['#..#']); assert.equal(occlusion(t, ...at(0, 0), ...at(3, 0)), 0, 'source and listener cells do not count');
});
test('occlusion muffles highs before volume and saturates', () => {
  const f = [0, 1, 2, 3, 9].map(occlusionFilter); assert.deepEqual(f.map(x => x.freq), [20000, 900, 450, 260, 260]);
  for (let i = 1; i < f.length; i++) assert.ok(f[i].gain <= f[i - 1].gain);
});
