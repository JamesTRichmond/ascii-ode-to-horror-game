// Game shell: asset loading, fixed-timestep loop, event presentation, menus.
// The simulation advances in whole 60 Hz ticks from a tick-indexed input log; rendering
// interpolates between the last two snapshots and never feeds back into the simulation.
import { parseAtlas } from '../render/atlas.js';
import { createPipeline, setScene, adoptScene, renderFrame, burst, QUALITY } from '../render/pipeline.js';
import { createGLOutput } from '../render/output_gl.js';
import { compositeCPU, debugImage } from '../render/output_cpu.js';
import { CELL } from '../render/gbuffer.js';
import { createSim, step, serialize, deserialize, hashState, TICK_HZ, ET, TUNE } from '../sim/sim.js';
import { CHAPTERS, STANZAS } from '../sim/chapters.js';
import { createBot, botInput } from '../sim/bot.js';
import { viewOf, snapshot } from './view.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { loadSave, storeSave } from './save.js';
import { TICK, MAX_CATCHUP, consumeTicks } from './loop.js';
import { createAutoQuality, sampleFrame } from './quality.js';
import { createTelemetry, loadTelemetryConfig, INPUT_CAP } from './telemetry.js';
import { endlessVerse, weeklySeed } from '../sim/endless.js';

export const VERSION = '1.1.0-rc.1';
const U = CELL / 1024, $ = id => document.getElementById(id), params = new URLSearchParams(location.search);
const G = { mode: 'boot', chapter: 0, sim: null, prev: null, acc: 0, last: 0, pl: null, out: null, atlas: null, noise: null, atlasImage: null, atlasPx: null, save: loadSave(), log: [], seed: +(params.get('seed') || 100), bot: null, frames: [], intervals: [], switchRates: [], hud: createHud(), audio: createAudio(), input: null, bob: 0, hurtFlash: 0, cpu: null };
const S = () => G.save.settings;

async function loadAssets() {
  const src = globalThis.__ODE_ASSETS || { glyphs: 'assets/atlas/glyphs.bin', noise: 'assets/atlas/bluenoise.bin', atlas: 'assets/atlas/atlas.png' };
  const [bin, noise, blob] = await Promise.all([fetch(src.glyphs).then(r => r.arrayBuffer()), fetch(src.noise).then(r => r.arrayBuffer()), fetch(src.atlas).then(r => r.blob())]);
  G.atlas = parseAtlas(bin); G.noise = new Uint8Array(noise);
  G.atlasImage = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}
function applySettings() {
  const s = S(), root = document.documentElement; if (G.telemetry) G.telemetry.enabled = !!s.telemetry && !!G.telemetryConfig;
  root.style.setProperty('--scale', s.textScale); root.classList.toggle('contrast', !!s.contrast); root.classList.toggle('still', !!s.reducedMotion);
  G.audio.setVolume(s.volume); G.audio.spatial = s.spatial === 'stereo' ? 'stereo' : 'binaural'; if (G.input) G.input.sensitivity = s.sensitivity; $('stats').hidden = !s.stats; $('debug').hidden = !s.debug;
  if (s.quality === 'auto') { G.auto ||= createAutoQuality({ start: 'medium' }); } else G.auto = null;
  setTier(G.auto ? G.auto.tier : s.quality);
  G.pl.opts.reducedMotion = !!s.reducedMotion; G.hud.still = !!s.reducedMotion; storeSave(G.save);
}
function setTier(tier) {
  if (G.pl && G.pl.quality === tier) return;
  const prev = G.pl; G.pl = createPipeline(G.atlas, G.noise, tier);
  if (prev && prev.world && G.sim) adoptScene(G.pl, prev); else { if (prev) Object.assign(G.pl.opts, prev.opts); if (G.sim) setScene(G.pl, G.sim); }
  const d = $('debug'); d.width = G.pl.w; d.height = G.pl.h;
  if (G.cpu) { const c = $('view'); c.width = G.pl.w * 2; c.height = G.pl.h * 2; G.cpu.img = G.cpu.ctx.createImageData(c.width, c.height); }
}
/** A crash can leave the render pipeline in any state, so recovery never reuses it: same tier, same options, new buffers. */
function freshPipeline() { const opts = { ...G.pl.opts }; G.pl = createPipeline(G.atlas, G.noise, G.pl.quality); Object.assign(G.pl.opts, opts); }
function resize() { const c = $('view'), dpr = Math.min(2, devicePixelRatio || 1), w = Math.min(1920, Math.round(c.clientWidth * dpr)) || 1440; c.width = w; c.height = Math.round((w * 9) / 16); }

// ---------------------------------------------------------------- chapter flow
/** One pending death/completion transition, bound to the sim that raised it; any new session or the title cancels it. */
function defer(fn, ms) { clearTimeout(G.pending); const sim = G.sim; G.pending = setTimeout(() => { G.pending = 0; if (G.sim === sim && (G.mode === 'play' || G.mode === 'pause')) fn(); }, ms); }
function cancelDeferred() { clearTimeout(G.pending); G.pending = 0; }
function startEndless(seed, depth, restored = null) {
  G.endless = { seed, depth }; startChapter(-1, restored || createSim(endlessVerse(seed, depth), seed + depth), !!restored);
  if (!restored) G.telemetry?.track('endless_verse', { seed, depth });
}
function startChapter(index, restored = null, isRestore = !!restored) {
  cancelDeferred();
  if (index >= 0) G.endless = null;
  G.chapter = index; G.runSeed = index >= 0 ? G.seed + index : G.endless.seed + G.endless.depth; G.sim = restored || createSim(index, G.runSeed); G.prev = snapshot(G.sim); G.acc = 0; G.log = [];
  G.failingInput = null; G.base = isRestore ? { tick: G.sim.tick, state: Array.from(serialize(G.sim)) } : null; /* a restored run replays from its own state, not tick 0 */
  G.bot = params.get('autoplay') ? createBot({ ending: +(params.get('ending') || 2) }) : null;
  setScene(G.pl, G.sim); G.hud.setChapter(G.sim.def, CHAPTERS.length, G.endless); G.hud.closeMenu(); G.hud.show(true); G.mode = 'play'; G.input.enabled = true; G.input.reset();
  if (!isRestore) G.hud.caption(STANZAS[G.sim.def.id - 1].slice(0, 4), 2.8);
  if (index >= 0 && !isRestore) G.telemetry?.track('chapter_start', { chapter: index + 1 });
  G.audio.start(); G.audio.setChapter?.(G.sim.def.id);
}
function pause() {
  if (G.mode !== 'play') return; G.mode = 'pause'; G.input.enabled = false; document.exitPointerLock?.();
  G.hud.menu('PAUSED', `<p>${G.sim.def.title} — ${G.sim.def.hint}</p>`, [{ label: 'Resume', primary: true, action: resume }, { label: 'Settings', action: () => settingsMenu(pause0) }, { label: G.endless ? 'Restart run' : 'Restart chapter', action: restart }, { label: 'Save and quit to title', action: () => { if (!G.sim.c.dead && !G.sim.c.done) { G.save.checkpoint = { chapter: G.chapter, endless: G.endless, state: Array.from(serialize(G.sim)) }; storeSave(G.save); } title(); } }], 'ODE');
}
const pause0 = () => { G.mode = 'play'; pause(); };
/** Voluntary restart. Endless is one life per run, so it begins again at verse 1; crash recovery is separate (recoverFromCrash). */
function restart() { if (G.endless) startEndless(G.endless.seed, 1); else startChapter(G.chapter); }
function resume() { G.hud.closeMenu(); G.mode = 'play'; G.input.enabled = true; G.input.reset(); G.last = 0; }
/** Day-one patch readiness: compare the running build with the deployed version.json (same origin, no tracking). */
async function checkForUpdate() {
  try {
    const r = await fetch('version.json', { cache: 'no-store' }); if (!r.ok) return null;
    const v = await r.json(); G.deployed = v; return v.version !== VERSION ? v.version : null;
  } catch { return null; }
}
function title() {
  cancelDeferred(); G.mode = 'title'; G.input.enabled = false; G.hud.show(false); G.audio.silence?.(); const cp = G.save.checkpoint;
  G.hud.menu('ODE', `<p class="stanza">We are the music makers,\nAnd we are the dreamers of dreams…</p><p>A horror in nine stanzas, after Arthur O'Shaughnessy. Rendered entirely in glyphs.</p>`, [
    { label: 'Begin', primary: !cp, action: () => startChapter(0) },
    { label: 'Continue', primary: !!cp, disabled: !cp, action: () => { try { if (cp.endless) startEndless(cp.endless.seed, cp.endless.depth, deserialize(Int32Array.from(cp.state), endlessVerse(cp.endless.seed, cp.endless.depth))); else startChapter(cp.chapter, deserialize(Int32Array.from(cp.state))); } catch { if (cp.endless) startEndless(cp.endless.seed, cp.endless.depth); else startChapter(cp.chapter); } } },
    { label: 'Chapters', disabled: G.save.unlocked < 2, action: chapterMenu }, { label: 'Endless Choir', disabled: !endlessUnlocked(), action: endlessMenu }, { label: 'How to play', action: helpMenu }, { label: 'Settings', action: () => settingsMenu(title) },
  ], `v${VERSION}`);
  // bound to this title card: hud.menu() replaces the card, so a reply after Chapters/Settings/How to play (or a newer title) is dropped
  const card = document.querySelector('#menu .card');
  checkForUpdate().then(newer => { if (!newer || !card?.isConnected || card.querySelector('[data-update]')) return; const n = document.createElement('p'); n.setAttribute('role', 'status'); n.dataset.update = ''; n.textContent = `Version ${newer} is available. Reload the page to update; your progress is kept.`; card.insertBefore(n, card.querySelector('nav')); });
}
const endlessUnlocked = () => G.save.unlocked >= CHAPTERS.length || G.save.endings.length > 0 || params.has('endless');
function endlessMenu() {
  const week = weeklySeed(new Date()), best = G.save.endlessBest || 0;
  G.hud.menu('ENDLESS CHOIR', `<p>Verses without end, sung from the stanzas you know. Each verse borrows a rule; each is harder than the last. One life.</p><p>Deepest verse reached: ${best}</p>`, [
    { label: 'Begin a new run', primary: true, action: () => startEndless((Math.random() * 1e9) | 0, 1) },
    { label: `This week's choir (seed ${week})`, action: () => startEndless(week, 1) },
    { label: 'Back', action: title }], 'POST-LAUNCH');
}
function chapterMenu() { G.hud.menu('CHAPTERS', '', CHAPTERS.map((c, i) => ({ label: `${c.id}. ${c.title}`, disabled: i >= G.save.unlocked, action: () => startChapter(i) })).concat({ label: 'Back', action: title }), 'SELECT A STANZA'); }
function helpMenu() {
  G.hud.menu('HOW TO PLAY', `<dl><dt>W A S D</dt><dd>Walk and strafe</dd><dt>Mouse / ← → / Q</dt><dd>Turn (click the view to capture the mouse)</dd><dt>Space (hold)</dt><dd>Hum — light, and be heard</dd><dt>F / click</dt><dd>Chord — stagger what is close</dd><dt>Shift (hold)</dt><dd>Hold your breath — silent, slow</dd><dt>E</dt><dd>Use</dd><dt>Esc / P</dt><dd>Pause</dd></dl><p>Your voice costs Breath. Everything that hears you comes.</p>`, [{ label: 'Back', primary: true, action: title }], 'ODE');
}
function settingsMenu(back) {
  const s = S(), opt = (v, cur, t) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${t}</option>`;
  const m = G.hud.menu('SETTINGS', `
    <label>Render quality <select data-k="quality">${opt('auto', s.quality, 'auto (adapts to this machine)')}${Object.keys(QUALITY).map(q => opt(q, s.quality, `${q} (${QUALITY[q][0]}×${QUALITY[q][1]})`)).join('')}</select></label>
    <label>Reduced motion <select data-k="reducedMotion">${opt(false, s.reducedMotion, 'off')}${opt(true, s.reducedMotion, 'on')}</select></label>
    <label>HUD text size <select data-k="textScale">${[1, 1.25, 1.5, 2].map(v => opt(v, s.textScale, v * 100 + '%')).join('')}</select></label>
    <label>High-contrast HUD <select data-k="contrast">${opt(false, s.contrast, 'off')}${opt(true, s.contrast, 'on')}</select></label>
    <label>Captions <select data-k="captions">${opt(true, s.captions, 'on')}${opt(false, s.captions, 'off')}</select></label>
    <label>Spatial audio <select data-k="spatial">${opt('binaural', s.spatial || 'binaural', 'binaural 3D (headphones)')}${opt('stereo', s.spatial, 'stereo (speakers)')}</select></label>
    <label>Volume <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="volume"></label>
    <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.1" value="${s.sensitivity}" data-k="sensitivity"></label>
    <label>Share anonymous diagnostics ${G.telemetryConfig ? '' : '(no endpoint in this build — nothing is sent)'} <select data-k="telemetry">${opt(false, s.telemetry, 'off')}${opt(true, s.telemetry, 'on')}</select></label>
    <label>Frame statistics <select data-k="stats">${opt(false, s.stats, 'off')}${opt(true, s.stats, 'on')}</select></label>
    <label>Inspect buffer <select data-k="debug">${['', 'radiance', 'normals', 'tangents', 'depth', 'material', 'velocity', 'leaves', 'flow', 'lic', 'switch'].map(v => opt(v, s.debug, v || 'final glyphs')).join('')}</select></label>`,
  [{ label: 'Done', primary: true, action: back }, { label: 'Copy diagnostic report', action: copyDiagnostics }], 'ODE');
  m.onchange = e => { const k = e.target.dataset.k; if (!k) return; const v = e.target.value; S()[k] = v === 'true' ? true : v === 'false' ? false : e.target.type === 'range' || k === 'textScale' ? +v : v; applySettings(); };
}
/** Copy a report from the open dialog. Status is announced inside the dialog; if the clipboard is unavailable or
 *  refused, the report appears in a selectable read-only field in the same dialog so the player can copy it by hand. */
async function copyFromDialog(text, done) {
  const card = $('menu').querySelector('.card'); if (!card) return; const nav = card.querySelector('nav');
  let status = card.querySelector('[data-copy-status]'); if (!status) { status = document.createElement('p'); status.setAttribute('role', 'status'); status.dataset.copyStatus = ''; card.insertBefore(status, nav); }
  try { await navigator.clipboard.writeText(text); status.textContent = done; }
  catch {
    let box = card.querySelector('textarea[data-report]'); if (!box) { box = document.createElement('textarea'); box.readOnly = true; box.rows = 8; box.dataset.report = ''; box.setAttribute('aria-label', 'Report text'); card.insertBefore(box, nav); }
    box.value = text; status.textContent = 'Copying was blocked. The report is selected below: copy it with Ctrl+C (Cmd+C on a Mac).'; box.focus(); box.select();
  }
}
const copyDiagnostics = () => copyFromDialog(JSON.stringify(G.telemetry?.report() ?? {}, null, 2), 'Diagnostic report copied.');
function crashed(report) {
  if (G.mode === 'crashed') return; cancelDeferred(); G.mode = 'crashed'; G.input.enabled = false; document.exitPointerLock?.(); G.save.lastCrash = { at: report.at, message: report.message, chapter: report.chapter }; storeSave(G.save);
  G.hud.menu('SOMETHING BROKE', `<p>The game hit an error and stopped this chapter. Your saved progress is safe. Restarting rebuilds the renderer; if the error returns, reload the game.</p><p>The report below contains the chapter, seed and your inputs so the bug can be replayed exactly. It contains nothing about you.</p><p><code>${String(report.message).replace(/[<>&]/g, '')}</code></p>`,
    [{ label: 'Copy crash report', primary: true, action: () => copyFromDialog(JSON.stringify(report), 'Crash report copied.') }, { label: G.endless ? 'Restart verse' : 'Restart chapter', action: recoverFromCrash }, { label: 'Reload the game', action: () => location.reload() }, { label: 'Title', action: () => { freshPipeline(); title(); } }], 'ERROR');
}
/** Crash recovery: the same chapter, or the same Endless verse (unlike the pause menu's one-life 'Restart run'). */
function recoverFromCrash() {
  freshPipeline(); G.mode = 'play'; if (G.endless) startEndless(G.endless.seed, G.endless.depth); else startChapter(G.chapter);
}
function died() {
  if (G.endless) { const d = G.endless.depth - 1; G.save.endlessBest = Math.max(G.save.endlessBest || 0, d); if (G.save.checkpoint?.endless) G.save.checkpoint = null; storeSave(G.save); /* a campaign save survives an Endless run */
    G.telemetry?.track('endless_end', { depth: d }); G.mode = 'dead'; G.input.enabled = false; document.exitPointerLock?.();
    G.hud.menu('UNWRITTEN', `<p>The choir goes on without you. Verses completed: ${d}. Seed ${G.endless.seed}.</p>`, [{ label: 'Begin again', primary: true, action: () => startEndless(G.endless.seed, 1) }, { label: 'Title', action: title }], 'ENDLESS CHOIR'); return; }
  G.mode = 'dead'; G.input.enabled = false; document.exitPointerLock?.(); G.hud.menu('UNWRITTEN', '<p>The page forgets you. The stanza begins again.</p>', [{ label: 'Begin the chapter again', primary: true, action: () => startChapter(G.chapter) }, { label: 'Title', action: title }], `CHAPTER ${G.sim.def.id}`); }
function completed() {
  if (G.endless) { const { seed, depth } = G.endless; G.save.endlessBest = Math.max(G.save.endlessBest || 0, depth); if (G.save.checkpoint?.endless) G.save.checkpoint = null; storeSave(G.save); G.mode = 'complete'; G.input.enabled = false; document.exitPointerLock?.();
    G.hud.menu(`VERSE ${depth}`, `<p class="stanza">${STANZAS[(depth - 1) % STANZAS.length].slice(0, 4).join('\n')}</p><p>Time ${(G.sim.tick / TICK_HZ).toFixed(1)}s · written ${G.sim.p.hp}/${TUNE.hpMax}</p>`, [{ label: `Verse ${depth + 1}`, primary: true, action: () => startEndless(seed, depth + 1) }, { label: 'Title', action: title }], 'ENDLESS CHOIR'); return; }
  G.mode = 'complete'; G.input.enabled = false; document.exitPointerLock?.(); const next = G.chapter + 1, secs = (G.sim.tick / TICK_HZ).toFixed(1);
  G.telemetry?.perf(G.pl.quality, G.frames, G.intervals);
  G.save.unlocked = Math.max(G.save.unlocked, Math.min(CHAPTERS.length, next + 1)); G.save.checkpoint = null; G.save.best[G.sim.def.id] = Math.min(G.save.best[G.sim.def.id] ?? 1e9, G.sim.tick); storeSave(G.save);
  const stanza = `<p class="stanza">${STANZAS[G.sim.def.id - 1].join('\n')}</p><p>Time ${secs}s · written ${G.sim.p.hp}/${TUNE.hpMax} · state hash ${hashState(G.sim).toString(16)}</p>`;
  if (G.sim.c.ending) { const sang = G.sim.c.ending === 1; if (!G.save.endings.includes(G.sim.c.ending)) G.save.endings.push(G.sim.c.ending); storeSave(G.save);
    G.hud.menu(sang ? 'YOU SING' : 'YOU ARE SILENT', `${stanza}<p>${sang ? 'The sleeper wakes with your face. The Choir is whole again, ceaseless and sorrowless, and there is no one left on the shore to hear it.' : 'You cross without a sound. Behind you they renew the world, in spite of a dreamer who slumbers, and a singer who sings no more.'}</p>`, [{ label: 'Title', primary: true, action: title }], `ENDING ${G.sim.c.ending} OF 2`); return; }
  G.hud.menu(G.sim.def.title.toUpperCase(), stanza, next < CHAPTERS.length ? [{ label: `Continue to chapter ${next + 1}`, primary: true, action: () => startChapter(next) }, { label: 'Title', action: title }] : [{ label: 'Title', primary: true, action: title }], next < CHAPTERS.length ? 'STANZA COMPLETE' : 'END OF THIS BUILD');
}

// ---------------------------------------------------------------- event presentation
const CY = [0.5, 1.4, 1.3], RED = [1.6, 0.25, 0.15], PALE = [1.1, 1.05, 0.95], GOLDC = [1.5, 1.1, 0.4];
function present(e) {
  const pl = G.pl, x = e.x * U, z = e.z * U, hud = G.hud, def = G.sim.def; G.audio.event(e); G.telemetry?.event(e, G.sim);
  switch (e.type) {
    case 'measure': burst(pl, x, 1.2, z, 40, 3.5, CY, 1.1); hud.alert(`A MEASURE RETURNS · ${e.a}/${def.need}`); hud.caption(STANZAS[def.id - 1].slice(2 + e.a * 2 - 2, 2 + e.a * 2 + 2).slice(0, 2)); break;
    case 'hum': burst(pl, x + Math.cos(pl.cam.yaw) * 0.8, 1.2, z + Math.sin(pl.cam.yaw) * 0.8, 5, 1.6, CY, 0.9, pl.cam.yaw); break;
    case 'chord': pl.flash = 1; burst(pl, x + Math.cos(pl.cam.yaw), 1.3, z + Math.sin(pl.cam.yaw), 70, 9, CY, 0.8, pl.cam.yaw); break;
    case 'hurt': G.hurtFlash = 1; hud.pain(); burst(pl, x, 1.2, z, 14, 2, RED, 0.5); hud.alert('YOU ARE BEING UNWRITTEN', 1.2); break;
    case 'unwritten': burst(pl, x, 1.2, z, 90, 3, PALE, 1.4); hud.alert('UNWRITTEN', 1.2); break;
    case 'stagger': burst(pl, x, 1.4, z, 22, 2.5, PALE, 0.7); break;
    case 'gate': hud.alert('THE WAY OPENS', 3); hud.caption(STANZAS[def.id - 1].slice(6)); break;
    case 'alert': hud.alert(e.a === ET.TRIUNE ? 'IT HEARS YOU BREATHING' : 'SOMETHING HAS HEARD YOU', 1.6); break;
    case 'phaseWarn': hud.alert('THE AGE IS TURNING', 1.4); break;
    case 'phase': pl.flash = 0.5; hud.alert(def.rule & 64 ? (e.a ? 'YOU STEP APART' : 'YOU ARE AMONG THEM') : e.a ? 'BABEL — COMING TO BIRTH' : 'NINEVEH — DYING', 2); break;
    case 'wall': burst(pl, x, 1.5, z, 16, 1.5, PALE, 0.8); break;
    case 'trample': hud.alert('THREE, WITH A NEW SONG\'S MEASURE', 3); burst(pl, x, 1, z, 30, 3, RED, 1); break;
    case 'surgeWarn': hud.alert('THE CRY GOES UP — FIND SHADOW', 2); break;
    case 'surge': hud.alert('THE DAWN', 1.5); break;
    case 'marked': hud.alert('THEY HAVE SEEN A SCORNER', 2); break;
    case 'brazier': burst(pl, x, 1.4, z, 50, 2.5, GOLDC, 1.3); hud.alert(`FLAME WROUGHT · ${e.a}/${G.sim.braziers}`); break;
    case 'gutter': hud.alert('YOUR VOICE GUTTERS THE FLAME — RELIGHT WHERE YOU BEGAN', 2.6); break;
    case 'relight': hud.alert('THE FLAME RETURNS', 1.5); break;
    case 'gasp': hud.alert('YOU GASP', 1.2); break;
    case 'wake': burst(pl, x, 0.6, z, 20, 1.5, GOLDC, 1.2); hud.alert('THE SLEEPER STIRS', 1.2); break;
    case 'death': burst(pl, x, 1.2, z, 120, 4, PALE, 1.6); defer(died, S().reducedMotion ? 300 : 1400); break;
    case 'complete': defer(completed, 500); break;
    default: break;
  }
}

// ---------------------------------------------------------------- loop
function frame(t) {
  requestAnimationFrame(frame);
  if (G.mode === 'crashed') return;
  try { frameBody(t); } catch (e) { crashed(G.telemetry ? G.telemetry.crash(e, 'frame') : { message: String(e) }); }
}
function frameBody(t) {
  const interval = G.last ? t - G.last : 0, elapsed = Math.min(0.25, interval / 1000); G.last = t;
  if (interval && G.mode === 'play') { G.intervals.push(interval); if (G.intervals.length > 240) G.intervals.shift(); } // display-side frame time
  if (!G.sim || G.mode === 'title' || G.mode === 'boot') return;
  let ticks = 0; const simT0 = performance.now();
  if (G.mode === 'play') {
    ticks = consumeTicks(G, elapsed);
    for (let k = 0; k < ticks; k++) {
      G.prev = snapshot(G.sim); const word = G.bot ? botInput(G.bot, G.sim) : G.input.poll();
      if (G.log.length >= INPUT_CAP) { G.base = { tick: G.sim.tick, state: Array.from(serialize(G.sim)) }; G.log = []; } // re-base instead of truncating
      G.failingInput = word; step(G.sim, word); G.failingInput = null; G.log.push(word); /* the log holds completed ticks only */
      for (const e of G.sim.events) present(e); G.sim.events.length = 0;
    }
  }
  const simMs = performance.now() - simT0, alpha = G.mode === 'play' ? Math.min(1, G.acc / TICK) : 1, view = viewOf(G.prev, G.sim, alpha), p = G.sim.p;
  G.bob += elapsed * (p.hold ? 4 : 9) * (ticks && (G.prev.p.x !== p.x || G.prev.p.z !== p.z) ? 1 : 0); view.bob = Math.sin(G.bob) * 1.6;
  const dt = G.mode === 'play' ? elapsed : 0; renderFrame(G.pl, view, dt);
  G.hurtFlash *= Math.exp(-elapsed / 0.25); const bg = [3 / 255 + G.hurtFlash * 0.25, 5 / 255, 11 / 255];
  if (G.out) G.out.draw(G.pl.sel.inst, G.pl.sel.count, G.pl.w, G.pl.h, bg);
  else { const c = G.cpu; compositeCPU(c.img.data, G.pl.w, G.pl.h, 2, G.pl.sel.inst, G.pl.sel.count, G.atlas, G.atlasPx); c.ctx.putImageData(c.img, 0, 0); }
  if (S().debug) { const d = $('debug'), ctx = d.getContext('2d'), img = ctx.createImageData(G.pl.w, G.pl.h); debugImage(img.data, G.pl, S().debug); ctx.putImageData(img, 0, 0); }
  G.hud.update(G.sim, elapsed, S().captions); G.audio.update(G.sim, G.pl, elapsed, G.mode === 'play' && !G.sim.c.done && !G.sim.c.dead);
  // rolling statistics: G.frames is CPU work time for this frame, G.intervals the time between frames
  const total = performance.now() - simT0; G.frames.push(total);
  if (G.auto && G.mode === 'play') { const t2 = sampleFrame(G.auto, total); if (t2) setTier(t2); } if (G.frames.length > 240) G.frames.shift(); G.switchRates.push(G.pl.sel.stats.switchRate); if (G.switchRates.length > 240) G.switchRates.shift();
  if (S().stats && (t | 0) % 6 === 0) { const f = [...G.frames].sort((a, b) => a - b), sw = [...G.switchRates].sort((a, b) => a - b), ms = G.pl.stats.ms, q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0;
    const iv = [...G.intervals].sort((a, b) => a - b);
    $('stats').textContent = `cpu p50 ${q(f, 0.5).toFixed(1)} p95 ${q(f, 0.95).toFixed(1)} ms\ninterval p50 ${q(iv, 0.5).toFixed(1)} p95 ${q(iv, 0.95).toFixed(1)} ms\nsim ${simMs.toFixed(2)} ms x${ticks}\ngbuf ${ms.gbuffer.toFixed(1)} light ${ms.light.toFixed(1)} fog ${ms.fog.toFixed(1)}\ntree ${ms.tree.toFixed(1)} flow ${ms.flow.toFixed(1)} sel ${ms.select.toFixed(1)}\nleaves ${G.pl.qt.stats.leaves} [${G.pl.qt.stats.byLevel}] ovf ${G.pl.qt.stats.overflow}\nglyphs ${G.pl.sel.count} tris ${G.pl.stats.tris} tier ${G.pl.quality}${G.auto ? ' (auto)' : ''}\nswitch p95 ${(q(sw, 0.95) * 100).toFixed(1)}%\n${G.out ? `gpu upload ${G.out.stats.uploadMs.toFixed(2)} draw ${G.out.stats.drawMs.toFixed(2)}` : 'cpu compositor'}\ntick ${G.sim.tick} hash ${hashState(G.sim).toString(16)}`; }
}

async function boot() {
  try { await loadAssets(); } catch (e) { $('menu').innerHTML = `<div class="card"><h1>ODE</h1><p>Could not load the glyph atlas (${String(e.message || e)}). Serve the folder over HTTP: <code>npm start</code>.</p></div>`; return; }
  const canvas = $('view'); resize(); addEventListener('resize', resize);
  if (params.get('quality')) S().quality = params.get('quality'); if (params.get('stats')) S().stats = true;
  if (!params.get('cpu')) try { G.out = createGLOutput(canvas, G.atlas, G.atlasImage); } catch (e) { console.warn('WebGL2 output unavailable:', e); G.out = null; }
  if (!G.out) { // last-resort CPU compositor fallback
    const oc = new OffscreenCanvas(G.atlasImage.width, G.atlasImage.height), o2 = oc.getContext('2d'); o2.drawImage(G.atlasImage, 0, 0); const d = o2.getImageData(0, 0, oc.width, oc.height);
    G.atlasPx = { pixels: d.data, w: oc.width, h: oc.height, channels: 4 }; if (S().quality !== 'auto') S().quality = 'low'; }
  G.telemetryConfig = await loadTelemetryConfig();
  G.telemetry = createTelemetry({ version: VERSION, endpoint: G.telemetryConfig?.endpoint ?? null, getState: () => G.sim ? { chapter: G.chapter + 1, endless: G.endless, seed: G.runSeed, tick: G.sim.tick, hash: G.failingInput == null ? hashState(G.sim) : null, failingInput: G.failingInput, log: G.log, base: G.base, tier: G.pl?.quality } : {} });
  G.telemetry.install(report => crashed(report));
  G.input = createInput(canvas); G.input.onPause = pause; applySettings(); // applies saved consent before the first event
  G.telemetry.track('session_start', { tier: S().quality, reducedMotion: !!S().reducedMotion, textScale: S().textScale });
  if (!G.out) { canvas.width = G.pl.w * 2; canvas.height = G.pl.h * 2; const ctx = canvas.getContext('2d'); G.cpu = { ctx, img: ctx.createImageData(canvas.width, canvas.height) }; }
  if (matchMedia('(pointer: coarse)').matches) $('touch').hidden = false;
  addEventListener('keydown', e => { if (e.code === 'Escape' && G.mode === 'pause') resume(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  globalThis.__ode = { G, startChapter, startEndless, title, hashState: () => hashState(G.sim), stats: () => ({ tier: G.pl.quality, auto: G.auto ? { tier: G.auto.tier, changes: G.auto.changes, lastP95: G.auto.lastP95 } : null, frames: [...G.frames], intervals: [...G.intervals], switchRates: [...G.switchRates], ms: { ...G.pl.stats.ms }, leaves: { ...G.pl.qt.stats }, glyphs: { ...G.pl.sel.stats }, out: G.out ? { ...G.out.stats, kind: G.out.kind } : { kind: 'cpu' }, tick: G.sim?.tick, mode: G.mode, chapter: G.chapter, cascade: G.pl.stats.cascade }) };
  requestAnimationFrame(frame);
  if (params.get('endless')) startEndless(+params.get('endless') || 1, +(params.get('depth') || 1)); else if (params.get('chapter')) startChapter(Math.max(0, Math.min(CHAPTERS.length - 1, +params.get('chapter') - 1))); else title();
}
boot();
