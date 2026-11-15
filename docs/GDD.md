# ODE — Game Design Document

Version 1.0 (Phase 2 — Pre-Production). Source of truth for design; `docs/NARRATIVE_MAP.md` holds
the stanza map and `nocturne-build-guide.html` holds the rendering specification.

## 1. Overview

| Field | Value |
|---|---|
| Title | ODE — a horror in nine stanzas |
| Genre | First-person stealth horror with a voice mechanic |
| Platform | Desktop browser (WebGL2; CPU compositor fallback) |
| Players | 1 |
| Structure | 9 linear chapters, one per stanza of O'Shaughnessy's *Ode*; two endings |
| Play time | 60–100 minutes first run; a routed run is under 10 minutes |
| Rendering | Volumetric ASCII: G-buffer → transported light and fog → adaptive leaves → surface flow → material-aware glyph selection → temporal history → instanced MSDF output |
| Simulation | Deterministic, integer-only, fixed 60 Hz; input log replayable |

## 2. Player

| Property | Value | Notes |
|---|---|---|
| Health ("Written") | 100 | No regeneration. +20 per measure |
| Breath | 1000 | Regenerates 2/tick while breathing normally |
| Walk speed | 27 units/tick (≈ 3.2 m/s) | 1024 units = one 2 m cell |
| Held-breath speed | 13 units/tick | Silent |
| Wading speed | 16 units/tick | Shallows |
| Collision radius | 300 units (0.6 m) | Axis-separated slide against cells |
| Invulnerability after a hit | 70 ticks | |

### 2.1 Verbs

| Verb | Input | Cost | Effect | Noise radius (cells) |
|---|---|---|---|---|
| Walk | `W A S D` | — | Move | 5 |
| Stand | — | — | — | 2 |
| Hold breath | `Shift` (hold) | 1 Breath/tick, no regeneration | Slow, silent | 1 moving, 0 still |
| Hum | `Space` (hold) | 2 Breath/tick | Emits light into the radiance cascades; drives chapter rules | 11 |
| Chord | `F` / click | 320 Breath, 80-tick cooldown | Staggers threats within 3 cells in a forward arc for 150 ticks; unwrites those with health | 30 |
| Use | `E` | — | Braziers (Chapter 5) | — |

Running out of Breath while humming or holding forces a **gasp**: 110 ticks with no voice and no
held breath, and a noise of radius 12.

### 2.2 Noise

Every threat with hearing compares its distance to `noise radius × hearing factor`. Noise decays
by one cell per tick after a loud action, so a Chord is heard for about half a second after it ends.
A flood-fill distance field from the last loud position lets listeners path to *where the sound was*.

## 3. Threats

| Threat | Chapter | Speed | Contact damage | Senses | Chord |
|---|---|---|---|---|---|
| Forsaker | 1 | 11 | 14 | Hearing ×1.0; recoils from a hum within ~2 cells | 2 hits unwrite |
| The Crowned | 2 | 19 | 22 | Always knows where you are | Stagger only |
| Trampler ×3 | 2 (after last measure; spawn in the start room) | 22 (slower than walking: you outrun them) | 30 | Always knows | Stagger only |
| Sigh | 3 | 8, passes through walls | 0; drains 5 Breath/tick within 1.75 cells | — | Disperses for 15 s |
| Mirth | 3 (Babel state only) | 30, in bursts | 12 | Always knows | 1 hit unwrites |
| The Three-in-One | 4 | 24 | 34 | Hearing ×1.0 (your breathing) | Stagger only |
| Husk | 4 | 14 | 12 (only once awake) | Wakes if you breathe within 2.2 cells for ~1 s | 1 hit unwrites |
| Blind Builder | 5 | 17 | 20 | Hearing ×1.3; no sight | Stagger only |
| The Multitude | 6 | 15 (march) / 23 (turned) | 10 | Turns on a marked scorner within 4 cells | Stagger only (and marks you) |
| Chorister | 7 (Apart layer only) | 22 | 25 | Line of sight within 7 cells | Stagger only |
| The Dawn | 8 | — | 7 per 12 ticks outside shade during a surge | — | — |
| Comer | 9 | 10 | 30 | Hearing ×1.2 | Stagger only |
| The Slumberer | 9 | 0 | 0 | — | — |

AI is flood-field pathing on the cell grid plus direct steering within line of sight. All of it is
integer arithmetic with one serialised xorshift32 generator.

## 4. Chapter rules

| # | Rule | Exact behaviour |
|---|---|---|
| 1 | Mute start | Breath is 0 and cannot regenerate until the first measure is taken |
| 2 | Foundations | Humming for 50 consecutive ticks within 2 cells of a foundation stone toggles every raisable wall within 4 cells of it. Bodies inside a rising wall are ejected to the nearest free cell |
| 3 | Two ages | A global phase flips every 600 ticks (warning at 90). `a` cells are walls in phase 0, `b` cells in phase 1 |
| 4 | One breath | Husks and the Three-in-One respond to breathing; held breath is silent |
| 5 | The flame | The gate needs every brazier lit. Humming for more than 45 ticks extinguishes the carried flame; relight it at any lit brazier |
| 6 | The march | Any voice, or moving west within 2.5 cells of a marcher, marks you for 240 ticks |
| 7 | Apart | Humming for 70 consecutive ticks flips the layer. Choristers exist only Apart |
| 8 | Dawn | Calm → warning (130 ticks) → surge (170 ticks), calm shortening each cycle; after tick 11,000 the surge never ends. Shade is a roofed cell or a wall within two cells to the east |
| 9 | Finale | Hum within ~2.2 cells of the Slumberer for 300 ticks → ending 1. Reach the far gate → ending 2 |

## 5. Level format

Maps are text grids in `src/sim/chapters.js`; the legend is at the top of that file. The simulation
owns tiles and dynamic wall state. The renderer derives a height field from them every frame, so a
wall that the simulation raises is the same wall the tracer draws and the cascades occlude light with.

## 6. Rendering contract (summary of the Nocturne phases as built)

| Nocturne phase | Implementation | Module |
|---|---|---|
| 1 Typography | Offline TrueType → edge-coloured MSDF bake (DejaVu Sans Mono outlines), procedural Braille (256), sextants (64), box-drawing and runes; 6/12/24-D staggered descriptors; material dictionary bits; versioned `glyphs.bin` + manifest with hashes | `tools/bake-atlas.mjs`, `src/render/atlas.js`, `src/shared/*` |
| 2 Grid | CPU G-buffer: linear radiance, oct-encoded normal and tangent, metric depth, material, object id, pixel velocity. Budgeted quadtree 16×24 → 2×3 with prefix-scan allocation, overflow retention, split/merge hysteresis, Morton keys | `src/render/gbuffer.js`, `quadtree.js` |
| 3 Light | Plan-view directional radiance cascades (4 levels, 8→64 directions) with visibility termination and a damped bounce loop; directional light with height-field shadows; heterogeneous front-to-back Beer–Lambert fog fed by cascade fluence | `cascades.js`, `light.js` |
| 4 Shape and flow | Staggered descriptor matching per material dictionary; structure tensor → sign-aligned ETF → LIC; SVD-clamped projection Jacobian per glyph | `select.js`, `flow.js` |
| 5 Temporal | Velocity reprojection of descriptor history with object/material/depth/normal/level rejection; score-space hysteresis; object-motion stroke bias; continuous-time decay trails | `select.js`, `temporal.js` |
| 6 Output | One instanced WebGL2 draw; CPU reference compositor; dirty-run text grid; fixed-timestep loop; DOM HUD | `output_gl.js`, `output_cpu.js`, `output_2d.js`, `src/game/*` |

### 6.1 Material alphabets

| Material | Dictionary | Stroke policy |
|---|---|---|
| Stone | Box-drawing `│─┌┐└┘├┤┬┴┼═║╔╗╚╝╬╱╲` plus `#=_[]` | Surface-attached (Jacobian), orientation scored against the image tensor |
| Fur / flesh | `, ~ s w / \ c ( ) ; '` … | Rotated so the stroke axis follows ETF flow; heavy positional jitter |
| Grass / foliage | `| / \ ' , "` … | Upright with hashed lean |
| Arcane / Choir light | Runes `ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊ` and `+ * : ·` | Unwarped, sparse |
| Water, sand, wood, cloth, bone, gold, ember | Own sets | See `src/shared/materials.js` |
| Void (fog, sky) | Braille 2×4 sub-cell dither of in-scattered light | Axis-aligned |
| Distant thin silhouettes | Sextant 2×3 sub-cells, owner-masked | Axis-aligned |

Shape matching is weighted by local contrast: where a leaf has no internal structure, selection is driven by coverage, orientation and stable world-anchored variety instead of forcing the most uniform glyph everywhere.

### 6.2 Light sources

| Source | Model |
|---|---|
| Moon / sun / dawn | Directional light with plan-view height-field shadows |
| The singer's presence | Camera-attached point light (shadow-free by construction) plus a cascade emitter; brightens while humming; warm while carrying the Chapter 5 flame |
| Hum, measures, braziers, open gates, Choristers, Comers | Emitters injected into the radiance cascades (light walls, fog and bounce) |
| Inscriptions | Emissive script bands on dark stone |

## 7. HUD and accessibility

| Requirement | Design |
|---|---|
| State is never colour-only | Every meter has a text label, a number and a distinct fill pattern; every status is a labelled tag with a glyph |
| Keyboard | All menus are buttons/selects in tab order with a focus trap; `Esc`/`P` pauses; no control requires a pointer |
| Reduced motion | Follows `prefers-reduced-motion`; freezes decorative animation, removes camera bob, shockwaves and long trails |
| Text size | 100 / 125 / 150 / 200 % HUD scale |
| Contrast | High-contrast HUD option; base palette ≥ 7:1 on its panels |
| Small screens | Layout reflows to 320 px; touch controls with 48 px targets appear on coarse pointers |
| Threat visibility | A named proximity meter stays top-centre regardless of VFX; in Chapter 9 it becomes the Slumberer's waking meter |
| Captions | All audio cues that carry information have a text alert; stanza lines are captioned |

## 8. Audio direction

Fully synthesised. A drone per chapter, the player's hum as a perfect fifth (G3–D4), pentatonic
measures, footsteps, per-threat voices, stingers on alerts. Audio is presentation only and never
feeds the simulation.

## 9. Persistence

`localStorage` key `ode.save.v1`: settings, highest unlocked chapter, endings seen, best ticks per
chapter, and an optional mid-chapter checkpoint that stores the canonical integer state.

## 10. Content status

| Milestone | Content |
|---|---|
| Vertical slice (PR 2) | Chapter 1 complete |
| Alpha (PR 3a) | All nine chapters, all rules, all threats, both endings; each chapter completed by the deterministic autoplayer in CI |
