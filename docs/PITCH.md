# ODE — a horror in nine stanzas

**High-concept pitch (Phase 1 — Initiation & Concept)**

> *We are the music makers, and we are the dreamers of dreams.*
> Read it once and it is a hymn to artists. Read it as the thing being dreamed, and it is a threat.

## One line

A first-person voice-and-stealth horror game in which the world is literally written in glyphs by a
Choir that dreams ages into existence — and you are the one singer who stopped.

## Premise

Arthur O'Shaughnessy's *Ode* (1873) claims that poets build Nineveh, topple kingdoms, and announce that
"ye of the past must die". ODE takes every line literally. The Music Makers are real, ceaseless and
sorrowless. Each age of the world is one of their dreams; when they tire of it they sing the next one
over the top of it and the old one — people included — is unmade.

The poem ends on two figures the Choir cannot account for: *a dreamer who slumbers, and a singer who
sings no more*. The player is both. You wake mute on a shore under a pale moon while the ninth age is
being composed. Your voice returns one **measure** at a time. Every measure makes you more able to
survive — and more audible to the Choir, who want their missing part back.

## Sub-genre

| Axis | Decision |
|---|---|
| Sub-genre | Cosmic / folk psychological horror, stealth-survival |
| Perspective | First person, continuous 3D scene rendered as volumetric ASCII |
| Tone | Dread over gore. No blood; things are *unwritten*, not wounded |
| Session | 9 chapters, 6–12 minutes each; 60–100 minutes for a first run |
| Fail state | Being unwritten (health 0) restarts the chapter from its opening checkpoint |
| Endings | Two, chosen by action in Chapter 9: **sing** or **stay silent** |

## Core mechanics

| Mechanic | Input | What it does | Horror cost |
|---|---|---|---|
| Walk / turn | `WASD`, mouse or arrows | Grid-collided first-person movement | Footsteps are audible to listeners |
| **Hum** | hold `Space` | Emits radiance: lights surfaces and fog through the radiance cascades, reveals measures, wakes mechanisms | Drains **Breath**; attracts everything that hears |
| **Chord** | `F` / click | A short forward burst that staggers and unwrites nearby threats; leaves a decaying glyph wake | Large Breath cost, long cooldown, heard map-wide |
| Hold breath | hold `Shift` | Silent, slow movement; Breath does not regenerate | Cannot hum or strike |
| Interact | `E` | Take measures, light braziers, open the way on | — |

Two integer resources drive every decision: **Health** (how written you still are) and **Breath**
(how much voice you have). Light is not safety: it is the thing you spend to see, and the thing that
gets you found. Chapters 5 and 8 invert which side of that trade is lethal.

## Why volumetric ASCII

The fiction is that the world is text sung into shape. The renderer is the fiction: a real 3D scene
(metric depth, world normals, material IDs, transported light, fog) is resolved first, and only then
written out as glyphs whose alphabet depends on material — box-drawing strokes for stone, directional
punctuation for fur and flesh, sparse runes for Choir light. When something is unwritten, its glyphs
decay through `@ → % → * → . →` nothing. The style is specified by `nocturne-build-guide.html`
(sha256 `192ff341…925bad`, attached to the project brief) and is the non-negotiable quality bar.

## Audience

- Players of atmospheric first-person horror (stealth-first, low combat) who finish 1–2 hour games.
- Roguelike / terminal-aesthetic players who want that look with real depth and lighting.
- Runs in a desktop browser with keyboard and mouse; no install, no account, no network after load.
- Content: dread, pursuit, existential themes. No gore, no sexual content, no real-world hate imagery.

## Setting

One coastline across nine ages. The shore of Chapter 1 is the shore of Chapter 9; everything between
is the Choir's previous work, stacked like strata: a city sung up overnight, the buried pair
Nineveh and Babel, a hall where three castes are one body, a house raised by labourers who have never
seen it, a multitude marching for a dream their fathers refused, the bright place where the Choir
lives "a little apart", and the morning that ends the old.

## Pillars

1. **The character is the material.** Nothing is drawn that is not a glyph chosen from scene data.
2. **Your voice is the only tool, and it always costs.**
3. **Each chapter is its stanza.** If a mechanic cannot be justified by a line, it is cut.
4. **Deterministic underneath.** A 60 Hz integer simulation, replayable from an input log.
