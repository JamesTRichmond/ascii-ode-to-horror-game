# Changelog

## Unreleased

### Changed
- **Camera: top-down dimetric view by default** (#44). An orthographic camera at 45° azimuth with 2:1 tile edges
  follows the singer, who is now a visible figure in the scene; the lantern light, hum and flame emitters and voice
  bursts come from the singer. Ceilings are not drawn from above; walls near the singer along the view are cut away
  (`occlusionMode`). Movement is screen-relative (W/A/S/D and the left stick name a screen direction; the shell emits
  the same facing-relative input words, so saves, replays and ghost runs are unchanged). The listener and the caption
  arrows are oriented to the screen.
- **Settings → Camera** keeps the original first-person view as a live-switchable option (mouse-look, pointer lock,
  facing-relative movement, facing-relative audio). Photo mode keeps the free perspective camera in both modes.
- The renderer's camera is now an interface (`src/render/camera.js`: `project`, `unproject`, `ray`, `pixelScale`,
  `forward`) with a perspective and a dimetric implementation; the first-person output is byte-identical.

### Added
- Nine dimetric visual goldens next to the nine first-person ones; camera and screen-relative input unit tests;
  the browser check runs every chapter in both modes and measures the singer on screen.

### Follow-ups
- Store key art and screenshots still show the first-person view.

## 1.1.0-rc.1 — Phase 6 (Post-launch & live operations)

### Added
- **Endless Choir** expansion: deterministic verse generator, weekly seed, best-depth record, menu entry.
- Opt-in, first-party telemetry (off by default; `telemetry.json` ships without an endpoint).
- Crash capture with an in-game report overlay; reports carry the RLE input log and replay exactly.
- `tools/replay.mjs`, `tools/record-fixture.mjs`, `tools/hotfix.mjs`; regression fixtures under `tests/regressions/`.
- `docs/LIVE_OPS.md`: telemetry schema, crash flow, hotfix pipeline, maintenance, roadmap.

### Fixed
- Missing `telemetry.json`, `version.json` (dev) and favicon produced console 404s.

## 1.0.0-rc.2 — Phase 5 (Launch & Release)

### Added
- `tools/build.mjs`: reproducible production build with import/asset resolution gate, `version.json` file hashes and a release archive.
- CI workflow (tests, build, atlas reproducibility); tag/manual-only release workflow (draft GitHub release, optional Pages deploy); `vercel.json` with security headers and auto-deploy of `main` disabled.
- In-game update notice from `version.json`.
- Dev server sends the production headers (CSP) so local play matches deployment.
- Release notes, store copy, engine-rendered key art and screenshots, deploy guide, launch checklist.

## Review fixes (PR 3, Copilot) — carried into 1.0.0-rc.1

### Fixed
- Chapter 5 softlock: guttering the flame before lighting any brazier left no way to relight it. The start cell is now a hearth.
- The sung ending (ending 1) was never shown or saved: the simulation now emits the completion event for it.
- Chapter 8: drawn shade now matches the shelter rule exactly (101 cells looked safe but were not).
- Chapters 8 and 9 keep their instructions on screen instead of "The way is open".
- Pale surfaces no longer draw organic glyphs; unlit inscription bands render as stone.
- Tests: signed seam count with an oriented fixture, limb-edge coverage, Chapter 1 mute-start assertions, hearth and ending regression tests.

### Corrected claims
- Guide task 3-3 (offline differentiable optimisation) is implemented in `src/render/heroopt.js` with `tools/optimize-hero.mjs`; `optimize.js` remains a runtime relaxation diagnostic.

## 1.0.0-rc.1 — Phase 4 (Testing & Polish)

### Added
- Automatic quality: frame-time p95 drives the render tier (low / medium / high) with hysteresis; default setting.
- `tools/balance.mjs`: pacing and difficulty report at two player-skill profiles.
- `tests/balance.test.mjs`: the designed tension curve is enforced in CI.
- `tests/quality.test.mjs`: auto-quality policy.
- `docs/TEST_REPORT.md`: fixture results, pacing, benchmarks, compatibility.

### Changed
- Performance: shared tabulated contrast curve; early-out candidate scoring; precomputed glyph orientation; normals decoded once per frame.
- Balance: Comers deal 20 (was 30).

## 0.4.0 — Phase 3b (Content complete)

### Added
- Synthesised audio: chapter beds, hum, heartbeat, spatial threat voices, stingers.
- Mist over water and dust indoors; damage vignette; resonance bearing; `tools/browser-check.mjs`.

### Fixed
- `Esc` paused and resumed on the same keypress.
- HUD panels overlapped and meter bars collapsed at 200 % text.
- Glyph churn under camera motion (switch p95 50.7 % → 8.9 %): variety identity now follows the tracked surface.

## 0.3.0 — Phase 3a (Alpha)

### Added
- Chapters 2–9, both endings, all threat types; Nocturne phases 4–6 fixtures.

### Fixed
- Chapter 4 exit was unreachable (gap in the wrong column).
- Chapter 2 Tramplers spawned between the player and the gate and outran the player.
- Dormant husks dealt contact damage.
- The height-field tracer returned negative depths when the camera sat exactly on a cell boundary.
- Integer sine returned −0 at 180°, breaking canonical serialisation.
- `deserialize` could not restore non-campaign maps.
- Stone rendered as text (`H`, `E`) instead of box-drawing strokes; pale figures as digits.

## 0.2.0 — Phase 2 (Vertical slice)

- Nocturne phases 1–3, Chapter 1, GDD.

## 0.1.0 — Phase 1 (Concept)

- Pitch, narrative map, feasibility study.
