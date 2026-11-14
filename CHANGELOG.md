# Changelog

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
