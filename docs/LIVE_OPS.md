# Live operations and post-launch plan

## 1. Telemetry

Opt-in, first-party, minimal. Implementation: `src/game/telemetry.js`.

| Rule | How it is enforced |
|---|---|
| Off by default | `settings.telemetry = false`; `tests/liveops.test.mjs` asserts nothing is sent |
| Nothing leaves without a configured endpoint | `telemetry.json` ships with `"endpoint": null`; the sender is never called without one (tested) |
| No identifiers | Events carry a random per-tab session token, version, and the fields below — no user ID, device fingerprint, IP handling, or free text |
| Visible to the player first | Settings → *Copy diagnostic report* shows the exact local record |
| Transport | `navigator.sendBeacon` to the configured same-origin path or https URL |

### Event schema (v1)

| Event | Fields (besides `schema`, `type`, `t`, `session`, `version`) | When |
|---|---|---|
| `session_start` | `tier`, `reducedMotion`, `textScale` | Boot |
| `chapter_start` | `chapter` | New chapter (not on restore) |
| `chapter_complete` | `chapter`, `tick`, `hp` | Exit reached |
| `death` | `chapter`, `tick`, `hp`, `measures` | Unwritten |
| `ending` | `ending` (1 sing, 2 silence) | Chapter 9 |
| `perf` | `tier`; `cpuP50`, `cpuP95` (main-thread work per frame, ms); `intervalP50`, `intervalP95` (time between rendered frames, ms, which includes missed refreshes and GPU waits) | Each chapter completion |
| `endless_verse` / `endless_end` | `seed`, `depth` | Endless Choir |
| `crash` | `message`, `chapter`, `tick` | Any uncaught error |

Questions this answers: where players die (chapter, tick), where they quit (start without complete),
which endings are chosen, whether the auto tier holds 30 fps in the field (`intervalP95` at or under 33.3 ms;
the CPU figures alone cannot show that).

To turn it on for a deployment, set `endpoint` in `telemetry.json` to a collector you operate and announce it in
the release notes. Players still have to opt in. What else the endpoint needs depends on where it lives:

| Endpoint | Also required |
|---|---|
| Same-origin path, e.g. `"/api/telemetry"` (recommended) | Nothing: the production CSP already allows `connect-src 'self'`, and same-origin beacons need no CORS |
| External `https://` collector | 1. Add the collector's origin to `connect-src` in the `Content-Security-Policy` header in `vercel.json` (e.g. `connect-src 'self' https://collector.example`); without it the browser blocks every beacon. `tools/serve.mjs` applies the same header, so local play shows the same block. 2. The collector must accept cross-origin POSTs from the game's origin. The beacon is sent as `Content-Type: application/json` with credentials mode `include`, so the browser first sends a CORS preflight (`OPTIONS`). Answer it, and the POST, with `Access-Control-Allow-Origin: <the game's exact origin>` (not `*`, because credentials are included), `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Methods: POST` and `Access-Control-Allow-Headers: Content-Type` |

## 2. Crash reporting

| Step | Detail |
|---|---|
| Capture | `error` and `unhandledrejection` listeners plus a guard around each frame |
| Player sees | "Something broke" overlay: saved progress is safe; *Copy crash report* (status in the dialog; if the clipboard is refused, the report appears selected in a read-only field to copy by hand); *Restart chapter* / *Restart verse* (rebuilds the renderer first); *Reload the game*; *Title* |
| Report contents | Message, stack with origins stripped, version, chapter or Endless `{seed, depth}`, run seed, tick, state hash, **the run-length-encoded input log** (at most 10 minutes), `base` (`{tick, state}`: the serialized sim the log starts from after a restored checkpoint or a 10-minute re-base; `null` when the log starts at tick 0), `failingInput` (the word whose `step()` threw, kept out of the log; `tick` is then the last completed tick and `hash` is `null`), render tier, browser family |
| Reproduction | `node tools/replay.mjs report.json` replays the session deterministically from `base` (or tick 0), then retries `failingInput` once if present. It checks each supplied expectation: `expect` first, then the crash's own `tick` / `hash`. Exit 0 = `REPRODUCED`, or `REPLAYED` when nothing is expected or `--until <tick>` stopped early; 1 = `DIVERGED`; 2 = unreadable or invalid report |
| Verified | A fault forced in the browser produced a report that replayed to the same tick and hash in Node (PR 6) |

## 3. Hotfix pipeline

```bash
git checkout -b hotfix/1.0.1 v1.0.0
```

```bash
node tools/replay.mjs crash.json --trace
```

Fix the bug, then turn the report into a permanent regression fixture (any crash report is already in
fixture format; add an `expect` block with the corrected tick and hash, or record a fresh run):

```bash
node tools/record-fixture.mjs crash-1234 4
```

```bash
node tools/hotfix.mjs patch "Fix: <one line>"
```

```bash
npm test
```

Open a PR from `hotfix/1.0.1`; CI runs tests, the build and the atlas check. After a reviewer merges
it, the repository owner tags `v1.0.1`; the release workflow builds the archive and drafts the release.
Players see the in-game update notice from `version.json` on their next visit; saves carry over.

| Severity | Definition | Target |
|---|---|---|
| S1 | Crash on boot, save loss, chapter impossible to finish | Fix tagged within 24 h |
| S2 | Crash in one chapter with a workaround; severe performance regression | Within 1 week |
| S3 | Visual or audio defect | Next scheduled patch |

## 4. Maintenance

| Cadence | Task |
|---|---|
| Every PR | CI: 80+ tests including all Nocturne fixtures, regression replays, build, atlas reproducibility |
| Weekly | New Endless Choir weekly seed (automatic: ISO week number) |
| Monthly | `npm run check:browser` on current Chromium, Firefox and Safari; `npm run balance` to watch difficulty drift |
| Per release | `docs/TEST_REPORT.md` refreshed; CHANGELOG entry; reproducible-archive hash published |

## 5. Post-launch roadmap

| Version | Content | Status / hook |
|---|---|---|
| 1.1 | **Endless Choir**: procedurally generated verses from (seed, depth), three verse kinds borrowing campaign rules, escalating threats, one life, best-depth record, weekly shared seed | **Implemented** (`src/sim/endless.js`); unlocks after Chapter 8 or any ending; deterministic, replayable, tested |
| 1.2 | Firefox/Safari certification; GPU-path timing on named hardware; Web Worker render to free the main thread | Planned |
| 1.3 | **Epilogue — "A Singer Who Sings No More"**: a tenth stanza-less chapter after ending 2, using the Endless generator with a fixed seed and the Chapter 9 theme | Hook: `endlessVerse(seed, depth)` + `def.theme`; needs writing and a map |
| 1.4 | Challenge modifiers for Endless (no hum, permanent dawn, double threats) | Hook: verse `KINDS` table and chapter `rule` flags |
| 1.1.x | **Community seeds**: every Endless run has a 9-symbol code (`0037-JCG0-0`, Crockford base32 + mod-37 check) shown in the HUD and on the end screen, copyable, enterable from the Endless menu or as `?seed=CODE` | **Implemented** (`src/sim/seedcode.js`); every single-symbol typo and adjacent swap is rejected |
| Later | Replays as ghost runs (input logs already deterministic) | Hook: RLE input logs and `replayReport` |
