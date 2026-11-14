#!/usr/bin/env node
// Hotfix helper: bump the version everywhere it lives and open a changelog entry.
// Usage: node tools/hotfix.mjs patch|minor|release|set <x.y.z[-pre]> "<one-line summary>"
//   patch   1.0.0 -> 1.0.1      minor 1.0.3 -> 1.1.0      release 1.0.0-rc.2 -> 1.0.0
// Then: add a regression fixture under tests/regressions/, npm test, commit on hotfix/<version>, open a PR,
// and after merge tag v<version> (the release workflow builds and drafts the release).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.env.HOTFIX_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), [kind, arg, ...rest] = process.argv.slice(2);
const pkgPath = path.join(root, 'package.json'), mainPath = path.join(root, 'src/game/main.js'), logPath = path.join(root, 'CHANGELOG.md');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')), m = pkg.version.match(/^(\d+)\.(\d+)\.(\d+)(-.+)?$/);
if (!m) { console.error('unparseable version ' + pkg.version); process.exit(2); }
let [maj, min, pat] = m.slice(1, 4).map(Number), next;
if (kind === 'patch') next = m[4] ? `${maj}.${min}.${pat}` : `${maj}.${min}.${pat + 1}`;
else if (kind === 'minor') next = `${maj}.${min + 1}.0`;
else if (kind === 'release') next = `${maj}.${min}.${pat}`;
else if (kind === 'set' && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg || '')) next = arg;
else { console.error('usage: node tools/hotfix.mjs patch|minor|release|set <version> "<summary>"'); process.exit(2); }
const summary = (kind === 'set' ? rest : [arg, ...rest]).filter(Boolean).join(' ') || 'Hotfix.';
pkg.version = next; fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
const main = fs.readFileSync(mainPath, 'utf8'); fs.writeFileSync(mainPath, main.replace(/export const VERSION = '[^']+';/, `export const VERSION = '${next}';`));
const log = fs.readFileSync(logPath, 'utf8'); fs.writeFileSync(logPath, log.replace('# Changelog\n', `# Changelog\n\n## ${next}\n\n### Fixed\n- ${summary}\n`));
console.log(`version ${m[0]} -> ${next}; updated package.json, src/game/main.js, CHANGELOG.md`);
