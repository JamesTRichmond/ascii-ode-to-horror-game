// Deterministic autoplayer. Integer-only and driven purely by simulation state, so a bot run is a
// reproducible input log. Used for: completability tests, benchmarks, attract mode.
import { UNIT, iatan2, angDiff, isqrt } from './fixed.js';
import { IN, ET, TILE, TUNE, packInput, flood, solidAt, inShade } from './sim.js';
import { RULE } from './chapters.js';

export function createBot(opts = {}) { return { field: null, goal: -1, gx: 0, gz: 0, plan: 0, humTicks: 0, wait: 0, lastX: 0, lastZ: 0, still: 0, shake: 0, fIndex: 0, ending: opts.ending || 2, use: 0 }; }
const dist = (ax, az, bx, bz) => isqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));

function nearest(s, field, cells) { let best = -1, bd = 32767; for (const c of cells) if (field[c] < bd) { bd = field[c]; best = c; } return best; }
function neighbours(s, cell) { const x = cell % s.w, z = (cell / s.w) | 0, out = []; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!solidAt(s, x + dx, z + dz)) out.push((z + dz) * s.w + x + dx); return out; }

function replan(bot, s) {
  const p = s.p, rule = s.def.rule, n = s.w * s.h, me = new Int16Array(n); flood(s, me, p.x >> 10, p.z >> 10);
  const targets = []; bot.use = -1;
  for (const m of s.picks) if (!m.taken) targets.push((m.z >> 10) * s.w + (m.x >> 10));
  if (rule & RULE.BRAZIERS) for (let i = 0; i < n; i++) if (s.tiles[i] === TILE.BRAZ && (p.flame ? !s.dyn[i] : s.dyn[i])) for (const c of neighbours(s, i)) { targets.push(c); }
  if (rule & RULE.FINALE && bot.ending === 1) { targets.length = 0; for (const e of s.ents) if (e.type === ET.SLUMBERER) for (const c of neighbours(s, (e.z >> 10) * s.w + (e.x >> 10))) targets.push(c); }
  else if (s.c.gateOpen && !targets.some(c => me[c] < 32767)) for (let i = 0; i < n; i++) if (s.tiles[i] === TILE.GATE) targets.push(i);
  let goal = nearest(s, me, targets);
  bot.humTicks = 0;
  if (goal < 0) { // nothing reachable: use the chapter's rule to change the map
    if (rule & RULE.FOUNDATIONS) {
      const fs = []; for (let i = 0; i < n; i++) if (s.tiles[i] === TILE.FOUND) for (const c of neighbours(s, i)) if (me[c] < 32767) { fs.push(c); break; }
      if (fs.length) { goal = fs[bot.fIndex % fs.length]; if (goal === (p.z >> 10) * s.w + (p.x >> 10)) { bot.humTicks = TUNE.toggleHum + 4; bot.fIndex++; } }
    } else if (rule & RULE.LAYERS) bot.humTicks = TUNE.layerHum + 4;
    else bot.wait = 20;
  }
  bot.goal = goal;
  if (goal >= 0) { bot.field = bot.field && bot.field.length === n ? bot.field : new Int16Array(n); flood(s, bot.field, goal % s.w, (goal / s.w) | 0); }
}

/** One input word for the current state. */
export function botInput(bot, s) {
  const p = s.p, rule = s.def.rule, cx = p.x >> 10, cz = p.z >> 10, here = cz * s.w + cx; let buttons = 0;
  if (s.c.dead || s.c.done) return 0;
  if (bot.humTicks > 0) { bot.humTicks--; if (bot.humTicks === 0) bot.plan = 0; return packInput(IN.HUM, 0); }
  if (--bot.plan <= 0 || bot.goal === here) { replan(bot, s); bot.plan = 20; if (bot.humTicks > 0) return packInput(IN.HUM, 0); }
  if (rule & RULE.FINALE && bot.ending === 1) for (const e of s.ents) if (e.type === ET.SLUMBERER && dist(p.x, p.z, e.x, e.z) < 2100) return packInput(p.breath > 40 ? IN.HUM : 0, 0);
  // threat response
  let nearD = 1e9, nearE = null; for (const e of s.ents) { if (e.mode === 9 || e.type === ET.SLUMBERER || e.type === ET.HUSK && e.mode === 0) continue; if (e.type === ET.MARCHER && !p.marked) continue; const d = dist(p.x, p.z, e.x, e.z); if (d < nearD) { nearD = d; nearE = e; } }
  if (rule & RULE.BREATH_HUNT) { let hunted = false; for (const e of s.ents) { const d = dist(p.x, p.z, e.x, e.z); if ((e.type === ET.TRIUNE && d < 7 * UNIT) || (e.type === ET.HUSK && d < 2600)) hunted = true; } if (hunted && p.breath > 120 && p.gasp === 0) buttons |= IN.HOLD; }
  if (nearE && nearD < 1500 && !(rule & RULE.MULTITUDE) && !(buttons & IN.HOLD) && p.cooldown === 0 && p.breath >= TUNE.chordCost) {
    const diff = angDiff(p.ang, iatan2(nearE.z - p.z, nearE.x - p.x));
    if (Math.abs(diff) < 600 || nearD < UNIT) buttons |= IN.CHORD; else return packInput(buttons, Math.max(-300, Math.min(300, diff)));
  }
  // dawn: shelter during warning and surge
  let tx, tz;
  if (rule & RULE.DAWN && s.c.stage !== 0) {
    if (inShade(s, cx, cz)) return packInput(0, 0);
    const me = new Int16Array(s.w * s.h); flood(s, me, cx, cz); let best = -1, bd = 32767;
    for (let i = 0; i < me.length; i++) if (me[i] < bd && inShade(s, i % s.w, (i / s.w) | 0)) { bd = me[i]; best = i; }
    if (best >= 0) { const f = new Int16Array(s.w * s.h); flood(s, f, best % s.w, (best / s.w) | 0); [tx, tz] = nextCell(s, f, cx, cz); }
  }
  if (tx === undefined) {
    if (bot.goal < 0 || bot.wait > 0) { if (bot.wait > 0) bot.wait--; return packInput(buttons, 0); }
    [tx, tz] = nextCell(s, bot.field, cx, cz);
    if (rule & RULE.BRAZIERS && bot.goal === here) { // face and use the brazier beside the goal cell
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const i = (cz + dz) * s.w + cx + dx; if (s.tiles[i] === TILE.BRAZ) { tx = (cx + dx) * UNIT + 512; tz = (cz + dz) * UNIT + 512; buttons |= IN.USE; } }
    }
  }
  const diff = angDiff(p.ang, iatan2(tz - p.z, tx - p.x)), turn = Math.max(-260, Math.min(260, diff));
  if (Math.abs(diff) < 420) buttons |= IN.FWD;
  // unstick
  if (p.x === bot.lastX && p.z === bot.lastZ) bot.still++; else bot.still = 0; bot.lastX = p.x; bot.lastZ = p.z;
  if (bot.still > 45 && !(buttons & IN.USE)) { bot.shake = 24; bot.still = 0; }
  if (bot.shake > 0) { bot.shake--; buttons |= (s.tick >> 5) & 1 ? IN.LEFT : IN.RIGHT; buttons |= IN.BACK; buttons &= ~IN.FWD; }
  return packInput(buttons, turn);
}
function nextCell(s, f, cx, cz) {
  const i = cz * s.w + cx; let best = f[i], bx = cx, bz = cz;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= s.w || z >= s.h) continue; const v = f[z * s.w + x]; if (v < best) { best = v; bx = x; bz = z; } }
  return [bx * UNIT + 512, bz * UNIT + 512];
}
