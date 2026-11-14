# ODE — a horror in nine stanzas

A first-person horror game rendered entirely in volumetric ASCII, built on Arthur O'Shaughnessy's
poem *Ode*. Nine chapters; chapter *N* is stanza *N*.

## Run

```bash
npm start
```

Then open `http://localhost:8080/`. No dependencies to install; Node 20+ is only needed for the
local file server, the tests and the atlas baker.

## Test

```bash
npm test
```

## Documents

| Document | Purpose |
|---|---|
| [docs/PITCH.md](docs/PITCH.md) | High-concept pitch, mechanics, audience, setting |
| [docs/NARRATIVE_MAP.md](docs/NARRATIVE_MAP.md) | Stanza-to-chapter map |
| [docs/GDD.md](docs/GDD.md) | Game design document |
| [docs/FEASIBILITY.md](docs/FEASIBILITY.md) | Stack decision, measured spike, risks |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Six-phase delivery plan and PR checkpoints |

Rendering specification: `nocturne-build-guide.html` (Nocturne — The Volumetric Codex, Edition II).

## Layout

| Path | Contents |
|---|---|
| `src/sim/` | Authoritative integer simulation, chapters, autoplayer |
| `src/render/` | G-buffer, cascades, fog, quadtree, flow, glyph selection, outputs |
| `src/game/` | Loop, input, HUD, audio, saves |
| `src/shared/` | Materials, descriptor layout, sub-cell packing (shared by baker and runtime) |
| `tools/` | Atlas baker, snapshot tool, dev server |
| `assets/atlas/` | Baked MSDF atlas, glyph records, blue noise, manifest |
| `tests/` | Nocturne acceptance fixtures and game tests |

## Status

Phase 3a of 6 — Production, feature-complete alpha: all nine chapters, full Nocturne pipeline.
