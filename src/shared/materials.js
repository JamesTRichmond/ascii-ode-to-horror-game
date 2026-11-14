// Material table and material-aware glyph dictionaries (guide phase 1, task 0-2).
// Material IDs are written to the G-buffer; dictionary bits are baked into each glyph record.

export const DICT = {
  GENERIC: 1 << 0, STONE: 1 << 1, ORGANIC: 1 << 2, FOLIAGE: 1 << 3, ARCANE: 1 << 4, WATER: 1 << 5,
  SAND: 1 << 6, WOOD: 1 << 7, FOG: 1 << 8, BRAILLE: 1 << 9, SEXTANT: 1 << 10, EMBER: 1 << 11,
  CLOTH: 1 << 12, PALE: 1 << 13, METAL: 1 << 14,
};

/** Characters per dictionary. Order is irrelevant; membership is what is baked. */
export const DICT_CHARS = {
  GENERIC: " .,:;-=+*!|/\\()[]{}<>ivxcronsetaukhdbqpygmwVXCOSEAUKHDBQPGMW#%&@$0123456789?^_'\"~`zjflTYLIJNRFZ",
  STONE: '│─┌┐└┘├┤┬┴┼═║╔╗╚╝╬╱╲#=_[]|-+LTHEFI:.',
  ORGANIC: ",~sw/\\c();'`vuyrjt{}!i^\"-.:",
  FOLIAGE: "|/\\',\"`!ilvyY^.:;",
  ARCANE: 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊ+*:·°†‡x',
  WATER: '~-_=≈.:·,',
  SAND: ".,:·'`;°",
  WOOD: '|│║!Il1[]/\\=-:.#',
  FOG: '.·:°\'`,',
  EMBER: '•*+°·:.@%░▒▓',
  CLOTH: '|/\\()lIi!{}[];:.,vV',
  PALE: '.,:;-~=+ocsaeuon0O%#@()',
  METAL: '+*#=≈◊^vVMWX%@|-/\\<>',
};

// id, name, dictionary bits, linear albedo, emissive (linear radiance), split importance,
// selection weights: shape, orientation; glyph scale; tangent policy.
const M = (id, name, dict, albedo, emissive, importance, o = {}) => ({
  id, name, dict, albedo, emissive, importance,
  wShape: o.wShape ?? 1, wOrient: o.wOrient ?? 0.25, jitter: o.jitter ?? 0.06, scale: o.scale ?? 1.1,
  warp: o.warp ?? 1, cover: o.cover ?? 1,
});

export const MATERIALS = [
  M(0, 'void', DICT.FOG | DICT.BRAILLE, [0, 0, 0], [0, 0, 0], 0.45, { wShape: 0.2, cover: 0.5 }),
  M(1, 'fur', DICT.ORGANIC, [0.83, 0.79, 0.73], [0, 0, 0], 1.0, { wShape: 0.35, wOrient: 0.9, jitter: 0.55, scale: 1.28 }),
  M(2, 'stone', DICT.STONE, [0.51, 0.53, 0.54], [0, 0, 0], 0.55, { wShape: 1.0, wOrient: 0.35 }),
  M(3, 'pale', DICT.PALE | DICT.ORGANIC, [0.85, 0.83, 0.74], [0, 0, 0], 1.0, { wShape: 0.8, wOrient: 0.5, jitter: 0.2 }),
  M(4, 'cloth', DICT.CLOTH, [0.8, 0.075, 0.08], [0, 0, 0], 0.9, { wShape: 0.6, wOrient: 0.8, jitter: 0.2 }),
  M(5, 'ember', DICT.EMBER, [1, 0.3, 0.1], [1.7, 0.1, 0.03], 1.0, { wShape: 0.2, wOrient: 0, warp: 0 }),
  M(6, 'arcane', DICT.ARCANE, [0.6, 1, 1], [0.4, 1.2, 1.4], 1.0, { wShape: 0.3, wOrient: 0, warp: 0, jitter: 0.4 }),
  M(7, 'grass', DICT.FOLIAGE, [0.19, 0.42, 0.34], [0, 0, 0], 0.2, { wShape: 0.3, wOrient: 0.7, jitter: 0.6, scale: 1.2 }),
  M(8, 'water', DICT.WATER, [0.08, 0.2, 0.26], [0, 0, 0], 0.2, { wShape: 0.4, wOrient: 0.8, jitter: 0.25 }),
  M(9, 'sand', DICT.SAND, [0.55, 0.5, 0.4], [0, 0, 0], 0.15, { wShape: 0.5, wOrient: 0.1, jitter: 0.45, cover: 0.7 }),
  M(10, 'wood', DICT.WOOD, [0.36, 0.25, 0.16], [0, 0, 0], 0.5, { wShape: 0.8, wOrient: 0.7 }),
  M(11, 'bone', DICT.PALE, [0.9, 0.88, 0.8], [0, 0, 0], 0.9, { wShape: 0.9, wOrient: 0.3 }),
  M(12, 'gold', DICT.METAL, [0.95, 0.72, 0.25], [0.25, 0.17, 0.03], 1.0, { wShape: 0.7, wOrient: 0.3 }),
  M(13, 'inscription', DICT.ARCANE, [0.7, 0.9, 0.85], [0.12, 0.3, 0.3], 0.8, { wShape: 0.2, wOrient: 0, jitter: 0.02 }),
  M(14, 'glory', DICT.ARCANE | DICT.EMBER, [1, 0.95, 0.8], [1.5, 1.3, 0.8], 1.0, { wShape: 0.3, wOrient: 0.4, jitter: 0.3 }),
  M(15, 'flame', DICT.EMBER, [1, 0.6, 0.2], [2.4, 1.1, 0.25], 1.0, { wShape: 0.2, wOrient: 0.3, warp: 0, jitter: 0.5 }),
];
export const MAT = Object.fromEntries(MATERIALS.map(m => [m.name.toUpperCase(), m.id]));

/** Dictionary bitmask a codepoint belongs to (used by the baker). */
export function dictMaskFor(char) {
  let mask = 0;
  for (const [name, chars] of Object.entries(DICT_CHARS)) if (Array.from(chars).includes(char)) mask |= DICT[name];
  return mask;
}
