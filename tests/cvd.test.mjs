import test from 'node:test';
import assert from 'node:assert/strict';
import { correction, minPairDelta, perceived, deltaE, IDENTITY, KEY_COLOURS, NEUTRALS, columnMajor, correctHex } from '../src/render/cvd.js';

test('off is the identity everywhere', () => {
  assert.deepEqual(correction('off'), [...IDENTITY]); assert.equal(correctHex('#ff6b5e', 'off'), '#ff6b5e');
  assert.deepEqual([...columnMajor([1, 2, 3, 4, 5, 6, 7, 8, 9])], [1, 4, 7, 2, 5, 8, 3, 6, 9]);
});
for (const mode of ['protan', 'deutan', 'tritan']) test(`${mode}: the worst-separated information colours become clearly more distinct`, t => {
  const before = minPairDelta(IDENTITY, mode), after = minPairDelta(correction(mode), mode);
  t.diagnostic(`${mode}: worst pair ΔE ${before.min.toFixed(1)} (${before.worst}) -> ${after.min.toFixed(1)} (${after.worst})`);
  assert.ok(after.min >= before.min * 1.3 && after.min >= 11, `${before.min} -> ${after.min}`);
  for (const [k, v] of Object.entries(NEUTRALS)) assert.ok(deltaE(perceived(v, correction(mode), mode), perceived(v, IDENTITY, mode)) <= 12 + 1e-9, `${k} stays neutral`);
  for (const [k, v] of Object.entries(KEY_COLOURS)) assert.ok(Math.abs(perceived(v, correction(mode), mode)[0] - perceived(v, IDENTITY, mode)[0]) <= 15 + 1e-9, `${k} keeps its lightness`);
});
test('correction is deterministic and cheap enough to compute at first use', () => {
  const t0 = performance.now(); const a = correction('deutan'), b = correction('deutan'); assert.deepEqual(a, b); assert.ok(performance.now() - t0 < 200);
  const hud = correctHex('#ff6b5e', 'deutan'); assert.match(hud, /^#[0-9a-f]{6}$/); assert.notEqual(hud, '#ff6b5e');
});
