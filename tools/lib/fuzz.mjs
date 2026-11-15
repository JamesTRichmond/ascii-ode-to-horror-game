// Property-based fuzzing of the deterministic simulation. Zero dependencies; every run is reproducible from its seed.
// An input program is a sequence of held "gestures" (buttons held for a random number of ticks, with a random turn
// rate), which reaches far more of the state space than independent per-tick noise.
import { createSim, step, serialize, deserialize, hashState, solidAt, TUNE, IN, packInput } from '../../src/sim/sim.js';

export function xorshift(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** A reproducible input program of `ticks` packed words. */
export function inputProgram(seed, ticks) {
  const r = xorshift(seed), out = [], B = Object.values(IN);
  while (out.length < ticks) {
    let buttons = 0; for (const b of B) if (r() < (b === IN.FWD ? 0.6 : 0.16)) buttons |= b;
    const turn = r() < 0.5 ? 0 : Math.round((r() * 2 - 1) * 120), len = 1 + Math.floor(r() ** 2 * 90);
    for (let k = 0; k < len && out.length < ticks; k++) out.push(packInput(buttons, turn));
  }
  return out;
}

/** Every invariant the simulation promises; returns a list of violations (empty = pass). */
export function checkInvariants(s, prev) {
  const bad = [], p = s.p, ints = serialize(s);
  for (let i = 0; i < ints.length; i++) if (!Number.isInteger(ints[i]) || ints[i] !== (ints[i] | 0)) { bad.push(`serialized[${i}] = ${ints[i]} is not an int32`); break; }
  if (p.hp < 0 || p.hp > TUNE.hpMax) bad.push(`hp ${p.hp} outside [0, ${TUNE.hpMax}]`);
  if (p.breath < 0 || p.breath > TUNE.breathMax) bad.push(`breath ${p.breath} outside [0, ${TUNE.breathMax}]`);
  if (p.measures < 0 || (s.def.need && p.measures > s.def.need)) bad.push(`measures ${p.measures} outside [0, ${s.def.need}]`);
  const cx = p.x >> 10, cz = p.z >> 10;
  if (cx < 0 || cz < 0 || cx >= s.w || cz >= s.h) bad.push(`player cell (${cx}, ${cz}) outside the ${s.w}x${s.h} map`);
  else if (solidAt(s, cx, cz) && !s.dyn[cz * s.w + cx]) bad.push(`player inside solid tile ${String.fromCharCode(s.tiles[cz * s.w + cx])} at (${cx}, ${cz})`);
  for (const e of s.ents) if (e.x < 0 || e.z < 0 || e.x >= s.w * 1024 || e.z >= s.h * 1024) { bad.push(`entity type ${e.type} at (${e.x}, ${e.z}) outside the map`); break; }
  for (const e of s.events) if (!Number.isFinite(e.x) || !Number.isFinite(e.z)) { bad.push(`event ${e.type} has non-finite coordinates`); break; }
  if (prev) {
    if (prev.dead && !s.c.dead) bad.push('dead flag cleared'); if (prev.done && !s.c.done) bad.push('done flag cleared');
    if ((prev.dead || prev.done) && s.tick !== prev.tick) bad.push('tick advanced after the chapter ended');
    if (!prev.dead && !prev.done && s.tick !== prev.tick + 1) bad.push(`tick ${prev.tick} -> ${s.tick}`);
  }
  return bad;
}

/** Run one program, checking invariants every tick and snapshot equivalence at `snapAt`. */
export function fuzzRun(def, seed, ticks, snapAt = Math.floor(ticks / 2)) {
  const s = createSim(def, seed), inputs = inputProgram(seed * 2654435761, ticks); let snap = null;
  for (let t = 0; t < inputs.length; t++) {
    const prev = { dead: s.c.dead, done: s.c.done, tick: s.tick };
    step(s, inputs[t]); const bad = checkInvariants(s, prev); s.events.length = 0;
    if (bad.length) return { ok: false, tick: s.tick, at: t, violations: bad, seed };
    if (t === snapAt) snap = { at: t, state: serialize(s), hash: hashState(s) };
  }
  // snapshot equivalence: a sim restored from the mid-run snapshot reaches the same final state
  if (snap) {
    const r = deserialize(snap.state, typeof def === 'number' ? null : def);
    if (hashState(r) !== snap.hash || serialize(r).join() !== snap.state.join()) return { ok: false, violations: ['deserialize(serialize(s)) changed the state'], seed };
    for (let t = snap.at + 1; t < inputs.length; t++) { step(r, inputs[t]); r.events.length = 0; }
    if (hashState(r) !== hashState(s)) return { ok: false, violations: [`restored run diverged: ${hashState(r).toString(16)} vs ${hashState(s).toString(16)}`], seed };
  }
  return { ok: true, tick: s.tick, hash: hashState(s) >>> 0, dead: s.c.dead, done: s.c.done, seed };
}
