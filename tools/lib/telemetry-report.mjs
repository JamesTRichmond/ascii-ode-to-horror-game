// Live-ops aggregation of opt-in telemetry (schema 1, docs/LIVE_OPS.md). Input: events from a collector (JSON array
// or JSON Lines) or players' copied diagnostic reports ({events: [...]}). Output: a completion funnel per chapter,
// death heatmaps drawn as glyph art over each chapter's own map, endings, performance by tier, and grouped crashes.
import { CHAPTERS } from '../../src/sim/chapters.js';

/** Accepts JSON array, JSON Lines, a diagnostic report, or an array of reports; returns a flat event list. */
export function parseEvents(text) {
  const t = String(text).trim(); if (!t) return [];
  const flat = v => (Array.isArray(v) ? v.flatMap(flat) : v && Array.isArray(v.events) ? v.events : v && v.type ? [v] : []);
  try { return flat(JSON.parse(t)); } catch { /* not one JSON document: try JSON Lines */ }
  return t.split('\n').filter(Boolean).flatMap(line => { try { return flat(JSON.parse(line)); } catch { return []; } });
}
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

export function aggregate(events) {
  const ev = events.filter(e => e && e.schema === 1), sessions = new Set(ev.map(e => e.session)), chapters = CHAPTERS.map(c => ({ chapter: c.id, title: c.title, starts: 0, completes: 0, deaths: 0, ticks: [] }));
  const heat = Object.fromEntries(CHAPTERS.map(c => [c.id, new Map()])), endings = { 1: 0, 2: 0 }, perf = {}, crashes = new Map(); let endless = { runs: 0, deepest: 0 };
  for (const e of ev) {
    const ch = chapters[(e.chapter | 0) - 1];
    if (e.type === 'chapter_start' && ch) ch.starts++;
    else if (e.type === 'chapter_complete' && ch) { ch.completes++; if (Number.isFinite(e.tick)) ch.ticks.push(e.tick); }
    else if (e.type === 'death' && ch) { ch.deaths++; if (Number.isInteger(e.cx) && Number.isInteger(e.cz)) { const k = `${e.cx},${e.cz}`, m = heat[ch.chapter]; m.set(k, (m.get(k) || 0) + 1); } }
    else if (e.type === 'ending' && endings[e.ending] !== undefined) endings[e.ending]++;
    else if (e.type === 'perf') { const p = (perf[e.tier] ||= { n: 0, p50: [], p95: [] }); p.n++; const a = e.intervalP50 ?? e.p50, b = e.intervalP95 ?? e.p95; if (Number.isFinite(a)) p.p50.push(a); if (Number.isFinite(b)) p.p95.push(b); }
    else if (e.type === 'crash') { const k = String(e.message || '?').slice(0, 120); crashes.set(k, (crashes.get(k) || 0) + 1); }
    else if (e.type === 'endless_end') { endless.runs++; endless.deepest = Math.max(endless.deepest, e.depth | 0); }
  }
  return {
    events: ev.length, sessions: sessions.size,
    funnel: chapters.map(({ ticks, ...c }) => ({ ...c, completionRate: c.starts ? c.completes / c.starts : null, medianSeconds: ticks.length ? +(median(ticks) / 60).toFixed(1) : null })),
    heat: Object.fromEntries(Object.entries(heat).map(([k, m]) => [k, Object.fromEntries(m)])), endings, endless,
    perf: Object.fromEntries(Object.entries(perf).map(([t, p]) => [t, { reports: p.n, medianP50: median(p.p50), medianP95: median(p.p95), holds30fps: median(p.p95) !== null ? median(p.p95) <= 33.4 : null }])),
    crashes: [...crashes].sort((a, b) => b[1] - a[1]).map(([message, count]) => ({ message, count })),
  };
}

const RAMP = ' .:-=+*#%@';
/** A chapter's map with deaths drawn over it: walls as ░, floor as ·, death density as the glyph ramp. */
export function heatmap(chapterId, cells) {
  const def = CHAPTERS[chapterId - 1], max = Math.max(1, ...Object.values(cells || {}));
  return def.map.map((row, z) => [...row].map((ch, x) => { const n = cells?.[`${x},${z}`] || 0; if (n) return RAMP[Math.min(RAMP.length - 1, 1 + Math.floor((n / max) * (RAMP.length - 2)))]; return '#Ir='.includes(ch) ? '░' : 't'.includes(ch) ? '♣' : '~'.includes(ch) ? '≈' : 'X'.includes(ch) ? '⌂' : '·'; }).join('')).join('\n');
}
export function renderReport(agg) {
  const pct = v => (v === null ? '—' : `${Math.round(v * 100)}%`), out = [`ODE telemetry report — ${agg.events} events, ${agg.sessions} sessions`, '', 'Chapter funnel', 'ch  starts  completes  rate  deaths  median time  title'];
  for (const c of agg.funnel) out.push(`${String(c.chapter).padStart(2)}  ${String(c.starts).padStart(6)}  ${String(c.completes).padStart(9)}  ${pct(c.completionRate).padStart(4)}  ${String(c.deaths).padStart(6)}  ${(c.medianSeconds === null ? '—' : c.medianSeconds + ' s').padStart(11)}  ${c.title}`);
  out.push('', `Endings: sing ${agg.endings[1]}, silence ${agg.endings[2]} · Endless runs ${agg.endless.runs}, deepest verse ${agg.endless.deepest}`, '', 'Performance (frame interval ms, median of reports)');
  for (const [t, p] of Object.entries(agg.perf)) out.push(`  ${t.padEnd(6)} reports ${p.reports}  p50 ${p.medianP50 ?? '—'}  p95 ${p.medianP95 ?? '—'}  ${p.holds30fps === null ? '' : p.holds30fps ? 'holds 30 fps' : 'BELOW 30 fps'}`);
  out.push('', 'Crashes'); if (!agg.crashes.length) out.push('  none'); for (const c of agg.crashes) out.push(`  ${String(c.count).padStart(4)} × ${c.message}`);
  for (const c of agg.funnel) if (c.deaths) out.push('', `Deaths — chapter ${c.chapter}, ${c.title} (${c.deaths}; ${RAMP.slice(1)} = rising density)`, heatmap(c.chapter, agg.heat[c.chapter]));
  return out.join('\n');
}
