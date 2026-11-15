import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hiddenCode } from '../tools/lib/hidden-code.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'spike' || e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : /\.m?js$/.test(e.name) ? [path.join(d, e.name)] : []);

test('detector: finds statements after a trailing comment, ignores prose, strings and regexes', () => {
  const bad = [
    "a(); // note G.bot = params.get('autoplay') ? 1 : null;",
    "save(); // keep going G.telemetry?.track('x', {}); G.mode = 'dead';",
    "push(w); // the log holds completed ticks only for (const e of G.sim.events) present(e);",
    "x = 1; // then const y = 2",
  ];
  for (const s of bad) assert.equal(hiddenCode(s).length, 1, s);
  const good = [
    '// whole-line comment: G.bot = 1; f();',
    'a(); // ten minutes of 60 Hz input words; the shell re-bases its log before it grows',
    'a(); // manifest paths are POSIX on every OS; path.join converts them',
    "const u = 'http://x.test/a'; // a URL in a string is not a comment",
    'const r = /a\\/\\/b/g; f(r); // a regex containing slashes',
    'a(); /* block: G.bot = 1; */ b();',
    'a(); // e.g. (see the guide)',
    'a(); // with st.toggle (assist), a press latches these on and the next press releases them',
  ];
  for (const s of good) assert.deepEqual(hiddenCode(s), [], s);
});

test('no statement anywhere in src, tools or tests is hidden by a trailing // comment', () => {
  const hits = ['src', 'tools', 'tests'].flatMap(d => walk(path.join(root, d))).flatMap(f => hiddenCode(fs.readFileSync(f, 'utf8')).map(h => `${path.relative(root, f)}:${h.line}: //${h.comment.slice(0, 120)}`));
  assert.deepEqual(hits, [], 'code after a trailing // comment never runs; move it to its own line or use /* */:\n' + hits.join('\n'));
});
