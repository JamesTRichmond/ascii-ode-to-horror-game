// Cross-runtime determinism: the autoplayer on all nine chapters and three Endless verses must reproduce the stored
// state hashes (every 300 ticks for 2,400 ticks). CI runs this on Node 20, 22 and 24; a mismatch on any line means
// the simulation depends on the runtime. Regenerate only for an intended sim change: node tools/golden.mjs --write
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { goldenRuns } from '../tools/golden.mjs';

test(`simulation hashes match the stored goldens on Node ${process.versions.node}`, () => {
  const want = JSON.parse(fs.readFileSync(path.join(root, 'tests/golden/determinism.json'), 'utf8')), got = goldenRuns();
  assert.deepEqual(Object.keys(got), Object.keys(want.runs));
  for (const [name, w] of Object.entries(want.runs)) assert.deepEqual(got[name], w, `${name} (goldens written on Node ${want.node})`);
});
