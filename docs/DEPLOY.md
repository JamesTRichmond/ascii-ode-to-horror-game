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

## Targets

| Target | Config | Trigger |
|---|---|---|
| GitHub Release (draft) | `.github/workflows/release.yml` → `github-release` job | Push of a tag `v*` matching `package.json` |
| GitHub Pages | `.github/workflows/release.yml` → `pages` job | Manual run of *Release* with `deploy_pages` checked |
| Vercel | `vercel.json` (build `node tools/build.mjs --no-pack`, output `dist`) | Git auto-deploy of `main` is disabled in the config; deploy from the Vercel dashboard or CLI |
| CI | `.github/workflows/ci.yml` | Every pull request and branch push (tests, build, atlas reproducibility) |

## Day-one patch

The game fetches `version.json` (same origin) on the title screen and tells the player when a newer
build is deployed. Saves are versioned (`ode.save.v1`) and survive updates. Hotfix procedure:
`docs/LIVE_OPS.md` (Phase 6).
