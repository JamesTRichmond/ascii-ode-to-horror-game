# Launch checklist — 1.0.0

Status key: **DONE** (verified here, with evidence), **OPEN** (needs a person or hardware not available
in the build environment).

## Build and integrity

| Item | Status | Evidence |
|---|---|---|
| `npm test` green on the release commit | DONE | 77/77 (PR 5) |
| Production build resolves every import and asset | DONE | `tools/build.mjs` static check |
| Reproducible archive | DONE | two consecutive builds → identical sha256 |
| `version.json` lists every shipped file with sha256 | DONE | `dist/version.json` |
| `package.json` and in-game version agree | DONE | build gate |
| Licences shipped (MIT, DejaVu font notice) | DONE | `dist/LICENSE`, `dist/assets/atlas/FONT-LICENSE.txt` |
| Built site passes the browser check under the production CSP | DONE | `browser-check --dir dist` → PASSED |

## Release mechanics

| Item | Status |
|---|---|
| Bump `package.json` and `VERSION` in `src/game/main.js` from `1.0.0-rc.1` to `1.0.0` | OPEN — at merge time |
| Merge PRs 1 → 6 in order | OPEN — repository owner |
| Tag `v1.0.0` on `main` | OPEN — repository owner |
| Review and publish the draft GitHub release created by the tag | OPEN — repository owner |
| Choose and trigger the hosting target (Pages dispatch or Vercel dashboard) | OPEN — repository owner |

## Quality gates not reachable from the build environment

| Item | Status |
|---|---|
| Firefox and Safari pass `npm run check:browser` | OPEN |
| Frame-time benchmark on named GPU hardware (`?stats=1`) | OPEN |
| Touch play on a phone or tablet | OPEN |
| Human listening pass on the audio mix | OPEN |
| One full human playthrough of all nine chapters and both endings | OPEN |

## Store and comms

| Item | Status |
|---|---|
| Store copy | DONE — `store/STORE_PAGE.md` |
| Key art and six screenshots, engine-rendered | DONE — `store/` |
| Release notes | DONE — `docs/RELEASE_NOTES.md` |
| Store listing created / published | OPEN — owner decides the storefront |

## Day one

| Item | Status |
|---|---|
| In-game "new version available" notice | DONE — reads `version.json` |
| Save format versioned and forward-safe | DONE — `ode.save.v1`; unknown keys ignored |
| Hotfix pipeline | Phase 6 (`docs/LIVE_OPS.md`) |
