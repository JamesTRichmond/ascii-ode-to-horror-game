# Test report — Release Candidate 1 (v1.0.0-rc.1)

Date: 2026-11-14. Every number below was produced by the commands shown, on the build container:
Intel Xeon @ 2.10 GHz, 4 vCPU, Node v22.23.4, headless Chromium 153.0.8010.12 with SwiftShader
(software) WebGL2. No physical GPU was available, so GPU timings are software-rasteriser timings.

## 1. Nocturne acceptance fixtures

Command: `npm test` → **76 tests, 76 pass, 0 fail.**

| Guide phase | Guide fixture | Result | Test file |
|---|---|---|---|
| 01 Typography | Exhaustively validate Braille bit order | Pass — 256 masks bijective, dot 1 = U+2801, dot 4 = U+2808, dot 7 = U+2840, full = U+28FF | `phase1-typography` |
| | 64 sextant masks + shipped fallbacks | Pass — 64 distinct codepoints; all 256 + 63 procedural glyphs in the atlas | |
| | Median-distance robustness | Pass — median(.2, .7, .71) = .7 | |
| | Same slanted stroke at three scales (4×8, 6×12, 16×32) | Pass — coverage 0.1189 / 0.1021 / 0.0949, slope −0.747 / −0.774 / −0.777 | |
| | No atlas bleeding, no clipped ascenders, 1×/2× silhouette | Pass — 0 border texels inked; IoU > 0.85 | |
| | Material dictionaries without boundary leakage | Pass — 0 cross-dictionary glyphs in the specimen scene | |
| 02 Grid | Leaf rectangles partition the viewport exactly | Pass — synthetic and real scene, every pixel covered once | `phase2-grid` |
| | Foreground and background get different leaf sizes | Pass — 2×3 subject leaves, 4×6+ ground; 8343 leaves [0, 0, 4419, 3924] | |
| | Exhausted budget degrades gracefully | Pass — capacity 1500, overflow recorded, partition exact | |
| | No split/merge flicker | Pass — 0.024 % of nodes flip per frame still, 1.61 % while turning | |
| | Metric depth, HDR radiance, reprojection | Pass — 7.000 m wall, analytic floor, 97 %+ reprojection hits | |
| 03 Light | Homogeneous slab = exp(−σd) at 10/100/1000 steps | Pass — error < 1e-12 | `phase3-light` |
| | Renderer fog within 1 %, step halving stable, no negative density | Pass — step halving changes in-scatter 0.06 % | |
| | Wall occluder | Pass — walled fluence 14.5 % of open at the shadow probe (bilinear merge leak, documented) | |
| | Bounded multi-bounce, colour bleed, energy | Pass — residual 1.000 → 0.264 → 0.086 → 0.030; red stays red | |
| 04 Shape & flow | Vertical edge → vertical tangent; antiparallel align; isotropic → 0 | Pass | `phase4-shape` |
| | 6/12/24-D benchmark | Self-match 0.966 / 0.978 / 0.989; 2.56 / 2.08 / 2.91 µs per leaf | |
| | Thin legs connected; no 180° seams; vs Sobel-only | Pass — 0 seams; roughness 7.52e-4 → 7.38e-4 | |
| | Jacobian clamp, bounded glyph size | Pass — axis ratio 0.46–3.11 | |
| | Offline optimisation: discrete vs relaxed, deterministic | Pass — coverage RMS 0.0538 → 0.0150, identical replay hash | |
| 05 Temporal | 1 s decay at 30 vs 120 Hz | Pass — identical to 1e-12 | `phase5-temporal` |
| | .01 does not cross .025; .10 does | Pass | |
| | Static scenes stabilise | Pass — p95 glyph change 0.96 % with history, 1.67 % without | |
| | Camera motion switch rate | Pass — p50 5.8 %, p95 8.9 % (gate < 20 %) | |
| | Disocclusion rejection (ghost duration) | Pass — 10 → 65 rejections in the frame a creature jumps; 0 frames of ghosting | |
| | Reduced motion removes shockwaves and trails | Pass | |
| 06 Simulation | 10,000-tick replay, per-tick hashes | Pass — final `a23c71b`, 10,000 distinct states | `phase6-simulation` |
| | Seed divergence; integer-only state | Pass | |
| | Save/load preserves the next random draw | Pass — 500 post-restore ticks identical | |
| | Render rate decoupled (30/60/144/jittered) | Pass | |
| | Instanced output; dirty-run fallback | Pass — 7420 instances, 319 KiB/frame, one draw; unchanged frame 0 runs | |

## 2. Game acceptance

| Check | Result | Test |
|---|---|---|
| Nine chapters, one stanza each, one rule each | Pass | `chapters` |
| Every chapter completed by the careful autoplayer, run replays exactly | Pass — times 41.1 / 63.0 / 80.0 / 48.8 / 27.7 / 26.3 / 41.0 / 57.3 / 13.0 s | `chapters` |
| Both endings reachable | Pass | `chapters` |
| Pacing curve | Pass — careless-player damage per run 28 / 66 / 24 / 94 / 7 / 120 / 58 / 98 / 20 | `balance` |
| Auto quality policy | Pass — steps down on one slow window, up after two fast ones, no dead-band oscillation | `quality` |

### Difficulty and pacing (command: `node tools/balance.mjs 8`)

| Ch | Intended tension | Careful: completed / damage | Careless: completed / damage | Careless time (s) |
|---|---|---|---|---|
| 1 | low, rising | 8/8 · 0 | 8/8 · 22.8 | 40.9 |
| 2 | medium, spike | 8/8 · 0 | 8/8 · 66 | 63.0 |
| 3 | medium | 8/8 · 0 | 8/8 · 24 | 80.0 |
| 4 | high | 8/8 · 34 | 8/8 · 94 | 33.9 |
| 5 | medium, release | 8/8 · 0 | 8/8 · 5 | 27.5 |
| 6 | high, sustained | 8/8 · 0 | 8/8 · 120 (healed by measures) | 26.3 |
| 7 | medium | 8/8 · 3.1 | 8/8 · 53.1 | 40.8 |
| 8 | very high | 8/8 · 0 | 8/8 · 98 (finishes at 2 HP) | 38.6 |
| 9 | low | 8/8 · 0 | 8/8 · 20 | 13.0 |

The autoplayer navigates perfectly, so absolute times are lower bounds for human players.

## 3. Performance

CPU pipeline, Node, 199 frames per run (`render p50 / p95` in ms):

| Tier | Resolution | Ch 1 total | Ch 6 total (densest) |
|---|---|---|---|
| low | 320×180 | 20.5 / 29.0 | 26.6 / 41.4 |
| medium | 400×225 | 29.7 / 45.7 | 41.5 / 78.0 |
| high | 480×270 | 44.8 / 73.8 | 57.8 / 104.3 |

Stage split at high, Ch 1: G-buffer 2.7, light 12.5, fog 7.6, quadtree 2.7, flow 8.8, selection 9.0, cascades 2.8 (p50 ms).

Optimisations this phase: tabulated contrast curve shared by bake and runtime; candidate scoring with
cheap terms first and shape early-out; precomputed glyph orientation harmonics; normals decoded once
per frame (selection 18.7 → 13.7 ms p50 on Ch 4 high). Automatic quality selects the tier at run time.

Browser (`node tools/browser-check.mjs --seconds 10`, auto quality, software GL): all nine chapters in
play mode with **0 console errors**, frame p50 34.4–51.3 ms, p95 88.7–125.6 ms (includes start-up
frames). Glyph switch p95 in play 16.9–29.8 %.

Budget status against the guide's targets (60 Hz simulation 16.67 ms/tick: met, sim < 1 ms; 120 Hz
presentation 8.33 ms/frame: **not met** on this hardware). Hardware with a real GPU has not been measured.

## 4. Compatibility

| Platform | Status |
|---|---|
| Chromium 153 (headless, Linux, SwiftShader) | Tested: chapters, UI flow, HUD layouts |
| WebGL2 unavailable | CPU compositor fallback path exists and is unit-tested (`phase6-simulation`), not browser-tested |
| Firefox, Safari / WebKit | **Not tested** — no binaries in the build environment |
| Physical GPUs, mobile devices | **Not tested** |
| Viewports | 1280×720 at 100 % and 200 % text; 320×640 — no overlap, no horizontal scroll |
