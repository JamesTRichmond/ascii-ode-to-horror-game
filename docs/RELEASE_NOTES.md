# ODE 1.0.0 — release notes

*We are the music makers, and we are the dreamers of dreams.*

ODE is a first-person horror game in nine stanzas, after Arthur O'Shaughnessy's *Ode* (1873). The
whole world is drawn in glyphs chosen from a real 3D scene: stone in box-drawing strokes, fur and flesh
in directional punctuation, Choir light in runes, fog in Braille.

## What is in this release

- Nine chapters, one per stanza, each with its own rule: a mute shore, a city you sing up, two ages
  that breathe in and out, a hall that hears you breathing, a dark house and a carried flame, a march
  you must not break, a cloister a little apart, a dawn that unwrites, and a shore with two endings.
- Your voice is the only tool: hum to light the dark and find what you need, strike a chord to stagger
  what comes, hold your breath to pass unheard. Everything costs Breath, and everything listens.
- Runs in a desktop browser. No install, no account, no network after load.
- Accessibility: reduced motion, 100–200 % HUD text, high-contrast HUD, captions, full keyboard play,
  touch controls on coarse pointers, automatic quality.

## Requirements

A desktop browser with WebGL2 (a CPU fallback renderer exists for browsers without it). Tested on
Chromium; see `docs/TEST_REPORT.md` for what has and has not been tested.

## Known issues

- Firefox, Safari and mobile devices have not been tested.
- On machines without a GPU the game runs at roughly 20–30 fps at the lowest tier.
- Light can leak slightly around wall ends (a limitation of the 2.5D light transport).

## Verifying the download

Each release archive has a `.sha256` file. The build is reproducible: `node tools/build.mjs` on the
tagged commit produces a byte-identical archive.
