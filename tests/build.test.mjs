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

test('build import gate: every static import form is extracted, and a missing side-effect import fails', async () => {
  const { importSpecifiers, checkImports } = await import('../tools/lib/imports.mjs');
  const src = `import a from './a.js';\nimport { b,\n  c as d } from "./b.js";\nimport * as e from './e.js';\nexport { f } from './f.js';\nexport * from './g.js';\nimport './side.js';\nimport'./tight.js';\nconst m = import('./lazy.js');\nconst u = import.meta.url; export const V = '1.0'; // important: not an import`;
  assert.deepEqual(importSpecifiers(src), ['./a.js', './b.js', './e.js', './f.js', './g.js', './side.js', './tight.js', './lazy.js']);
  const files = ['src/game/main.js', 'src/game/hud.js'], read = f => (f.endsWith('main.js') ? "import './hud.js';\nimport './missing.js';\nimport x from 'bare';" : '');
  assert.deepEqual(checkImports(files, read), ['src/game/main.js: missing ./missing.js', 'src/game/main.js: bare import bare']);
  assert.deepEqual(checkImports(['src/a/x.js', 'src/b/y.js'], f => (f === 'src/a/x.js' ? "import '../b/y.js';" : '')), [], 'POSIX resolution across directories');
});

test('every shipped module resolves under the extended matcher (no form was previously skipped)', async () => {
  const { checkImports } = await import('../tools/lib/imports.mjs');
  const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.posix.join(d, e.name)) : [path.posix.join(d, e.name)]));
  assert.deepEqual(checkImports(walk('src'), f => fs.readFileSync(path.join(root, f), 'utf8')), []);
});
