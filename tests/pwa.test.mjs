// Installable, offline-capable build: manifest, icons, service worker, and the build ships them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { decodePNG } from '../tools/lib/png.mjs';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, [path.join(root, 'tools/build.mjs'), '--no-pack'], { stdio: 'ignore' }); // dist/ for the last test

test('the web app manifest is complete and its icons exist at the stated sizes', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const k of ['name', 'short_name', 'start_url', 'display', 'background_color', 'theme_color']) assert.ok(m[k], k);
  assert.ok(m.icons.some(i => i.purpose === 'maskable')); for (const i of m.icons) { const png = decodePNG(fs.readFileSync(path.join(root, i.src))); assert.equal(`${png.w}x${png.h}`, i.sizes, i.src); }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'); assert.match(html, /rel="manifest" href="manifest.webmanifest"/); assert.match(html, /name="theme-color"/);
});
test('the service worker is plain same-origin code, network-first for the shell and version.json, cache-first otherwise', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(!/importScripts|https?:\/\//.test(sw), 'no third-party code'); assert.match(sw, /req\.mode === 'navigate'/); assert.match(sw, /version\.json/); assert.match(sw, /caches\.delete\(RUNTIME\)/);
  const main = fs.readFileSync(path.join(root, 'src/game/main.js'), 'utf8'); assert.match(main, /if \(v\.files && 'serviceWorker' in navigator/, 'registered only by production builds');
});
test('the production build ships the worker, the manifest and the icons, all hashed', () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'dist/version.json'), 'utf8'));
  for (const f of ['sw.js', 'manifest.webmanifest', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png']) assert.ok(v.files[f], f);
});
