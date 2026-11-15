import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSeed, decodeSeed } from '../src/sim/seedcode.js';
import { xorshift } from '../tools/lib/xorshift-test.mjs';

test('seed codes round-trip every seed and flag value, in the canonical XXXX-XXXX-C form', () => {
  const r = xorshift(9);
  for (const seed of [0, 1, -1, 2147483647, -2147483648, 202647, ...Array.from({ length: 2000 }, () => (r() * 4294967296) | 0)])
    for (const flags of [0, 1, 255]) { const c = encodeSeed(seed, flags); assert.match(c, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z*~$=U]$/); assert.deepEqual(decodeSeed(c), { seed, flags }); }
});
test('decoding forgives case, spacing and look-alike letters', () => {
  const c = encodeSeed(123456789); assert.deepEqual(decodeSeed(c.toLowerCase().replace(/-/g, ' ')), { seed: 123456789, flags: 0 });
  const withO = encodeSeed(0); assert.equal(decodeSeed(withO.replace(/0/g, 'O')).seed, 0);
  const withL = encodeSeed(1057); assert.equal(decodeSeed(withL.replace(/1/g, 'l')).seed, 1057);
});
test('every single-symbol substitution and every adjacent transposition is rejected', t => {
  const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', r = xorshift(4); let subs = 0, swaps = 0;
  for (let n = 0; n < 200; n++) {
    const code = encodeSeed((r() * 4294967296) | 0, n % 7).replace(/-/g, '');
    for (let i = 0; i < 8; i++) {
      for (const ch of ALPHA) if (ch !== code[i]) { assert.throws(() => decodeSeed(code.slice(0, i) + ch + code.slice(i + 1)), /typo/); subs++; }
      if (i < 7 && code[i] !== code[i + 1]) { assert.throws(() => decodeSeed(code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2)), /typo/); swaps++; }
    }
  }
  t.diagnostic(`${subs} substitutions, ${swaps} transpositions rejected`);
  assert.ok(subs > 40000 && swaps > 1000);
});
test('malformed codes explain themselves', () => {
  assert.throws(() => decodeSeed('ABC'), /9 symbols/); assert.throws(() => decodeSeed('ABCU-DEFG-H'), /"U" is not used/);
});
