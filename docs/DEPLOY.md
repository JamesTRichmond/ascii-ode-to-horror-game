# Build and deployment

Nothing deploys automatically. Production deploys happen only from a version tag or a manual
workflow run, and both require a person.

## Build

```bash
npm test
```

```bash
npm run build
```

Output: `dist/` (static site) and `release/ode-<version>.tar.gz` with a `.sha256`. The build is
reproducible from the commit (timestamps from `SOURCE_DATE_EPOCH` or the commit time).

## Preview the production build locally

```bash
npm run preview
```

The preview server sends the same security headers as `vercel.json` (including the CSP).

## Trusted Types

The CSP ends with `require-trusted-types-for 'script'; trusted-types ode-html; form-action 'none'`. In browsers that support Trusted Types, every DOM sink that can run script (`innerHTML`, `insertAdjacentHTML`, script text and script URLs, `new Worker`, `serviceWorker.register`) refuses plain strings, and `ode-html` is the only policy that can be created.

| Rule | Where |
|---|---|
| Build markup with `` html`…` ``: every interpolated value is escaped unless it is itself `` html`…` `` output | `src/game/safe-html.js` |
| Write it with `setHTML(el, …)`, the only `innerHTML` assignment in `src` (a test fails on any other sink) | `src/game/safe-html.js`, `tests/safe-html.test.mjs` |
| `ode-html` accepts only an allowlist of tags and attributes: no `<script>`, no `on*` handlers, no `href`/`src`, no inline `style`. The same check runs in browsers without Trusted Types | `TAGS`, `ATTRS`, `TYPES` in `safe-html.js` |
| A new tag or attribute in a menu is added to the allowlist together with a test case | `tests/safe-html.test.mjs` |
| Worker and service-worker URLs go through `scriptURL(url)` (same-origin `.js` only) | `safe-html.js` |
| `browser-check` opens every card and overlay under the CSP, requires zero violations and zero policy rejections, and probes that raw sinks and new policies are refused | `tools/browser-check.mjs` (`security`) |

## Targets

| Target | Config | Trigger |
|---|---|---|
| GitHub Release (draft) | `.github/workflows/release.yml` → `github-release` job | Push of a tag `v*` matching `package.json` |
| GitHub Pages | `.github/workflows/release.yml` → `pages` job | Manual run of *Release* with `deploy_pages` checked |
| Vercel | `vercel.json` (build `node tools/build.mjs --no-pack`, output `dist`) | Git-triggered deployments are disabled for every branch in the config; deploy from the Vercel dashboard or CLI |
| CI | `.github/workflows/ci.yml` | Every pull request and every branch push, `main` included: the test suite and build on Node 20, 22 and 24 (the simulation must hash identically on each, `tests/determinism-golden.test.mjs`), plus atlas reproducibility; it never deploys |

## Day-one patch

The game fetches `version.json` (same origin) on the title screen and tells the player when a newer
build is deployed. Saves are versioned (`ode.save.v1`) and survive updates. Hotfix procedure:
`docs/LIVE_OPS.md` (Phase 6).
