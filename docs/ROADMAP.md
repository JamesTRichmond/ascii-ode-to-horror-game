# Delivery roadmap

Branches are stacked: each phase branch is cut from the previous one, and each PR targets the
previous phase branch so its diff shows only that phase. Merge in order.

| PR | Branch | Phase | Contents | Nocturne phases |
|---|---|---|---|---|
| 1 | `phase-1-concept` | Initiation & Concept | Pitch, narrative map, feasibility | — |
| 2 | `phase-2-preproduction` | Pre-Production | GDD, engine setup, vertical slice (Chapter 1) | 1, 2, 3 |
| 3a | `phase-3a-alpha` | Production — feature complete | All 9 chapters, all mechanics, full renderer | 4, 5, 6 |
| 3b | `phase-3b-content` | Production — content complete | Audio, lighting/fog passes, temporal and HUD polish | tuning of 3, 5, 6 |
| 4 | `phase-4-rc` | Testing & Polish | Fixture report, benchmarks, balance, bug-fix changelog | all fixtures |
| 5 | `phase-5-launch` | Launch & Release | Production bundle, deploy configs, release notes, checklist | — |
| 6 | `phase-6-liveops` | Post-Launch | Telemetry, crash reporting, hotfix pipeline, endless mode | — |

## No-drift rules

1. No acceptance fixture is skipped, weakened or deleted. Fixtures only gain cases.
2. Every glyph on the play field is chosen from G-buffer data. No tile maps, no sprite text.
3. Every PR description states scope, requirements satisfied, commands run with observed output, and open blockers.
4. Nothing is pushed to `main`; nothing is merged by the author.
