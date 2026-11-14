// Authoritative 60 Hz simulation. Integer state only; deterministic entity order; one PRNG whose
// state is serialised. Rendering reads snapshots and never writes here (guide phase 6).
import { UNIT, ANG, isin, icos, isqrt, iatan2, xorshift, fnv1a, angDiff } from './fixed.js';
import { CHAPTERS, RULE } from './chapters.js';

export const TICK_HZ = 60;
export const SCHEMA = 4;
export const IN = { FWD: 1, BACK: 2, LEFT: 4, RIGHT: 8, TURNL: 16, TURNR: 32, HUM: 64, CHORD: 128, HOLD: 256, USE: 512 };
/** Pack buttons and a signed mouse turn (-2047..2047 angle units) into one integer input word. */
export const packInput = (buttons, turn = 0) => (buttons & 0x3ff) | ((Math.max(-2047, Math.min(2047, turn | 0)) & 0xfff) << 12);

export const ET = { FORSAKER: 1, CROWNED: 2, TRAMPLER: 3, SIGH: 4, MIRTH: 5, TRIUNE: 6, HUSK: 7, BUILDER: 8, MARCHER: 9, CHORISTER: 10, COMER: 11, SLUMBERER: 12 };
const SPAWN = { f: ET.FORSAKER, c: ET.CROWNED, s: ET.SIGH, m: ET.MIRTH, 3: ET.TRIUNE, h: ET.HUSK, u: ET.BUILDER, n: ET.MARCHER, o: ET.CHORISTER, k: ET.COMER, Z: ET.SLUMBERER };
//                 speed/tick, contact damage, hp, hearing % of noise radius
const STATS = {
  [ET.FORSAKER]: [11, 14, 2, 100], [ET.CROWNED]: [19, 22, 0, 0], [ET.TRAMPLER]: [22, 30, 0, 0], [ET.SIGH]: [8, 0, 1, 0],
  [ET.MIRTH]: [30, 12, 1, 0], [ET.TRIUNE]: [24, 34, 0, 100], [ET.HUSK]: [14, 12, 1, 100], [ET.BUILDER]: [17, 20, 0, 130],
  [ET.MARCHER]: [15, 10, 0, 0], [ET.CHORISTER]: [22, 25, 0, 0], [ET.COMER]: [10, 20, 0, 120], [ET.SLUMBERER]: [0, 0, 0, 0],
};
export const TUNE = {
  hpMax: 100, breathMax: 1000, humDrain: 2, holdDrain: 1, regen: 2, chordCost: 320, chordCooldown: 80, chordRange: 3 * UNIT,
  walk: 27, holdWalk: 13, wade: 16, turn: 44, radius: 300, iframes: 70, measureHeal: 20, gaspTicks: 110,
  noiseStill: 2, noiseWalk: 5, noiseHold: 1, noiseHum: 11, noiseChord: 30, toggleHum: 50, layerHum: 70, slumberHum: 300,
};
const E_FIELDS = ['type', 'x', 'z', 'ang', 'hp', 'mode', 'timer', 'tx', 'tz', 'aux', 'hx', 'hz'];
const P_FIELDS = ['x', 'z', 'ang', 'hp', 'breath', 'measures', 'cooldown', 'hum', 'hold', 'flame', 'iframes', 'noise', 'humTicks', 'gasp', 'steps', 'marked'];
const C_FIELDS = ['phase', 'phaseTimer', 'gateOpen', 'stage', 'surge', 'surgeTimer', 'lit', 'sing', 'done', 'dead', 'ending', 'noiseX', 'noiseZ', 'noiseAge'];
const code = c => c.charCodeAt(0);
const T = { WALL: code('#'), INS: code('I'), ROCK: code('r'), TREE: code('t'), DEEP: code('='), VOID: code(' '), FLOOR: code('.'), SAND: code(','), GRASS: code('g'), WATER: code('~'), SHADE: code('S'), GATE: code('X'), FOUND: code('F'), RAISE: code('w'), PA: code('a'), PB: code('b'), BRAZ: code('B') };
export { T as TILE };

/** Build a fresh chapter state. `chapter` is a 0-based index or a chapter definition object. */
export function createSim(chapter, seed = 1) {
  const def = typeof chapter === 'number' ? CHAPTERS[chapter] : chapter;
  const h = def.map.length, w = Math.max(...def.map.map(r => r.length));
  const s = {
    def, w, h, tick: 0, rng: (seed >>> 0) || 1, tiles: new Uint8Array(w * h), dyn: new Uint8Array(w * h),
    p: Object.fromEntries(P_FIELDS.map(f => [f, 0])), c: Object.fromEntries(C_FIELDS.map(f => [f, 0])),
    ents: [], picks: [], spawns: [], fieldP: new Int16Array(w * h), fieldN: new Int16Array(w * h), events: [], braziers: 0,
  };
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    const ch = def.map[z][x] ?? (def.indoor ? '#' : 'r'), i = z * w + x; let t = code(ch);
    const base = def.indoor ? T.FLOOR : (z > 0 && ',~='.includes(def.map[z - 1][x] ?? '') ? T.SAND : T.GRASS);
    const cx = x * UNIT + UNIT / 2, cz = z * UNIT + UNIT / 2;
    if (ch === 'P') { s.p.x = cx; s.p.z = cz; t = base; }
    else if (ch === 'M') { s.picks.push({ x: cx, z: cz, taken: 0 }); t = base; }
    else if (ch === 'W') { t = T.RAISE; s.dyn[i] = 1; }
    else if (ch === 'T') { s.spawns.push({ x: cx, z: cz }); t = base; }
    else if (ch === 'B') s.braziers++;
    else if (SPAWN[ch]) { const type = SPAWN[ch]; s.ents.push({ type, x: cx, z: cz, ang: 0, hp: STATS[type][2], mode: 0, timer: 0, tx: cx, tz: cz, aux: 0, hx: cx, hz: cz }); t = base; }
    s.tiles[i] = t;
  }
  Object.assign(s.p, { hp: TUNE.hpMax, breath: def.rule & RULE.MUTE_START ? 0 : TUNE.breathMax, ang: def.startAng ?? (def.id === 1 || def.id === 9 ? 3072 : 0), flame: def.rule & RULE.BRAZIERS ? 1 : 0 });
  s.c.surgeTimer = 420; s.c.phaseTimer = def.period || 0; s.c.noiseAge = 9999;
  flood(s, s.fieldP, s.p.x >> 10, s.p.z >> 10);
  return s;
}

export function solidAt(s, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= s.w || cz >= s.h) return true;
  const i = cz * s.w + cx, t = s.tiles[i];
  switch (t) {
    case T.WALL: case T.INS: case T.ROCK: case T.TREE: case T.DEEP: case T.VOID: case T.FOUND: case T.BRAZ: return true;
    case T.RAISE: return s.dyn[i] === 1;
    case T.PA: return s.c.phase === 0;
    case T.PB: return s.c.phase === 1;
    case T.GATE: return s.c.gateOpen === 0;
    default: return false;
  }
}
const blocked = (s, x, z, r) => solidAt(s, (x - r) >> 10, (z - r) >> 10) || solidAt(s, (x + r) >> 10, (z - r) >> 10) || solidAt(s, (x - r) >> 10, (z + r) >> 10) || solidAt(s, (x + r) >> 10, (z + r) >> 10);
function moveBody(s, b, dx, dz, r) {
  if (dx && !blocked(s, b.x + dx, b.z, r)) b.x += dx;
  if (dz && !blocked(s, b.x, b.z + dz, r)) b.z += dz;
}
/** Breadth-first distance field over walkable cells (4-connected). 32767 = unreachable. */
export function flood(s, field, cx, cz) {
  field.fill(32767); if (cx < 0 || cz < 0 || cx >= s.w || cz >= s.h) return;
  const q = new Int32Array(s.w * s.h); let head = 0, tail = 0;
  field[cz * s.w + cx] = 0; q[tail++] = cz * s.w + cx;
  while (head < tail) {
    const i = q[head++], x = i % s.w, z = (i / s.w) | 0, d = field[i] + 1;
    if (x > 0 && field[i - 1] > d && !solidAt(s, x - 1, z)) { field[i - 1] = d; q[tail++] = i - 1; }
    if (x < s.w - 1 && field[i + 1] > d && !solidAt(s, x + 1, z)) { field[i + 1] = d; q[tail++] = i + 1; }
    if (z > 0 && field[i - s.w] > d && !solidAt(s, x, z - 1)) { field[i - s.w] = d; q[tail++] = i - s.w; }
    if (z < s.h - 1 && field[i + s.w] > d && !solidAt(s, x, z + 1)) { field[i + s.w] = d; q[tail++] = i + s.w; }
  }
}
function rand(s) { s.rng = xorshift(s.rng); return s.rng; }
const dist = (ax, az, bx, bz) => isqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
export function lineOfSight(s, ax, az, bx, bz) {
  const steps = Math.max(1, (dist(ax, az, bx, bz) / 256) | 0);
  for (let i = 1; i < steps; i++) if (solidAt(s, (ax + Math.floor(((bx - ax) * i) / steps)) >> 10, (az + Math.floor(((bz - az) * i) / steps)) >> 10)) return false;
  return true;
}
const emit = (s, type, x = 0, z = 0, a = 0) => s.events.push({ type, x, z, a, tick: s.tick });
function makeNoise(s, radius, x, z) { if (radius >= 4) { s.c.noiseX = x; s.c.noiseZ = z; s.c.noiseAge = 0; flood(s, s.fieldN, x >> 10, z >> 10); } }
function hurt(s, dmg, x, z) {
  const p = s.p; if (p.iframes > 0 || s.c.done || s.c.dead) return;
  p.hp -= dmg; p.iframes = TUNE.iframes; emit(s, 'hurt', x, z, dmg);
  if (p.hp <= 0) { p.hp = 0; s.c.dead = 1; emit(s, 'death', p.x, p.z); }
}
/** Shade test for the dawn rule: roofed cell, or a wall within two cells to the east. */
export function inShade(s, cx, cz) {
  if (s.tiles[cz * s.w + cx] === T.SHADE) return true;
  for (let d = 1; d <= 2; d++) { const t = cx + d < s.w ? s.tiles[cz * s.w + cx + d] : 0; if (t === T.WALL || t === T.INS) return true; }
  return false;
}
function ejectFromSolid(s, b) { // phase flips and raised walls must never trap a body inside a wall
  if (!blocked(s, b.x, b.z, 200)) return;
  const cx = b.x >> 10, cz = b.z >> 10;
  for (let r = 1; r < 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || solidAt(s, cx + dx, cz + dz)) continue;
    b.x = (cx + dx) * UNIT + UNIT / 2; b.z = (cz + dz) * UNIT + UNIT / 2; return;
  }
}
function setPhase(s, phase) {
  s.c.phase = phase; ejectFromSolid(s, s.p); for (const e of s.ents) if (e.type !== ET.SIGH) ejectFromSolid(s, e);
  flood(s, s.fieldP, s.p.x >> 10, s.p.z >> 10); emit(s, 'phase', s.p.x, s.p.z, phase);
}

function stepPlayer(s, input) {
  const p = s.p, c = s.c, rule = s.def.rule, turn = ((input >> 12) & 0xfff) << 20 >> 20;
  p.ang = (p.ang + turn + (input & IN.TURNR ? TUNE.turn : 0) - (input & IN.TURNL ? TUNE.turn : 0)) & (ANG - 1);
  if (p.iframes > 0) p.iframes--; if (p.cooldown > 0) p.cooldown--; if (p.gasp > 0) p.gasp--;
  const voiced = !(rule & RULE.MUTE_START) || p.measures > 0;
  p.hold = input & IN.HOLD && p.gasp === 0 && p.breath > 0 ? 1 : 0;
  p.hum = input & IN.HUM && voiced && !p.hold && p.breath > 0 && p.gasp === 0 ? 1 : 0;
  // movement
  const f = (input & IN.FWD ? 1 : 0) - (input & IN.BACK ? 1 : 0), st = (input & IN.RIGHT ? 1 : 0) - (input & IN.LEFT ? 1 : 0);
  const wading = s.tiles[(p.z >> 10) * s.w + (p.x >> 10)] === T.WATER;
  let sp = p.hold ? TUNE.holdWalk : wading ? TUNE.wade : TUNE.walk; if (f && st) sp = (sp * 724) >> 10;
  const cs = icos(p.ang), sn = isin(p.ang), ox = p.x, oz = p.z;
  moveBody(s, p, Math.trunc(((f * cs - st * sn) * sp) / 4096), Math.trunc(((f * sn + st * cs) * sp) / 4096), TUNE.radius);
  const moved = p.x !== ox || p.z !== oz;
  if (moved) { p.steps += sp; if (p.steps >= 700) { p.steps = 0; emit(s, 'step', p.x, p.z, p.hold); } }
  // breath
  if (p.hum) { p.breath -= TUNE.humDrain; p.humTicks++; if (p.humTicks % 20 === 1) emit(s, 'hum', p.x, p.z, p.humTicks); }
  else { p.humTicks = 0; if (p.hold) p.breath -= TUNE.holdDrain; else if (voiced && p.breath < TUNE.breathMax) p.breath = Math.min(TUNE.breathMax, p.breath + TUNE.regen); }
  if (p.breath <= 0 && voiced) { p.breath = 0; if (p.hold || p.hum) { p.gasp = TUNE.gaspTicks; p.hold = p.hum = 0; emit(s, 'gasp', p.x, p.z); makeNoise(s, 12, p.x, p.z); p.noise = 12; } }
  // chord
  let chord = 0;
  if (input & IN.CHORD && voiced && !p.hold && p.cooldown === 0 && p.breath >= TUNE.chordCost && p.gasp === 0) {
    p.breath -= TUNE.chordCost; p.cooldown = TUNE.chordCooldown; chord = 1; emit(s, 'chord', p.x, p.z, p.ang);
    for (const e of s.ents) {
      if (e.type === ET.SLUMBERER || e.mode === 9) continue;
      const d = dist(p.x, p.z, e.x, e.z); if (d > TUNE.chordRange) continue;
      if (Math.abs(angDiff(p.ang, iatan2(e.z - p.z, e.x - p.x))) > 700 && d > UNIT) continue;
      if (STATS[e.type][2] > 0) { e.hp--; if (e.hp <= 0) { e.mode = 9; e.timer = e.type === ET.SIGH ? 900 : 0; emit(s, 'unwritten', e.x, e.z, e.type); continue; } }
      e.mode = 8; e.timer = 150; emit(s, 'stagger', e.x, e.z, e.type);
    }
  }
  const base = p.hold ? (moved ? TUNE.noiseHold : 0) : moved ? TUNE.noiseWalk : TUNE.noiseStill;
  const target = chord ? TUNE.noiseChord : p.hum ? TUNE.noiseHum : base;
  p.noise = target >= p.noise ? target : Math.max(target, p.noise - 1);
  if (chord || (p.hum && s.tick % 15 === 0) || (moved && !p.hold && s.tick % 30 === 0)) makeNoise(s, p.noise, p.x, p.z);
  c.noiseAge = Math.min(9999, c.noiseAge + 1);
  // pickups, interaction
  for (const m of s.picks) if (!m.taken && dist(p.x, p.z, m.x, m.z) < 620) {
    m.taken = 1; p.measures++; p.hp = Math.min(TUNE.hpMax, p.hp + TUNE.measureHeal);
    if (p.measures === 1 && rule & RULE.MUTE_START) p.breath = TUNE.breathMax;
    emit(s, 'measure', m.x, m.z, p.measures);
  }
  if (input & IN.USE && rule & RULE.BRAZIERS) {
    const fx = (p.x + (cs * 900 >> 12)) >> 10, fz = (p.z + (sn * 900 >> 12)) >> 10;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = fx + dx, z = fz + dz; if (x < 0 || z < 0 || x >= s.w || z >= s.h) continue;
      const i = z * s.w + x; if (s.tiles[i] !== T.BRAZ || dist(p.x, p.z, x * UNIT + 512, z * UNIT + 512) > 1700) continue;
      if (s.dyn[i]) { if (!p.flame) { p.flame = 1; emit(s, 'relight', p.x, p.z); } }
      else if (p.flame) { s.dyn[i] = 1; c.lit++; emit(s, 'brazier', x * UNIT + 512, z * UNIT + 512, c.lit); }
    }
  }
  if (rule & RULE.BRAZIERS && p.hum && p.flame && p.humTicks > 45) { p.flame = 0; emit(s, 'gutter', p.x, p.z); }
}

function stepRules(s) {
  const p = s.p, c = s.c, def = s.def, rule = def.rule;
  if (rule & RULE.FOUNDATIONS && p.hum && p.humTicks === TUNE.toggleHum) {
    const px = p.x >> 10, pz = p.z >> 10; let hit = 0;
    for (let z = Math.max(0, pz - 2); z <= Math.min(s.h - 1, pz + 2); z++) for (let x = Math.max(0, px - 2); x <= Math.min(s.w - 1, px + 2); x++) {
      if (s.tiles[z * s.w + x] !== T.FOUND) continue; hit = 1;
      for (let zz = Math.max(0, z - 4); zz <= Math.min(s.h - 1, z + 4); zz++) for (let xx = Math.max(0, x - 4); xx <= Math.min(s.w - 1, x + 4); xx++) {
        const i = zz * s.w + xx; if (s.tiles[i] === T.RAISE) { s.dyn[i] ^= 1; emit(s, 'wall', xx * UNIT + 512, zz * UNIT + 512, s.dyn[i]); }
      }
    }
    if (hit) { ejectFromSolid(s, p); for (const e of s.ents) ejectFromSolid(s, e); flood(s, s.fieldP, p.x >> 10, p.z >> 10); }
  }
  if (rule & RULE.PHASE_TIMER) {
    if (c.phaseTimer === 90) emit(s, 'phaseWarn', p.x, p.z, c.phase ^ 1);
    if (--c.phaseTimer <= 0) { c.phaseTimer = def.period; setPhase(s, c.phase ^ 1); }
  }
  if (rule & RULE.LAYERS && p.hum && p.humTicks === TUNE.layerHum) setPhase(s, c.phase ^ 1);
  if (rule & RULE.DAWN) {
    // stage 0 calm -> 1 warning -> 2 surge; calm shortens as the sun climbs, then never ends
    if (--c.surgeTimer <= 0) {
      c.stage = (c.stage + 1) % 3; c.surge++;
      c.surgeTimer = c.stage === 1 ? 130 : c.stage === 2 ? 170 : Math.max(150, 420 - c.surge * 12);
      emit(s, c.stage === 1 ? 'surgeWarn' : c.stage === 2 ? 'surge' : 'surgeEnd', p.x, p.z, c.surge);
    }
    if ((c.stage === 2 || s.tick > 11000) && !inShade(s, p.x >> 10, p.z >> 10) && s.tick % 12 === 0) { p.iframes = 0; hurt(s, 7, p.x + UNIT, p.z); }
  }
  if (rule & RULE.FINALE) for (const e of s.ents) if (e.type === ET.SLUMBERER && p.hum && dist(p.x, p.z, e.x, e.z) < 2300) {
    c.sing++; if (c.sing % 60 === 0) emit(s, 'wake', e.x, e.z, c.sing);
    if (c.sing >= TUNE.slumberHum && !c.done) { c.done = 1; c.ending = 1; emit(s, 'ending', e.x, e.z, 1); }
  }
  // gate
  if (!c.gateOpen) {
    const open = rule & RULE.BRAZIERS ? c.lit >= s.braziers : p.measures >= def.need;
    if (open) {
      c.gateOpen = 1; emit(s, 'gate', p.x, p.z); flood(s, s.fieldP, p.x >> 10, p.z >> 10);
      if (rule & RULE.FOUNDATIONS) for (const sp of s.spawns) { s.ents.push({ type: ET.TRAMPLER, x: sp.x, z: sp.z, ang: 2048, hp: 0, mode: 1, timer: 0, tx: sp.x, tz: sp.z, aux: 0, hx: sp.x, hz: sp.z }); emit(s, 'trample', sp.x, sp.z); }
    }
  }
  if (!c.done && s.tiles[(p.z >> 10) * s.w + (p.x >> 10)] === T.GATE) { c.done = 1; if (rule & RULE.FINALE) { c.ending = 2; emit(s, 'ending', p.x, p.z, 2); } emit(s, 'complete', p.x, p.z, def.id); }
}

function steer(s, e, tx, tz, speed, ghost) {
  const dx = tx - e.x, dz = tz - e.z, d = isqrt(dx * dx + dz * dz); if (d < 8) return;
  e.ang = iatan2(dz, dx); const k = Math.min(speed, d), mx = Math.trunc((dx * k) / d), mz = Math.trunc((dz * k) / d);
  if (ghost) { e.x += mx; e.z += mz; } else moveBody(s, e, mx, mz, 260);
}
function follow(s, e, field, speed) { // descend a flood field cell by cell
  const cx = e.x >> 10, cz = e.z >> 10, i = cz * s.w + cx; let best = field[i], bx = cx, bz = cz;
  if (cx > 0 && field[i - 1] < best) { best = field[i - 1]; bx = cx - 1; bz = cz; }
  if (cx < s.w - 1 && field[i + 1] < best) { best = field[i + 1]; bx = cx + 1; bz = cz; }
  if (cz > 0 && field[i - s.w] < best) { best = field[i - s.w]; bx = cx; bz = cz - 1; }
  if (cz < s.h - 1 && field[i + s.w] < best) { best = field[i + s.w]; bx = cx; bz = cz + 1; }
  if (best >= 32767) return false;
  steer(s, e, bx * UNIT + 512, bz * UNIT + 512, speed, false); return true;
}

function stepEntity(s, e) {
  const p = s.p, c = s.c, [speed, dmg, , hearing] = STATS[e.type], d = dist(p.x, p.z, e.x, e.z);
  if (e.mode === 9) { if (e.timer > 0 && --e.timer === 0) { e.mode = 0; e.hp = STATS[e.type][2]; e.x = e.hx; e.z = e.hz; } return; }
  if (e.mode === 8) { if (--e.timer <= 0) e.mode = e.type === ET.HUSK ? 0 : 1; return; }
  const hears = hearing > 0 && d <= (p.noise * hearing * UNIT) / 100;
  const chase = sp => { if (d < 1500 && lineOfSight(s, e.x, e.z, p.x, p.z)) steer(s, e, p.x, p.z, sp, false); else follow(s, e, s.fieldP, sp); };
  const toNoise = sp => { if (c.noiseAge < 600 && dist(e.x, e.z, c.noiseX, c.noiseZ) > 400) { if (!follow(s, e, s.fieldN, sp)) steer(s, e, c.noiseX, c.noiseZ, sp, false); return true; } return false; };
  const wander = sp => { if (--e.timer <= 0) { e.timer = 90 + rand(s) % 180; e.tx = e.hx + (rand(s) % 4096) - 2048; e.tz = e.hz + (rand(s) % 4096) - 2048; } steer(s, e, e.tx, e.tz, sp, false); };
  switch (e.type) {
    case ET.FORSAKER: case ET.COMER:
      if (hears) { if (e.mode !== 1) emit(s, 'alert', e.x, e.z, e.type); e.mode = 1; e.aux = 240; }
      if (e.mode === 1) { if (p.hum && d < 2400 && e.type === ET.FORSAKER) steer(s, e, e.x * 2 - p.x, e.z * 2 - p.z, speed, false); else if (d < 3 * UNIT) chase(speed); else if (!toNoise(speed) && --e.aux <= 0) e.mode = 0; }
      else wander(speed >> 1);
      break;
    case ET.CROWNED: case ET.TRAMPLER: chase(speed); break;
    case ET.SIGH:
      steer(s, e, p.x, p.z, speed, true);
      if (d < 1800 && p.breath > 0) { p.breath = Math.max(0, p.breath - 5); if (s.tick % 30 === 0) emit(s, 'sigh', e.x, e.z); }
      break;
    case ET.MIRTH:
      if (c.phase !== 1) { e.mode = 0; break; }
      if (e.mode === 0) { e.mode = 1; emit(s, 'alert', e.x, e.z, e.type); }
      if ((s.tick + e.hx) % 50 < 34) chase(speed);
      break;
    case ET.TRIUNE:
      if (hears) { if (e.mode !== 1) emit(s, 'alert', e.x, e.z, e.type); e.mode = 1; e.aux = 200; }
      else if (e.mode === 1 && --e.aux <= 0) e.mode = 0;
      if (e.mode === 1) chase(speed); else if (!toNoise(speed >> 1)) wander(speed >> 2);
      break;
    case ET.HUSK:
      if (!p.hold && d < 2300) { if (++e.aux > 55 && e.mode === 0) { e.mode = 1; emit(s, 'alert', e.x, e.z, e.type); } } else if (e.aux > 0) e.aux--;
      if (e.mode === 1) { if (p.hold || d > 5 * UNIT) { if (e.aux === 0) e.mode = 2; } else chase(speed); }
      if (e.mode === 2) { steer(s, e, e.hx, e.hz, speed, false); if (dist(e.x, e.z, e.hx, e.hz) < 60) e.mode = 0; }
      break;
    case ET.BUILDER:
      if (hears) e.mode = 1;
      if (e.mode === 1) { if (d < 1400) steer(s, e, p.x, p.z, speed, false); else if (!toNoise(speed)) e.mode = 0; } else wander(speed >> 1);
      break;
    case ET.MARCHER: {
      if (p.marked > 0 && d < 4 * UNIT) { chase(speed + 8); break; }
      const nx = e.x + speed; // the march flows east and wraps
      if (blocked(s, nx, e.z, 260)) { e.x = UNIT + 512; e.aux = 0; } else e.x = nx;
      e.ang = 0; break;
    }
    case ET.CHORISTER:
      if (c.phase !== 1) { e.mode = 0; break; }
      if (d < 7 * UNIT && lineOfSight(s, e.x, e.z, p.x, p.z)) { if (e.mode !== 1) emit(s, 'alert', e.x, e.z, e.type); e.mode = 1; e.aux = 180; } else if (e.mode === 1 && --e.aux <= 0) e.mode = 0;
      if (e.mode === 1) chase(speed); else wander(speed >> 1);
      break;
    default: break;
  }
  const solidNow = !((e.type === ET.CHORISTER || e.type === ET.MIRTH) && c.phase !== 1);
  const awake = e.type !== ET.HUSK || e.mode === 1;
  if (dmg > 0 && solidNow && awake && d < 640 && (e.type !== ET.MARCHER || p.marked > 0)) hurt(s, dmg, e.x, e.z);
}

/** Advance one tick. `input` is a packed integer from packInput(). */
export function step(s, input) {
  if (s.c.dead || s.c.done) { s.tick++; return s; }
  const ox = s.p.x;
  stepPlayer(s, input | 0);
  if (s.def.rule & RULE.MULTITUDE) { // voice, or walking against the flow beside a marcher, marks you
    const p = s.p; let near = false; for (const e of s.ents) if (dist(p.x, p.z, e.x, e.z) < 2600) { near = true; break; }
    if (p.hum || p.noise >= TUNE.noiseChord || (near && p.x - ox < -6)) { if (!p.marked) emit(s, 'marked', p.x, p.z); p.marked = 240; } else if (p.marked > 0) p.marked--;
  }
  stepRules(s);
  if (s.tick % 12 === 0) flood(s, s.fieldP, s.p.x >> 10, s.p.z >> 10);
  for (let i = 0; i < s.ents.length; i++) stepEntity(s, s.ents[i]);
  s.tick++;
  return s;
}

/** Canonical state: fixed field order, Int32, hashed little-endian. */
export function serialize(s) {
  const out = [SCHEMA, s.def.id, s.tick, s.rng | 0, s.w, s.h];
  for (const f of P_FIELDS) out.push(s.p[f]); for (const f of C_FIELDS) out.push(s.c[f]);
  out.push(s.picks.length); for (const m of s.picks) out.push(m.taken);
  out.push(s.ents.length); for (const e of s.ents) for (const f of E_FIELDS) out.push(e[f]);
  for (let i = 0; i < s.dyn.length; i++) out.push(s.dyn[i]);
  return Int32Array.from(out);
}
export const hashState = s => fnv1a(serialize(s));

/** Restore a state produced by serialize(). The next random draw is preserved. Pass `def` for non-campaign maps. */
export function deserialize(ints, def = null) {
  if (ints[0] !== SCHEMA) throw new Error('save schema ' + ints[0] + ' != ' + SCHEMA);
  const s = createSim(def || ints[1] - 1, 1); let o = 2;
  s.tick = ints[o++]; s.rng = ints[o++] >>> 0; o += 2;
  for (const f of P_FIELDS) s.p[f] = ints[o++]; for (const f of C_FIELDS) s.c[f] = ints[o++];
  const np = ints[o++]; for (let i = 0; i < np; i++) s.picks[i].taken = ints[o++];
  const ne = ints[o++]; s.ents = [];
  for (let i = 0; i < ne; i++) { const e = {}; for (const f of E_FIELDS) e[f] = ints[o++]; s.ents.push(e); }
  for (let i = 0; i < s.dyn.length; i++) s.dyn[i] = ints[o++];
  flood(s, s.fieldP, s.p.x >> 10, s.p.z >> 10); if (s.c.noiseAge < 600) flood(s, s.fieldN, s.c.noiseX >> 10, s.c.noiseZ >> 10);
  return s;
}
