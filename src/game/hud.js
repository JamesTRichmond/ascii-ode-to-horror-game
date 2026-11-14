// Player HUD and menus (guide phase 6, task 5-2). DOM text above the glyph field: every state is
// carried by a label and a shape as well as colour, everything is keyboard reachable, and the
// critical meters stay visible regardless of what the renderer is doing.
import { TUNE, ET } from '../sim/sim.js';

const $ = id => document.getElementById(id);
const NAMES = { [ET.FORSAKER]: 'FORSAKER', [ET.CROWNED]: 'THE CROWNED', [ET.TRAMPLER]: 'TRAMPLER', [ET.SIGH]: 'A SIGH', [ET.MIRTH]: 'MIRTH', [ET.TRIUNE]: 'THE THREE-IN-ONE', [ET.HUSK]: 'HUSK', [ET.BUILDER]: 'BLIND BUILDER', [ET.MARCHER]: 'THE MULTITUDE', [ET.CHORISTER]: 'CHORISTER', [ET.COMER]: 'A COMER', [ET.SLUMBERER]: 'THE SLUMBERER' };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createHud() {
  const hud = { captionQueue: [], captionTimer: 0, alertTimer: 0, last: {} };
  const set = (el, key, value, fn) => { if (hud.last[key] !== value) { hud.last[key] = value; fn(el, value); } };
  const bar = (id, pct) => set($(id), id, Math.round(pct), (el, v) => { el.firstElementChild.style.width = v + '%'; el.setAttribute('aria-valuenow', v); });

  hud.show = on => { $('hud').hidden = !on; };
  hud.setChapter = (def, total) => { $('chapterKicker').textContent = `CHAPTER ${def.id} OF ${total} · STANZA ${def.id}`; $('chapterTitle').textContent = def.title.toUpperCase(); hud.last = {}; $('caption').textContent = ''; $('alert').textContent = ''; hud.captionQueue = []; };
  hud.caption = (lines, seconds = 3.2) => { for (const l of [].concat(lines)) hud.captionQueue.push([l, seconds]); };
  hud.pain = () => { hud.hurt = 0.8; };
  hud.alert = (text, seconds = 2.4) => { $('alert').textContent = text; hud.alertTimer = seconds; };

  hud.update = (sim, dt, captions = true) => {
    const p = sim.p, c = sim.c, def = sim.def;
    bar('hpBar', (p.hp / TUNE.hpMax) * 100); set($('hpText'), 'hp', p.hp, (el, v) => { el.textContent = v; });
    bar('brBar', (p.breath / TUNE.breathMax) * 100); set($('brText'), 'br', Math.round(p.breath / 10), (el, v) => { el.textContent = v; });
    const need = def.rule & 16 ? sim.braziers : def.need, have = def.rule & 16 ? c.lit : p.measures;
    set($('measures'), 'meas', have + '/' + need, el => { el.textContent = need ? '◆'.repeat(Math.min(have, need)) + '◇'.repeat(Math.max(0, need - have)) : '—'; el.setAttribute('aria-label', need ? `${have} of ${need} ${def.rule & 16 ? 'braziers lit' : 'measures found'}` : 'none required'); });
    set($('objective'), 'obj', c.gateOpen + '|' + have, el => { el.textContent = c.gateOpen ? 'The way is open. Find the gate.' : def.hint; });
    const voiced = p.breath > 0 || p.measures > 0 || !(def.rule & 1);
    const cls = (id, ready, active) => set($(id), id, (ready ? 'r' : '') + (active ? 'a' : ''), el => { el.className = 'skill' + (ready ? ' ready' : '') + (active ? ' active' : ''); });
    cls('skHum', voiced && p.breath > 0 && !p.gasp, !!p.hum); cls('skChord', voiced && p.cooldown === 0 && p.breath >= TUNE.chordCost && !p.gasp, p.cooldown > TUNE.chordCooldown - 12); cls('skHold', p.breath > 0 && !p.gasp, !!p.hold); cls('skUse', !!(def.rule & 16), false);
    const tags = [];
    if (p.hum) tags.push(['good', '♪ HUMMING']); if (p.hold) tags.push(['good', '◌ BREATH HELD']); if (p.gasp) tags.push(['bad', '! GASPING']);
    if (p.marked) tags.push(['bad', '✕ MARKED']); if (def.rule & 16) tags.push(p.flame ? ['warn', '▲ FLAME'] : ['bad', '△ FLAME OUT']);
    if (def.rule & 4) tags.push(['warn', c.phase ? '◐ BABEL · BEING BORN' : '◑ NINEVEH · DYING']); if (def.rule & 64) tags.push(['warn', c.phase ? '◈ APART' : '◇ AMONG']);
    if (def.rule & 128) tags.push(c.stage === 2 ? ['bad', '☀ THE DAWN — SHADOW!'] : c.stage === 1 ? ['warn', '☼ THE CRY GOES UP'] : ['good', '☾ CALM']);
    if (!voiced) tags.push(['warn', '∅ VOICELESS']);
    set($('tags'), 'tags', tags.map(t => t[1]).join('|'), el => { el.innerHTML = tags.map(([k, t]) => `<span class="tag ${k}">${esc(t)}</span>`).join(''); });
    // nearest threat: always-visible proximity meter with a name
    let best = null, bd = 1e9; for (const e of sim.ents) { if (e.mode === 9 || (e.type === ET.HUSK && e.mode === 0) || (e.type === ET.MARCHER && !p.marked)) continue; const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < bd) { bd = d; best = e; } }
    const show = !!best && bd < 12 * 1024; set($('threatPanel'), 'thr', show, (el, v) => { el.hidden = !v; });
    if (show) {
      const sl = best.type === ET.SLUMBERER; set($('threatLabel'), 'thl', best.type + ':' + best.mode + (sl ? c.sing : ''), el => { el.textContent = sl ? 'THE SLUMBERER · WAKING' : NAMES[best.type] + (best.mode === 8 ? ' · STAGGERED' : best.mode === 1 ? ' · HUNTING' : ' · NEAR'); });
      bar('threatBar', sl ? (c.sing / TUNE.slumberHum) * 100 : Math.max(0, 100 - (bd / (12 * 1024)) * 100));
    }
    // resonance: while humming, the voice finds the nearest unclaimed measure, unlit brazier or open gate
    let res = '';
    if (p.hum) {
      let tx = 0, tz = 0, bd2 = Infinity;
      const consider = (x, z) => { const d2 = (x - p.x) ** 2 + (z - p.z) ** 2; if (d2 < bd2) { bd2 = d2; tx = x; tz = z; } };
      for (const m of sim.picks) if (!m.taken) consider(m.x, m.z);
      for (let i = 0; i < sim.tiles.length; i++) { const t = sim.tiles[i]; if ((t === 66 && !sim.dyn[i] && def.rule & 16) || (t === 88 && c.gateOpen)) consider((i % sim.w) * 1024 + 512, ((i / sim.w) | 0) * 1024 + 512); }
      if (bd2 < Infinity) { const bearing = Math.atan2(tz - p.z, tx - p.x) - (p.ang / 4096) * Math.PI * 2, rel = Math.round((((bearing / (Math.PI * 2)) % 1) + 1) % 1 * 8) % 8; res = `♪ ${['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][rel]} ${Math.round((Math.sqrt(bd2) / 1024) * 2)} m`; }
    }
    set($('resonance'), 'res', res, (el, v) => { el.textContent = v; });
    const hurt = Math.max(hud.hurt = Math.max(0, (hud.hurt || 0) - dt * 1.6), p.hp < 35 ? 0.35 + (hud.still ? 0 : 0.15 * Math.sin(performance.now() / 260)) : 0);
    set($('vignette'), 'vig', hurt.toFixed(2), (el, v) => { el.style.opacity = v; });
    if (hud.alertTimer > 0 && (hud.alertTimer -= dt) <= 0) $('alert').textContent = '';
    if (hud.captionTimer > 0) { if ((hud.captionTimer -= dt) <= 0) $('caption').textContent = ''; }
    else if (hud.captionQueue.length && captions) { const [text, secs] = hud.captionQueue.shift(); $('caption').textContent = text; hud.captionTimer = secs; }
  };

  /** Modal menu. items: [{label, action, primary, disabled}] ; body: html string. Focus is trapped while open. */
  hud.menu = (title, body, items, kicker = '') => {
    const m = $('menu'); m.hidden = false;
    m.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="menuTitle">${kicker ? `<h2>${esc(kicker)}</h2>` : ''}<h1 id="menuTitle">${esc(title)}</h1>${body || ''}<nav>${items.map((it, i) => `<button data-i="${i}" class="${it.primary ? 'primary' : ''}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}</button>`).join('')}</nav></div>`;
    m.onclick = e => { const b = e.target.closest('button[data-i]'); if (b && !b.disabled) items[+b.dataset.i].action(); };
    m.onkeydown = e => { if (e.key !== 'Tab') return; const f = [...m.querySelectorAll('button:not([disabled]),select,input')]; if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); } };
    (m.querySelector('button.primary:not([disabled])') || m.querySelector('button:not([disabled])'))?.focus();
    return m;
  };
  hud.closeMenu = () => { const m = $('menu'); m.hidden = true; m.innerHTML = ''; };
  hud.menuOpen = () => !$('menu').hidden;
  return hud;
}
