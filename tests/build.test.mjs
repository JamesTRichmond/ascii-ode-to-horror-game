// Release acceptance: the production build is complete, internally consistent and reproducible.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { root } from './helpers.mjs';

test('production build: every shipped file is hashed, versions agree, rebuild is byte-identical', () => {
  const run = () => execFileSync(process.execPath, [path.join(root, 'tools/build.mjs'), '--no-pack'], { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1800000000' } });
  run(); const a = fs.readFileSync(path.join(root, 'dist/version.json'), 'utf8'); run(); const b = fs.readFileSync(path.join(root, 'dist/version.json'), 'utf8');
  assert.equal(a, b, 'reproducible'); const v = JSON.parse(a), pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(v.version, pkg.version);
  for (const [f, h] of Object.entries(v.files)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'dist', f))).digest('hex'), h, f);
  for (const f of ['index.html', 'src/game/main.js', 'assets/atlas/glyphs.bin', 'assets/atlas/atlas.png', 'assets/atlas/bluenoise.bin', 'LICENSE', 'assets/atlas/FONT-LICENSE.txt']) assert.ok(v.files[f], f);
  assert.ok(!Object.keys(v.files).some(f => f.startsWith('tests/') || f.startsWith('tools/') || f.startsWith('docs/')), 'no dev files shipped');
});
