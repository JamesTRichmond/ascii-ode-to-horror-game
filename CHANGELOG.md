# Changelog

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
