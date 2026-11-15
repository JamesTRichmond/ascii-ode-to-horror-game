#!/usr/bin/env node
// Production build. Zero dependencies.
//   1. copies the runtime (index.html, src/, assets/, licences) into dist/
//   2. statically resolves every ES-module import in dist/ and fails on a missing file
//   3. writes dist/version.json (version, commit, build time, sha256 of every file)
//   4. packs release/ode-<version>.tar.gz
// The build is reproducible: timestamps come from SOURCE_DATE_EPOCH or the commit time; the archive normalises
// order, ownership and permission bits, so the builder's umask does not change the checksum.
// Usage: node tools/build.mjs [--no-pack]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { checkImports } from './lib/imports.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const git = (...a) => { try { return execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim(); } catch { return ''; } };
const commit = process.env.GITHUB_SHA || git('rev-parse', 'HEAD') || 'unknown';
const epoch = +(process.env.SOURCE_DATE_EPOCH || git('log', '-1', '--format=%ct') || 0);
const builtAt = new Date(epoch * 1000).toISOString();
const INCLUDE = ['index.html', 'src', 'assets', 'LICENSE', 'assets/atlas/FONT-LICENSE.txt', 'telemetry.json'];
const SKIP = f => /\.(test|spec)\.m?js$/.test(f) || f.endsWith('.map');

fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(dist, { recursive: true });
const files = []; // manifest paths are POSIX on every OS; path.join converts them for filesystem access
const copy = rel => { const src = path.join(root, rel), st = fs.statSync(src); if (st.isDirectory()) { for (const f of fs.readdirSync(src).sort()) copy(path.posix.join(rel, f)); return; } if (SKIP(rel) || files.includes(rel)) return; fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true }); fs.copyFileSync(src, path.join(dist, rel)); files.push(rel); };
for (const i of INCLUDE) copy(i);

// version stamp: the runtime reads VERSION from main.js; check it agrees with package.json
const mainSrc = fs.readFileSync(path.join(dist, 'src/game/main.js'), 'utf8'), m = mainSrc.match(/export const VERSION = '([^']+)'/);
if (!m || m[1] !== pkg.version) { console.error(`version mismatch: package.json ${pkg.version}, main.js ${m && m[1]}`); process.exit(1); }

// static import resolution
const problems = checkImports(files, f => fs.readFileSync(path.join(dist, f), 'utf8'));
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) if (!files.includes(path.posix.normalize(ref))) problems.push(`index.html: missing ${ref}`);
for (const ref of ['assets/atlas/glyphs.bin', 'assets/atlas/atlas.png', 'assets/atlas/bluenoise.bin']) if (!files.includes(ref)) problems.push(`missing runtime asset ${ref}`);
if (problems.length) { console.error('build failed:\n  ' + problems.join('\n  ')); process.exit(1); }

const hashes = Object.fromEntries(files.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(dist, f))).digest('hex')]));
const bytes = files.reduce((s, f) => s + fs.statSync(path.join(dist, f)).size, 0);
const version = { name: pkg.name, version: pkg.version, commit, builtAt, files: hashes, totalBytes: bytes };
fs.writeFileSync(path.join(dist, 'version.json'), JSON.stringify(version, null, 2) + '\n');
console.log(`dist/: ${files.length + 1} files, ${(bytes / 1024).toFixed(0)} KiB, version ${pkg.version}, commit ${commit.slice(0, 7)}, built ${builtAt}`);

if (!process.argv.includes('--no-pack')) {
  const rel = path.join(root, 'release'); fs.mkdirSync(rel, { recursive: true });
  const out = path.join(rel, `ode-${pkg.version}.tar.gz`);
  let tarVersion = ''; try { tarVersion = execFileSync('tar', ['--version'], { encoding: 'utf8' }); } catch { /* reported below */ }
  if (!/GNU tar/.test(tarVersion)) { console.error('packing needs GNU tar (--sort/--mtime/--owner); install it (macOS: brew install gnu-tar, then put gtar first on PATH as tar) or use --no-pack'); process.exit(1); }
  const tarball = execFileSync('tar', ['--sort=name', `--mtime=@${epoch}`, '--owner=0', '--group=0', '--numeric-owner', '--mode=u=rwX,go=rX', '-cf', '-', '-C', dist, '.'], { maxBuffer: 1 << 28 });
  fs.writeFileSync(out, zlib.gzipSync(tarball, { level: 9 })); // node's gzip header carries no timestamp
  const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
  fs.writeFileSync(out + '.sha256', `${sha}  ${path.basename(out)}\n`);
  console.log(`release/${path.basename(out)} ${(fs.statSync(out).size / 1024).toFixed(0)} KiB sha256 ${sha}`);
}
