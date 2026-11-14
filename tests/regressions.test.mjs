// Every file in tests/regressions/ is a recorded session (crash report or autoplayer run). Each must
// replay to exactly the recorded tick and state hash. Hotfixes add a fixture here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { replayReport } from '../tools/replay.mjs';

const dir = path.join(root, 'tests/regressions');
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  test(`regression replay: ${f}`, () => {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), out = replayReport(r);
    assert.equal(out.tick, r.expect.tick); assert.equal(out.hash, r.expect.hash >>> 0); assert.equal(out.done, r.expect.done); assert.equal(out.dead, r.expect.dead);
  });
}
