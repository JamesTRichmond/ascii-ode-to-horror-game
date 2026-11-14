# Feasibility and stack study

Phase 1 deliverable. Answers one question: can the pipeline in `nocturne-build-guide.html` run as a
real-time, playable game, and on what stack.

## Constraints taken from the brief

| Constraint | Source | Consequence |
|---|---|---|
| Volumetric, normal-aware, flow-aligned, fog-lit ASCII; never flat 2D ASCII | Brief §4 | A real 3D scene and G-buffer are mandatory; glyphs are chosen from buffers, not drawn as tiles |
| All six Nocturne phases and their acceptance fixtures | Brief §1 | Fixtures are ported to an automated suite and run in CI |
| Guide is "ENGINE-AGNOSTIC · ZERO RUNTIME DEPENDENCIES" | Guide footer | No third-party runtime libraries |
| Simulation is integer / fixed-point at 60 Hz, decoupled from render | Guide phase 6 | Authoritative state lives in a module that never touches floats, time, or the renderer |
| PR checkpoints, no pushes to `main` | Brief §3 | Stacked feature branches, one per phase |

## Stack decision

| Layer | Choice | Reason | Rejected |
|---|---|---|---|
| Language | Plain ES modules (JavaScript), no transpile step | Runs unbundled in a browser and in Node for tests; nothing to install | TypeScript (adds a build dependency), Rust/WASM (toolchain cost outweighs gain at this buffer size) |
| Platform | Desktop browser | Zero install; the guide's reference renderer is browser code | Native engine: no path to reuse the guide's reference fixtures |
| Scene resolve | CPU G-buffer at 480×270 (scalable 320×180 → 640×360) | Glyph cells are ≥ 2×3 buffer pixels, so a full-resolution G-buffer is wasted; CPU buffers are directly testable in Node | WebGL MRT + readback: readback stalls and cannot be unit-tested headlessly without a GPU |
| World geometry | Height-field grid traced per column (exact metric depth, face normals, material) + perspective-correct triangle meshes for creatures | Guide permits "SDF or mesh depth"; both paths write the same attachments | Full SDF sphere-tracing: 10–40× the cost for the same buffers |
| Glyph output | WebGL2 instanced quads sampling an MSDF atlas; Canvas2D dirty-run fallback | Guide phase 6 names exactly these two paths | DOM text: cannot rotate/warp per glyph |
| Atlas | Offline Node baker: TrueType outlines → edge-coloured MSDF + coverage descriptors + manifest; procedural Braille/sextant fallbacks | Guide phase 1: "glyphs.bin + atlas manifest"; never assume OS font coverage | Runtime canvas rasterisation only: not a versioned asset, differs per OS |
| Light transport | Plan-view directional radiance cascades over the level occupancy grid, merged through visibility, with a damped bounce loop | The world is a height-field grid, so plan-view transport is the faithful dimensionality; matches the guide's executable lab | Full 3D cascades: out of CPU budget, and the guide itself marks them as production follow-through |
| Fog | Half-resolution front-to-back Beer–Lambert march through a heterogeneous density field, in-scatter taken from cascade fluence | Guide phase 3 | Depth-only exponential fog: fails "heterogeneous" |
| Audio | WebAudio, fully synthesised | No asset pipeline, no licensing | Sample packs |
| Tests | `node --test` | Built in | Any test framework dependency |
| CI / hosting | GitHub Actions; static hosting config for GitHub Pages and Vercel | Both are existing desks | Any new service |

## Measured spike

`node tools/spike/feasibility-bench.mjs` on the build container
(Intel Xeon @ 2.10 GHz, 4 vCPU, Node v22.23.4), observed 2026-11-14:

| Workload | p50 | p95 |
|---|---|---|
| G-buffer fill, 480×270, 6,000 overlapping triangles, 5 attachments | 10.80 ms | 12.04 ms |
| Shape match, 6,000 leaves × 64 candidates × 6D | 3.79 ms | 4.01 ms |
| Shape match, 6,000 leaves × 64 candidates × 12D | 6.65 ms | 6.93 ms |
| Shape match, 6,000 leaves × 64 candidates × 24D | 12.88 ms | 13.30 ms |
| Fog, 240×135 × 16 steps | 3.26 ms | 3.39 ms |

Reference point from the guide's own embedded statistics: its CPU renderer takes 343.8 ms for the
1200×680 spider frame (11,360 triangles, 15,991 leaves). That is a still-image budget. The spike shows
the same stages fit a real-time budget once the G-buffer is sized to the glyph grid and output is
instanced.

## Frame budget: Phase 1 targets against the measured implementation

The targets below were set in Phase 1. The spike's 12.04 ms p95 G-buffer fill exceeded its own 8 ms
line because it rasterised 6,000 synthetic triangles; the shipped renderer traces the world once per
screen column and rasterises only small creature meshes. The measured columns come from
`docs/TEST_REPORT.md` (PR 5): Chapter 1, 199 frames, CPU pipeline in Node v22.23.4 on an Intel Xeon
2.10 GHz, 4 vCPU, values p50 / p95 in ms.

| Stage | Phase 1 target | Measured, high 480×270 | Measured, low 320×180 |
|---|---|---|---|
| Simulation tick (60 Hz, fixed) | ≤ 1 | under 1 (not split by tier) | under 1 |
| G-buffer: world trace + mesh raster + velocity | ≤ 8 | 2.7 / 5.1 | 1.3 / 2.1 |
| Lighting, including the full cascade solve | ≤ 5 | 12.5 / 22.2 | 6.8 / 10.3 |
| Fog march | ≤ 4 | 7.6 / 10.9 | 3.3 / 4.5 |
| Structure tensor + ETF | ≤ 4 | 8.8 / 15.3 | 3.8 / 5.6 |
| Quadtree | ≤ 6 (with selection) | 2.7 / 5.2 | 1.2 / 1.8 |
| Selection + temporal | (in the line above) | 9.0 / 17.9 | 4.1 / 6.1 |
| Instance upload + draw | ≤ 3 | 0.1–0.2 upload (browser, software GL) | same |
| **Total render** | **≤ 30** | **44.8 / 73.8 — over budget** | **20.5 / 29.0 — within budget** |

The simulation, the G-buffer and the instance upload came in under target. Lighting, fog, flow and
selection were each under-estimated by 2–2.5×, so the 30 ms total holds at the low tier and not at the high tier on
this CPU.

Cascades are not amortised. The shipped renderer re-solves all four cascade levels and one damped
bounce every frame on the main thread. That cost is part of the lighting row above and therefore of
the per-frame total: 2.8 / 4.6 ms (p50 / p95) at high, 2.7 / 3.7 ms at low, on Chapter 1. Spreading
levels across frames or moving the solve to a worker remains a possible optimisation.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CPU G-buffer too slow on low-end laptops | Medium | Frame rate | Three quality tiers by buffer size; leaf budget is a hard cap with graceful parent retention |
| MSDF baker artefacts on complex glyphs | Medium | Shimmer | Automated bake check: reconstruct coverage from the median and compare with a supersampled raster per glyph |
| Plan-view cascades leak at wall ends | Known | Light bleed | Visibility-terminated intervals; a wall-occluder fixture; documented as 2.5D, not 3D GI |
| Temporal flicker of adaptive leaves | Medium | Readability | Split/merge hysteresis with Morton identity; switch-rate metric reported at p95 |
| Nine chapters of content | High | Schedule | One data-driven chapter format; each chapter adds one rule only; a headless bot must complete every chapter in CI |
| Float nondeterminism in simulation | Low | Replay drift | Integer-only state, integer trig table, per-tick hash test |

## Honest boundaries

Carried forward from the guide's implementation ledger; these will be stated in every PR that touches them.

- Light transport is plan-view (2.5D) cascades with bounded bounces. It is not 3D multi-bounce GI.
- No neural depth, no optical-flow inference network, no differentiable font optimisation by gradient
  descent. Motion vectors come from the renderer. Offline hero-asset optimisation (guide task 3-3) is
  implemented as a deterministic discrete search and labelled as such.
- LCD sub-pixel calibration is out of scope; Braille and sextant sub-cell packing are in scope.

## Verdict

Feasible on the chosen stack with no runtime dependencies, with one qualification from the
measurements above: on a CPU of this class the 30 ms budget is met at the low tier only. The game
therefore selects its tier automatically from measured frame time (PR 5) rather than assuming high.
