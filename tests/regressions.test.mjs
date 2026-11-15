// Every file in tests/regressions/ is a recorded session (crash report or autoplayer run). Each must
// replay to exactly the recorded tick and state hash. Hotfixes add a fixture here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { replayReport, expectations } from '../tools/replay.mjs';

const dir = path.join(root, 'tests/regressions');
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  test(`regression replay: ${f}`, () => {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), out = replayReport(r), e = expectations(r);
    assert.ok(r.expect && e.tick != null && e.hash != null, 'a fixture states the tick and hash of the fixed run in expect');
    assert.equal(out.tick, e.tick); assert.equal(out.hash, e.hash);
    for (const k of ['done', 'dead']) if (e[k] != null) assert.equal(out[k], e[k], k); // crash reports carry no outcome flags
  });
}
