// Post-launch expansion hook: "The Endless Choir". Deterministic, integer-only verse generator.
// A run is (seed, depth); every verse is regenerated from those two integers, so endless runs save,
// replay and reproduce crashes exactly like the campaign. Verses reuse the campaign's rules and
// threats and escalate with depth.
import { xorshift } from './fixed.js';
import { RULE } from './chapters.js';

const W = 27, H = 17;
// verse kinds cycle with depth; each borrows a campaign chapter's theme (atmosphere, audio bed, stanza)
const KINDS = [
  { rule: 0, theme: 3, title: 'Ruins', enemy: 'fs', hint: 'Find the measures. The ruin remembers Nineveh.' },
  { rule: RULE.BREATH_HUNT, theme: 4, title: 'Breath', enemy: 'h', boss: '3', hint: 'Hold SHIFT near the husks. It hears you breathing.' },
  { rule: RULE.BRAZIERS, theme: 5, title: 'Flame', enemy: 'u', hint: 'Light every brazier. Humming gutters the flame.' },
];

/** @returns a chapter definition accepted by createSim(). */
export function endlessVerse(seed, depth) {
  let r = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(depth + 1, 0x85ebca6b)) >>> 0 || 1; const rnd = n => { r = xorshift(r); return r % n; };
  const kind = KINDS[(depth - 1) % KINDS.length], g = Array.from({ length: H }, () => Array(W).fill('#'));
  // rooms on a 4 x 2 lattice of slots
  const rooms = [];
  for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 4; sx++) {
    const w = 3 + rnd(3), h = 3 + rnd(3), x0 = 1 + sx * 6 + rnd(6 - w), y0 = 1 + sy * 8 + rnd(7 - h);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g[y][x] = '.';
    rooms.push({ x0, y0, w, h, cx: x0 + (w >> 1), cy: y0 + (h >> 1) });
  }
  const carve = (a, b) => { let x = a.cx, y = a.cy; const hFirst = rnd(2); const stepX = () => { while (x !== b.cx) { x += Math.sign(b.cx - x); g[y][x] = '.'; } }, stepY = () => { while (y !== b.cy) { y += Math.sign(b.cy - y); g[y][x] = '.'; } }; if (hFirst) { stepX(); stepY(); } else { stepY(); stepX(); } };
  // random spanning tree over the slot graph, plus one extra loop for escape routes
  const linked = [0], order = [1, 2, 3, 4, 5, 6, 7];
  for (let i = order.length - 1; i > 0; i--) { const j = rnd(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  for (const k of order) { const near = linked.filter(l => Math.abs((l % 4) - (k % 4)) + Math.abs((l >> 2) - (k >> 2)) === 1); const from = near.length ? near[rnd(near.length)] : linked[rnd(linked.length)]; carve(rooms[from], rooms[k]); linked.push(k); }
  carve(rooms[rnd(4)], rooms[4 + rnd(4)]);
  // start in a corner slot; exit beside the room farthest from it (BFS)
  const start = rooms[0], dist = Array.from({ length: H }, () => Array(W).fill(-1)), q = [[start.cx, start.cy]]; dist[start.cy][start.cx] = 0;
  while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (g[ny]?.[nx] === '.' && dist[ny][nx] < 0) { dist[ny][nx] = dist[y][x] + 1; q.push([nx, ny]); } } }
  const byFar = rooms.map((rm, i) => [dist[rm.cy][rm.cx], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(e => e[1]);
  const exitRoom = rooms[byFar[0]];
  let gx = exitRoom.x0 + exitRoom.w, gy = exitRoom.cy; if (gx >= W - 1) gx = W - 1; for (let x = exitRoom.x0 + exitRoom.w; x < gx; x++) g[gy][x] = '.';
  if (gx < W - 1) { for (let x = exitRoom.x0 + exitRoom.w; x < W - 1; x++) g[gy][x] = '.'; gx = W - 1; }
  g[gy][gx] = 'X'; g[start.cy][start.cx] = 'P';
  // objectives in the far rooms (never the start room)
  const objRooms = byFar.filter(i => i !== 0).slice(0, 4);
  let need = 0;
  if (kind.rule & RULE.BRAZIERS) for (const i of objRooms.slice(0, 3)) { const rm = rooms[i]; if (rm.w >= 3 && rm.h >= 3) { g[rm.cy][rm.cx] = 'B'; need++; } }
  else { need = Math.min(3 + (depth > 6 ? 1 : 0), objRooms.length); for (const i of objRooms.slice(0, need)) { const rm = rooms[i]; g[rm.y0][rm.x0 + rm.w - 1] = 'M'; } }
  // threats escalate with depth; never in the start room
  const count = kind.rule & RULE.BREATH_HUNT ? Math.min(1 + (depth >> 2), 4) : Math.min(2 + (depth >> 1), 7), spots = [];
  for (let i = 1; i < rooms.length; i++) { const rm = rooms[i]; spots.push([rm.x0, rm.y0 + rm.h - 1]); }
  for (let i = 0; i < count && spots.length; i++) { const [x, y] = spots.splice(rnd(spots.length), 1)[0]; if (g[y][x] === '.') g[y][x] = kind.enemy[i % kind.enemy.length]; }
  if (kind.boss && depth >= 8) { const rm = rooms[byFar[1]]; if (g[rm.cy][rm.cx] === '.') g[rm.cy][rm.cx] = kind.boss; }
  const map = g.map(row => row.join(''));
  return { id: kind.theme, title: `Endless Choir — Verse ${depth} (${kind.title})`, rule: kind.rule, need: kind.rule & RULE.BRAZIERS ? 0 : need, indoor: 1, dark: kind.rule & RULE.BRAZIERS ? 1 : 0, hint: kind.hint, endless: { seed: seed | 0, depth }, map };
}

/** A weekly challenge seed shared by every player: ISO week number of the given date (UTC). */
export function weeklySeed(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear(), week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7); return y * 100 + week;
}
