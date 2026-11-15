// Epilogue (roadmap 1.3): "A Singer Who Sings No More". A tenth, stanza-less chapter after ending 2 (silence): the
// Endless generator with a fixed seed (1873, the year of the Ode) and verse 11 (the Breath verse kind with three
// husks and the Three-in-One), dressed in the Chapter 9 theme. The singer has no voice at all (MUTE_START with no
// measures to restore it); the only way out is stealth: hold your breath when they turn toward you, and walk.
import { endlessVerse } from './endless.js';
import { RULE } from './chapters.js';

export const EPILOGUE = { seed: 1873, depth: 11, simSeed: 1873 };
export const EPILOGUE_TITLE = 'A Singer Who Sings No More';
export const EPILOGUE_OPENING = ['No measure answers you now.', 'The shore is quiet where the singing was.', 'Walk softly. Breathe less.', 'They are listening for a voice you no longer have.'];
export const EPILOGUE_CLOSING = [
  'You reach the water and nothing follows. Behind you the husks lean toward a silence they have no name for.',
  'The world they are renewing was never yours to sing. You stand where the dreamers stood, and the tide writes over your footprints, one by one, until nothing remains to say you passed.',
  'Somewhere far off a new choir is learning its first measure. It does not know your face. That is the last gift of a singer who sings no more.',
];

/** The epilogue as a chapter definition for createSim(); deterministic. */
export function epilogueDef() {
  const v = endlessVerse(EPILOGUE.seed, EPILOGUE.depth);
  return { id: 9, title: EPILOGUE_TITLE, rule: RULE.BREATH_HUNT | RULE.MUTE_START, need: 0, indoor: 1, dark: 0, epilogue: true, startAng: 0,
    hint: 'You have no voice now. Hold your breath (Shift) when they turn toward you, and walk to the shore.', map: v.map.map(r => r.replace(/M/g, '.')) };
}
