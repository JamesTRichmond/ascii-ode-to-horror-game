// Shareable Endless seed codes: "7K2M-Q9XD-4". 40 bits (32-bit seed + 8 reserved flag bits) in Crockford base32
// (8 symbols, no I L O U), plus one mod-37 check symbol, which detects every single-symbol substitution and every
// adjacent transposition. Decoding is forgiving about case, hyphens, spaces and the look-alikes I/L -> 1, O -> 0.
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', CHECK = ALPHA + '*~$=U';

/** @returns the canonical code for a seed (int32 or uint32) and optional flags (0-255). */
export function encodeSeed(seed, flags = 0) {
  let v = BigInt(seed >>> 0) * 256n + BigInt(flags & 255), s = '';
  for (let i = 0; i < 8; i++) { s = ALPHA[Number(v & 31n)] + s; v >>= 5n; }
  return `${s.slice(0, 4)}-${s.slice(4)}-${CHECK[checkValue(s)]}`;
}

/** @returns {seed, flags} for a valid code, or throws an Error whose message is fit to show the player. */
export function decodeSeed(code) {
  const s = String(code).toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (s.length !== 9) throw new Error('A seed code has 9 symbols, like 7K2M-Q9XD-4.');
  const body = s.slice(0, 8); let v = 0n;
  for (const ch of body) { const d = ALPHA.indexOf(ch); if (d < 0) throw new Error(`"${ch}" is not used in seed codes.`); v = v * 32n + BigInt(d); }
  if (CHECK[checkValue(body)] !== s[8]) throw new Error('That code has a typo: its check symbol does not match.');
  return { seed: Number(v >> 8n) | 0, flags: Number(v & 255n) };
}

function checkValue(body) { let v = 0n; for (const ch of body) v = v * 32n + BigInt(ALPHA.indexOf(ch)); return Number(v % 37n); }
