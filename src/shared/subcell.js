// Sub-cell packing: Braille (2x4) and sextant (2x3) mask <-> codepoint maps.
// Masks are row-major: bit (y*2 + x). Guide phase 1, task 0-1.

const BRAILLE_BITS = [[0, 3], [1, 4], [2, 5], [6, 7]];

/** Row-major 8-bit mask -> Unicode Braille codepoint (U+2800 block, column-major dots). */
export function brailleCodepoint(mask) {
  let encoded = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) if (mask & (1 << (y * 2 + x))) encoded |= 1 << BRAILLE_BITS[y][x];
  return 0x2800 + encoded;
}

/** Row-major 6-bit mask -> codepoint. U+1FB00 block omits empty, left half, right half and full. */
export function sextantCodepoint(mask) {
  if (mask === 0) return 0x20;
  if (mask === 21) return 0x258c;
  if (mask === 42) return 0x2590;
  if (mask === 63) return 0x2588;
  return 0x1fb00 + mask - 1 - (mask > 21 ? 1 : 0) - (mask > 42 ? 1 : 0);
}

/** Dot centres (cell-normalised) for the procedural Braille fallback glyphs. */
export function brailleDots(mask) {
  const out = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) if (mask & (1 << (y * 2 + x))) out.push([0.28 + x * 0.44, 0.14 + y * 0.24]);
  return out;
}

/** Filled rectangles (cell-normalised [x0,y0,x1,y1]) for the procedural sextant fallback glyphs. */
export function sextantRects(mask) {
  const out = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) if (mask & (1 << (y * 2 + x))) out.push([x / 2, y / 3, (x + 1) / 2, (y + 1) / 3]);
  return out;
}
