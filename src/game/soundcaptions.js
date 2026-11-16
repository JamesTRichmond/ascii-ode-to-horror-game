// Directional sound captions (audio description for deaf and hard-of-hearing players). Every sound the game makes
// that carries information gets a caption with a bearing relative to where the player faces and a distance band.
// Pure functions; the HUD renders them.
import { ET } from '../sim/sim.js';

const WHO = { [ET.FORSAKER]: 'a Forsaker', [ET.CROWNED]: 'the Crowned', [ET.TRAMPLER]: 'a Trampler', [ET.SIGH]: 'a Sigh', [ET.MIRTH]: 'Mirth', [ET.TRIUNE]: 'the Three-in-One', [ET.HUSK]: 'a Husk', [ET.BUILDER]: 'a Blind Builder', [ET.MARCHER]: 'the Multitude', [ET.CHORISTER]: 'a Chorister', [ET.COMER]: 'a Comer', [ET.SLUMBERER]: 'the Slumberer' };
const CRY = { [ET.FORSAKER]: 'shrieks', [ET.CROWNED]: 'bellows', [ET.TRAMPLER]: 'snorts', [ET.SIGH]: 'breathes in', [ET.MIRTH]: 'laughs', [ET.TRIUNE]: 'inhales', [ET.HUSK]: 'creaks', [ET.BUILDER]: 'grinds its teeth', [ET.MARCHER]: 'turn as one', [ET.CHORISTER]: 'sings out', [ET.COMER]: 'calls', [ET.SLUMBERER]: 'murmurs' };
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'], WORDS = ['ahead', 'ahead right', 'right', 'behind right', 'behind', 'behind left', 'left', 'ahead left'];

/** Bearing of a world point from the player: degrees clockwise from straight ahead (-180..180], and distance in cells. */
export function bearing(p, x, z) {
  const th = (p.ang / 4096) * Math.PI * 2, dx = x - p.x, dz = z - p.z, fwd = dx * Math.cos(th) + dz * Math.sin(th), right = -dx * Math.sin(th) + dz * Math.cos(th);
  return { deg: (Math.atan2(right, fwd) * 180) / Math.PI, cells: Math.hypot(dx, dz) / 1024 };
}
export function direction(deg) { const i = ((Math.round(deg / 45) % 8) + 8) % 8; return { arrow: ARROWS[i], word: WORDS[i] }; }
const band = cells => (cells < 4 ? 'near' : cells < 9 ? 'close' : 'far');

/** @returns {text, arrow, key} for a simulation event, or null when the event makes no sound worth captioning. */
export function captionFor(e, p) {
  const at = () => { const b = bearing(p, e.x, e.z), d = direction(b.deg); return { arrow: d.arrow, where: `${d.word}, ${band(b.cells)}` }; };
  const placed = (text, key) => { const a = at(); return { text: `${text} — ${a.where}`, arrow: a.arrow, key }; };
  const flat = (text, key = text) => ({ text, arrow: '•', key });
  switch (e.type) {
    case 'alert': return placed(`${cap(WHO[e.a] || 'something')} ${CRY[e.a] || 'stirs'}`, `alert${e.a}`);
    case 'stagger': return placed(`${cap(WHO[e.a] || 'something')} reels`, `stagger${e.a}`);
    case 'unwritten': return placed('Something comes unwritten', 'unwritten');
    case 'sigh': return placed('A long sigh', 'sigh');
    case 'wall': return placed('Stone grinds as walls move', 'wall');
    case 'trample': return placed('Hooves strike in triple time', 'trample');
    case 'brazier': return placed('A brazier catches', 'brazier');
    case 'wake': return placed('The sleeper stirs', 'wake');
    case 'hurt': return flat('You are struck', 'hurt');
    case 'chord': return flat('Your chord rings out', 'chord');
    case 'gate': return flat('A deep tone: the way opens', 'gate');
    case 'phaseWarn': return flat('A low drone rises', 'phaseWarn');
    case 'phase': return flat('The air rushes and the age turns', 'phase');
    case 'surgeWarn': return flat('A rising cry: shelter now', 'surgeWarn');
    case 'surge': return flat('Searing hiss of the dawn', 'surge');
    case 'marked': return flat('A rasping chorus: they have seen you', 'marked');
    case 'gutter': return flat('Your flame sputters', 'gutter');
    case 'relight': return flat('Your flame whooshes back', 'relight');
    case 'gasp': return flat('You gasp for air', 'gasp');
    case 'measure': return flat('A phrase of music returns', 'measure');
    default: return null;
  }
}
const cap = s => s[0].toUpperCase() + s.slice(1);

/** The heartbeat the audio plays: same threat rules as audio.js. @returns null when calm, else a caption for it. */
export function heartbeatCaption(sim) {
  const p = sim.p; let near = 1e9, src = null;
  for (const e of sim.ents) {
    if (e.mode === 9 || e.type === ET.SLUMBERER || (e.type === ET.MARCHER && !p.marked) || (e.type === ET.HUSK && e.mode === 0) || ((e.type === ET.CHORISTER || e.type === ET.MIRTH) && sim.c.phase !== 1)) continue;
    const d = Math.hypot(e.x - p.x, e.z - p.z) / 1024; if (d < near) { near = d; src = e; }
  }
  const fear = Math.max(0, Math.min(1, 1 - near / 7)); if (fear < 0.35 || !src) return null;
  const d = direction(bearing(p, src.x, src.z).deg);
  return { text: `Your heart ${fear > 0.75 ? 'pounds' : 'races'} — ${cap(WHO[src.type] || 'something')} ${d.word}`, arrow: d.arrow, key: 'heart' };
}

/** A small stack of recent captions: repeats merge ("×2") instead of flooding; each lives `ttl` seconds. */
export function createCaptionStack(max = 3, ttl = 2.6) {
  const S = { items: [] };
  S.push = c => { if (!c) return; const same = S.items.find(i => i.key === c.key); if (same) { same.count++; same.text = c.text; same.arrow = c.arrow; same.t = ttl; return; } S.items.unshift({ ...c, count: 1, t: ttl }); if (S.items.length > max) S.items.pop(); };
  S.tick = dt => { for (const i of S.items) i.t -= dt; S.items = S.items.filter(i => i.t > 0); };
  S.lines = () => S.items.map(i => `${i.arrow} [${i.text}]${i.count > 1 ? ` ×${i.count}` : ''}`);
  return S;
}
