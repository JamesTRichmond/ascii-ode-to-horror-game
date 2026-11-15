// Game shell: asset loading, fixed-timestep loop, event presentation, menus.
// The simulation advances in whole 60 Hz ticks from a tick-indexed input log; rendering
// interpolates between the last two snapshots and never feeds back into the simulation.
import { parseAtlas } from '../render/atlas.js';
import { createPipeline, setScene, adoptScene, renderFrame, burst, QUALITY, configureRenderer, rendererMode, restartWorker } from '../render/client.js';
import { createGLOutput } from '../render/output_gl.js';
import { compositeCPU, debugImage } from '../render/output_cpu.js';
import { CVD_MODES, correction, columnMajor, correctHex } from '../render/cvd.js';
import { CELL } from '../render/gbuffer.js';
import { createSim, step, serialize, deserialize, hashState, TICK_HZ, ET, TUNE } from '../sim/sim.js';
import { CHAPTERS, STANZAS } from '../sim/chapters.js';
import { createBot, botInput } from '../sim/bot.js';
import { viewOf, snapshot } from './view.js';
import { createInput } from './input.js';
import { ACTIONS, normalise, rebind, describe, keyName } from './bindings.js';
import { createHud } from './hud.js';
import { captionFor, heartbeatCaption } from './soundcaptions.js';
import { recordGhost, startGhost, stepGhost, ghostPose } from './ghost.js';
import { createRun, formatTicks, formatDelta } from './splits.js';
import { createAudio } from './audio.js';
import { loadSave, storeSave, exportSave, importSave } from './save.js';
import { TICK, MAX_CATCHUP, consumeTicks } from './loop.js';
import { createAutoQuality, sampleFrame } from './quality.js';
import { createTelemetry, loadTelemetryConfig, INPUT_CAP } from './telemetry.js';
import { endlessVerse, weeklySeed, MOD_INFO, modNames } from '../sim/endless.js';
import { html, setHTML, htmlStats, trustedTypesEnforced } from './safe-html.js';
import { encodeSeed, decodeSeed } from '../sim/seedcode.js';
import { epilogueDef, EPILOGUE, EPILOGUE_TITLE, EPILOGUE_OPENING, EPILOGUE_CLOSING } from '../sim/epilogue.js';

export const VERSION = '1.1.0-rc.1';
const U = CELL / 1024, $ = id => document.getElementById(id), params = new URLSearchParams(location.search);
const G = { mode: 'boot', chapter: 0, sim: null, prev: null, acc: 0, last: 0, pl: null, out: null, atlas: null, noise: null, atlasImage: null, atlasPx: null, save: loadSave(), log: [], seed: +(params.get('seed') || 100), bot: null, frames: [], intervals: [], switchRates: [], hud: createHud(), audio: createAudio(), input: null, bob: 0, hurtFlash: 0, cpu: null };
const S = () => G.save.settings;

async function loadAssets() {
  const src = globalThis.__ODE_ASSETS || { glyphs: 'assets/atlas/glyphs.bin', noise: 'assets/atlas/bluenoise.bin', atlas: 'assets/atlas/atlas.png' };
  const [bin, noise, blob] = await Promise.all([fetch(src.glyphs).then(r => r.arrayBuffer()), fetch(src.noise).then(r => r.arrayBuffer()), fetch(src.atlas).then(r => r.blob())]);
  G.atlas = parseAtlas(bin); G.noise = new Uint8Array(noise); G.raw = { glyphs: bin, noise: G.noise }; // the render worker parses its own copy
  G.atlasImage = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}
function applySettings() {
  const s = S(), root = document.documentElement; if (G.telemetry) G.telemetry.enabled = !!s.telemetry && !!G.telemetryConfig;
  root.style.setProperty('--scale', s.textScale); root.classList.toggle('contrast', !!s.contrast); root.classList.toggle('still', !!s.reducedMotion);
  G.audio.setVolume(s.volume); G.audio.spatial = s.spatial === 'stereo' ? 'stereo' : 'binaural'; if (G.input) { G.input.sensitivity = s.sensitivity; G.input.vibration = s.vibration !== false; G.input.setBindings(normalise(s.bindings)); G.input.toggle = !!s.toggleVoice; if (!s.toggleVoice) G.input.latched = 0; } $('stats').hidden = !s.stats; $('debug').hidden = !s.debug;
  if (s.quality === 'auto') { G.auto ||= createAutoQuality({ start: 'medium' }); } else G.auto = null;
  // render thread: the worker needs the WebGL output path and is bypassed while a G-buffer inspection view is shown
  const thread = s.renderThread === 'worker' && G.out && !s.debug ? 'worker' : 'local';
  if (thread !== rendererMode()) { configureRenderer(thread, G.raw, e => crashed(G.telemetry ? G.telemetry.crash(Object.assign(new Error(e.message), { stack: e.stack }), 'worker') : { message: e.message })); G.pl = null; }
  setTier(G.auto ? G.auto.tier : s.quality);
  // colour-vision correction: one matrix for the scene (GPU and CPU paths) and the same mapping for HUD colours
  const mode = CVD_MODES.includes(s.cvd) ? s.cvd : 'off', C = correction(mode); G.cvd = mode === 'off' ? null : C; G.out?.setCvd?.(columnMajor(C));
  for (const [v, base, hi] of [['--red', '#ff6b5e', '#ff8a80'], ['--cyan', '#7fe3d4', '#99ffff'], ['--gold', '#e9c46a', '#ffe08a']]) { if (mode === 'off') root.style.removeProperty(v); else root.style.setProperty(v, correctHex(s.contrast ? hi : base, mode)); } // the stylesheet palette (incl. high contrast) when off
  G.pl.opts.reducedMotion = !!s.reducedMotion; G.pl.opts.autoExposure = s.eyeAdaptation !== false; G.hud.still = !!s.reducedMotion; storeSave(G.save);
}
function setTier(tier) {
  if (G.pl && G.pl.quality === tier) return;
  const prev = G.pl; G.pl = createPipeline(G.atlas, G.noise, tier);
  if (prev && (prev.world || prev.remote) && !!prev.remote === !!G.pl.remote && G.sim) adoptScene(G.pl, prev); else { if (prev) Object.assign(G.pl.opts, prev.opts); if (G.sim) setScene(G.pl, G.sim); }
  const d = $('debug'); d.width = G.pl.w; d.height = G.pl.h;
  if (G.cpu) { const c = $('view'); c.width = G.pl.w * 2; c.height = G.pl.h * 2; G.cpu.img = G.cpu.ctx.createImageData(c.width, c.height); }
}
/** A crash can leave the render pipeline in any state, so recovery never reuses it: same tier, same options, new buffers. */
function freshPipeline() { if (G.pl.remote) restartWorker(); const opts = { ...G.pl.opts }; G.pl = createPipeline(G.atlas, G.noise, G.pl.quality); Object.assign(G.pl.opts, opts); }
function resize() { const c = $('view'), dpr = Math.min(2, devicePixelRatio || 1), w = Math.min(1920, Math.round(c.clientWidth * dpr)) || 1440; c.width = w; c.height = Math.round((w * 9) / 16); }

// ---------------------------------------------------------------- chapter flow
/** One pending death/completion transition, bound to the sim that raised it; any new session or the title cancels it. */
function defer(fn, ms) { clearTimeout(G.pending); const sim = G.sim; G.pending = setTimeout(() => { G.pending = 0; if (G.sim === sim && (G.mode === 'play' || G.mode === 'pause')) fn(); }, ms); }
function cancelDeferred() { clearTimeout(G.pending); G.pending = 0; }
function startEndless(seed, depth, restored = null, mods = 0) {
  G.epilogue = false; G.endless = { seed, depth, mods }; startChapter(-1, restored || createSim(endlessVerse(seed, depth, mods), seed + depth), !!restored);
  if (!restored) G.telemetry?.track('endless_verse', { seed, depth, mods });
}
/** Endless challenge modifiers: chosen once, kept in the save, applied to new runs (and recorded with every run). */
function modifiersMenu() {
  const cur = G.save.endlessMods || 0, m = G.hud.menu('CHALLENGE MODIFIERS', html`<p>Each modifier changes every verse of a run. Best depths are kept per combination.</p>${MOD_INFO.map(([bit, name, text]) => html`<label><input type="checkbox" data-mod="${bit}" ${cur & bit ? html`checked` : ''}> ${name} — ${text}</label>`)}`,
    [{ label: 'Done', primary: true, action: () => { G.save.endlessMods = [...m.querySelectorAll('[data-mod]')].reduce((a, c) => a | (c.checked ? +c.dataset.mod : 0), 0); storeSave(G.save); endlessMenu(); } }], 'ENDLESS CHOIR');
}
/** The epilogue: a stanza-less tenth chapter after the silent ending (see sim/epilogue.js). */
function startEpilogue(restored = null) { G.epilogue = true; G.endless = null; startChapter(-1, restored || createSim(epilogueDef(), EPILOGUE.simSeed), !!restored); }
function startChapter(index, restored = null, isRestore = !!restored) {
  cancelDeferred();
  if (index >= 0) { G.endless = null; G.epilogue = false; }
  G.chapter = index; G.runSeed = index >= 0 ? G.seed + index : G.epilogue ? EPILOGUE.simSeed : G.endless.seed + G.endless.depth; G.sim = restored || createSim(index, G.runSeed); G.prev = snapshot(G.sim); G.acc = 0; G.log = [];
  G.failingInput = null; G.base = isRestore ? { tick: G.sim.tick, state: Array.from(serialize(G.sim)) } : null; /* a restored run replays from its own state, not tick 0 */
  G.bot = params.get('autoplay') ? createBot({ ending: +(params.get('ending') || 2) }) : null;
  setScene(G.pl, G.sim); G.hud.setChapter(G.sim.def, CHAPTERS.length, G.endless); G.hud.closeMenu(); G.hud.show(true); G.mode = 'play'; G.input.enabled = true; G.input.reset();
  if (!isRestore) G.hud.caption(G.epilogue ? EPILOGUE_OPENING : STANZAS[G.sim.def.id - 1].slice(0, 4), 2.8);
  // ghost of the best run: only for a fresh campaign attempt with the same seed as the recorded run
  G.ghost = index >= 0 && !isRestore && S().ghost !== false ? startGhost(G.save.ghosts?.[G.sim.def.id], index, G.runSeed) : null;
  if (G.ghost) G.hud.alert(`YOUR BEST SELF WALKS WITH YOU · ${(G.ghost.best / TICK_HZ).toFixed(1)}s`, 2.6);
  G.run = index >= 0 && !isRestore ? createRun(G.save.splits?.[G.sim.def.id]) : null; // a resumed run is untimed (its early splits are gone)
  if (index >= 0 && !isRestore) G.telemetry?.track('chapter_start', { chapter: index + 1 });
  G.audio.start(); G.audio.setChapter?.(G.sim.def.id); G.audio.setRoom?.(G.sim);
}
function pause() {
  if (G.mode !== 'play') return; G.mode = 'pause'; G.input.enabled = false; document.exitPointerLock?.();
  G.hud.menu('PAUSED', html`<p>${G.sim.def.title} — ${G.sim.def.hint}</p>`, [{ label: 'Resume', primary: true, action: resume }, { label: 'Settings', action: () => settingsMenu(pause0) }, { label: 'Photo mode', action: enterPhoto }, { label: G.endless ? 'Restart run' : 'Restart chapter', action: restart }, { label: 'Save and quit to title', action: () => { if (!G.sim.c.dead && !G.sim.c.done) { G.save.checkpoint = { chapter: G.chapter, endless: G.endless, epilogue: G.epilogue || undefined, state: Array.from(serialize(G.sim)) }; storeSave(G.save); } title(); } }], 'ODE');
}
const pause0 = () => { G.mode = 'play'; pause(); };
// ---------------------------------------------------------------- photo mode: the moment is frozen, the camera is free
const PHOTO_HELP = 'PHOTO MODE · W A S D move · ← → or drag to turn · R / F raise / lower · [ ] field of view · P capture · H hide this · Esc back';
function enterPhoto() {
  const v = viewOf(G.prev, G.sim, 1); G.photo = { x: v.x, z: v.z, y: 1.62, yaw: v.yaw, fov: 74, keys: new Set(), help: true };
  G.mode = 'photo'; G.hud.closeMenu(); G.hud.show(false); photoHelp().hidden = false; photoHelp().textContent = PHOTO_HELP;
}
function exitPhoto() { photoHelp().hidden = true; G.photo = null; G.mode = 'play'; G.hud.show(true); pause(); }
function photoHelp() { let el = document.getElementById('photoHelp'); if (!el) { el = document.createElement('p'); el.id = 'photoHelp'; el.setAttribute('role', 'status'); el.hidden = true; document.getElementById('app').append(el); } return el; }
function photoKey(e, down) {
  if (G.mode !== 'photo') return; const P = G.photo; e.preventDefault();
  if (!down) { P.keys.delete(e.code); return; } if (e.repeat && !['BracketLeft', 'BracketRight'].includes(e.code)) return;
  if (e.code === 'Escape') { exitPhoto(); e.stopImmediatePropagation(); return; }
  if (e.code === 'KeyH') { P.help = !P.help; photoHelp().hidden = !P.help; return; }
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') { P.fov = Math.max(30, Math.min(110, P.fov + (e.code === 'BracketLeft' ? -4 : 4))); photoHelp().textContent = `${PHOTO_HELP} · FOV ${P.fov}°`; return; }
  if (e.code === 'KeyP' || e.code === 'Enter') { G.photoShot = true; return; }
  P.keys.add(e.code);
}
/** Move the free camera; it may not leave the map or sink below the floor. */
function photoMove(dt) {
  const P = G.photo, k = c => (P.keys.has(c) ? 1 : 0), sp = 3.2 * dt, f = k('KeyW') - k('KeyS'), s = k('KeyD') - k('KeyA');
  P.yaw += (k('ArrowRight') - k('ArrowLeft')) * 1.6 * dt; const c = Math.cos(P.yaw), n = Math.sin(P.yaw);
  P.x += (f * c - s * n) * sp; P.z += (f * n + s * c) * sp; P.y = Math.max(0.3, Math.min(9, P.y + (k('KeyR') - k('KeyF')) * sp));
  const W = G.sim.w * CELL, H = G.sim.h * CELL; P.x = Math.max(0.2, Math.min(W - 0.2, P.x)); P.z = Math.max(0.2, Math.min(H - 0.2, P.z));
}
function savePhoto(canvas) {
  canvas.toBlob(b => { if (!b) return; const a = document.createElement('a'), url = URL.createObjectURL(b), d = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19); a.href = url; a.download = `ode-ch${G.sim.def.id}-${d}.png`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }, 'image/png');
  G.hud.alert?.('CAPTURED', 1);
}
/** Voluntary restart. Endless is one life per run, so it begins again at verse 1; crash recovery is separate (recoverFromCrash). */
function restart() { if (G.epilogue) { startEpilogue(); return; } if (G.endless) startEndless(G.endless.seed, 1, null, G.endless.mods); else startChapter(G.chapter); }
function resume() { G.hud.closeMenu(); G.mode = 'play'; G.input.enabled = true; G.input.reset(); G.last = 0; }
/** Day-one patch readiness: compare the running build with the deployed version.json (same origin, no tracking). */
async function checkForUpdate() {
  try {
    const r = await fetch('version.json', { cache: 'no-store' }); if (!r.ok) return null;
    const v = await r.json(); G.deployed = v;
    // offline play: only production builds (whose version.json lists their files) install the service worker, so a
    // source checkout under development is never served stale modules from a cache
    if (v.files && 'serviceWorker' in navigator && !params.has('nosw')) navigator.serviceWorker.register('sw.js').catch(e => console.info('offline cache unavailable:', e.message)); return v.version !== VERSION ? v.version : null;
  } catch { return null; }
}
function title() {
  cancelDeferred(); G.mode = 'title'; G.input.enabled = false; G.hud.show(false); G.audio.silence?.(); const cp = G.save.checkpoint;
  G.hud.menu('ODE', html`<p class="stanza">We are the music makers,\nAnd we are the dreamers of dreams…</p><p>A horror in nine stanzas, after Arthur O'Shaughnessy. Rendered entirely in glyphs.</p>`, [
    { label: 'Begin', primary: !cp, action: () => startChapter(0) },
    { label: 'Continue', primary: !!cp, disabled: !cp, action: () => { try { if (cp.epilogue) startEpilogue(deserialize(Int32Array.from(cp.state), epilogueDef())); else if (cp.endless) startEndless(cp.endless.seed, cp.endless.depth, deserialize(Int32Array.from(cp.state), endlessVerse(cp.endless.seed, cp.endless.depth, cp.endless.mods || 0)), cp.endless.mods || 0); else startChapter(cp.chapter, deserialize(Int32Array.from(cp.state))); } catch { if (cp.epilogue) startEpilogue(); else if (cp.endless) startEndless(cp.endless.seed, cp.endless.depth, null, cp.endless.mods || 0); else startChapter(cp.chapter); } } },
    { label: 'Chapters', disabled: G.save.unlocked < 2, action: chapterMenu }, { label: 'Endless Choir', disabled: !endlessUnlocked(), action: endlessMenu }, { label: 'Epilogue', disabled: !G.save.endings.includes(2), action: () => startEpilogue() }, { label: 'How to play', action: helpMenu }, { label: 'Settings', action: () => settingsMenu(title) },
  ], `v${VERSION}`);
  // bound to this title card: hud.menu() replaces the card, so a reply after Chapters/Settings/How to play (or a newer title) is dropped
  const card = document.querySelector('#menu .card');
  checkForUpdate().then(newer => { if (!newer || !card?.isConnected || card.querySelector('[data-update]')) return; const n = document.createElement('p'); n.setAttribute('role', 'status'); n.dataset.update = ''; n.textContent = `Version ${newer} is available. Reload the page to update; your progress is kept.`; card.insertBefore(n, card.querySelector('nav')); });
}
const endlessUnlocked = () => G.save.unlocked >= CHAPTERS.length || G.save.endings.length > 0 || params.has('endless');
function endlessMenu() {
  const week = weeklySeed(new Date()), best = G.save.endlessBest || 0, mods = G.save.endlessMods || 0, tags = modNames(mods), bestHere = (G.save.endlessBestBy || {})[mods] || 0;
  G.hud.menu('ENDLESS CHOIR', html`<p>Verses without end, sung from the stanzas you know. Each verse borrows a rule; each is harder than the last. One life.</p><p>Deepest verse reached: ${best}${mods ? ` · with ${tags.join(', ')}: ${bestHere}` : ''}</p><p>Modifiers: ${tags.length ? tags.join(', ') : 'none'}</p>`, [
    { label: 'Begin a new run', primary: true, action: () => startEndless((Math.random() * 1e9) | 0, 1, null, mods) },
    { label: `This week's choir (${encodeSeed(week)})`, action: () => startEndless(week, 1, null, mods) },
    { label: 'Play a shared seed code', action: seedCodeMenu },
    { label: 'Challenge modifiers', action: modifiersMenu },
    { label: 'Back', action: title }], 'POST-LAUNCH');
}
/** Enter a friend's seed code; errors are explained inside the dialog. */
function seedCodeMenu() {
  const m = G.hud.menu('SHARED SEED', html`<label>Seed code <input data-code maxlength="13" autocomplete="off" spellcheck="false" placeholder="7K2M-Q9XD-4"></label><p data-err role="alert"></p>`, [
    { label: 'Sing it', primary: true, action: () => { try { const { seed, flags } = decodeSeed(m.querySelector('[data-code]').value); if (flags) throw new Error('That code was made by a newer version of the game.'); startEndless(seed, 1, null, G.save.endlessMods || 0); } catch (e) { m.querySelector('[data-err]').textContent = e.message; } } },
    { label: 'Back', action: endlessMenu }], 'ENDLESS CHOIR');
  const field = m.querySelector('[data-code]'); field.onkeydown = e => { if (e.key === 'Enter') m.querySelector('button.primary').click(); }; field.focus();
}
function chapterMenu() { G.hud.menu('CHAPTERS', '', CHAPTERS.map((c, i) => ({ label: `${c.id}. ${c.title}`, disabled: i >= G.save.unlocked, action: () => startChapter(i) })).concat({ label: 'Back', action: title }), 'SELECT A STANZA'); }
function helpMenu() {
  const b = normalise(S().bindings), k = a => describe(b, a);
  G.hud.menu('HOW TO PLAY', html`<dl><dt>${k('FWD')} · ${k('BACK')} · ${k('LEFT')} · ${k('RIGHT')}</dt><dd>Walk and strafe</dd><dt>Mouse / ${k('TURNL')} · ${k('TURNR')}</dt><dd>Turn (click the view to capture the mouse)</dd><dt>${k('HUM')} (hold)</dt><dd>Hum — light, and be heard</dd><dt>${k('CHORD')} / click</dt><dd>Chord — stagger what is close</dd><dt>${k('HOLD')} (hold)</dt><dd>Hold your breath — silent, slow</dd><dt>${k('USE')}</dt><dd>Use</dd><dt>Esc / ${k('PAUSE')}</dt><dd>Pause</dd></dl><p>Change any key under Settings → Controls.</p><p>Controller: left stick or D-pad walk · right stick turn · RT hum · LT hold breath · RB or X chord · A use · Start pause. In menus, the D-pad moves, A selects, B backs out.</p><p>Your voice costs Breath. Everything that hears you comes.</p>`, [{ label: 'Back', primary: true, action: title }], 'ODE');
}
function settingsMenu(back) {
  const s = S(), opt = (v, cur, t) => html`<option value="${v}" ${String(cur) === String(v) ? html`selected` : ''}>${t}</option>`;
  const m = G.hud.menu('SETTINGS', html`
    <label>Render quality <select data-k="quality">${opt('auto', s.quality, 'auto (adapts to this machine)')}${Object.keys(QUALITY).map(q => opt(q, s.quality, `${q} (${QUALITY[q][0]}×${QUALITY[q][1]})`)).join('')}</select></label>
    <label>Render thread <select data-k="renderThread">${opt('worker', s.renderThread || 'worker', 'worker (frees the main thread)')}${opt('local', s.renderThread, 'main thread')}</select></label>
    <label>Eye adaptation <select data-k="eyeAdaptation">${opt(true, s.eyeAdaptation !== false, 'on')}${opt(false, s.eyeAdaptation !== false, 'off')}</select></label>
    <label>Reduced motion <select data-k="reducedMotion">${opt(false, s.reducedMotion, 'off')}${opt(true, s.reducedMotion, 'on')}</select></label>
    <label>HUD text size <select data-k="textScale">${[1, 1.25, 1.5, 2].map(v => opt(v, s.textScale, v * 100 + '%')).join('')}</select></label>
    <label>Colour vision <select data-k="cvd">${[['off', 'standard'], ['protan', 'protanopia (red-weak)'], ['deutan', 'deuteranopia (green-weak)'], ['tritan', 'tritanopia (blue-weak)']].map(([v, t]) => opt(v, s.cvd || 'off', t)).join('')}</select></label>
    <label>High-contrast HUD <select data-k="contrast">${opt(false, s.contrast, 'off')}${opt(true, s.contrast, 'on')}</select></label>
    <label>Captions <select data-k="captions">${opt(true, s.captions, 'on')}${opt(false, s.captions, 'off')}</select></label>
    <label>Sound captions (direction and distance) <select data-k="soundCaptions">${opt(false, !!s.soundCaptions, 'off')}${opt(true, !!s.soundCaptions, 'on')}</select></label>
    <label>Spatial audio <select data-k="spatial">${opt('binaural', s.spatial || 'binaural', 'binaural 3D (headphones)')}${opt('stereo', s.spatial, 'stereo (speakers)')}</select></label>
    <label>Volume <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="volume"></label>
    <label>Controller vibration <select data-k="vibration">${opt(true, s.vibration !== false, 'on')}${opt(false, s.vibration !== false, 'off')}</select></label>
    <label>Game speed (assist) <select data-k="speed">${[1, 0.85, 0.7, 0.5].map(v => opt(v, s.speed ?? 1, v === 1 ? '100% (standard)' : `${v * 100}%`)).join('')}</select></label>
    <label>Hum and hold breath <select data-k="toggleVoice">${opt(false, !!s.toggleVoice, 'hold the key')}${opt(true, !!s.toggleVoice, 'press to toggle')}</select></label>
    <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.1" value="${s.sensitivity}" data-k="sensitivity"></label>
    <label>Share anonymous diagnostics ${G.telemetryConfig ? '' : '(no endpoint in this build — nothing is sent)'} <select data-k="telemetry">${opt(false, s.telemetry, 'off')}${opt(true, s.telemetry, 'on')}</select></label>
    <label>Ghost of your best run <select data-k="ghost">${opt(true, s.ghost !== false, 'on')}${opt(false, s.ghost !== false, 'off')}</select></label>
    <label>Speedrun timer and splits <select data-k="speedrun">${opt(false, !!s.speedrun, 'off')}${opt(true, !!s.speedrun, 'on')}</select></label>
    <label>Frame statistics <select data-k="stats">${opt(false, s.stats, 'off')}${opt(true, s.stats, 'on')}</select></label>
    <label>Inspect buffer <select data-k="debug">${['', 'radiance', 'normals', 'tangents', 'depth', 'material', 'velocity', 'leaves', 'flow', 'lic', 'switch'].map(v => opt(v, s.debug, v || 'final glyphs')).join('')}</select></label>`,
  [{ label: 'Done', primary: true, action: back }, { label: 'Controls', action: () => controlsMenu(back) }, { label: 'Copy diagnostic report', action: copyDiagnostics }, { label: 'Transfer save', action: () => transferMenu(back) }], 'ODE');
  m.onchange = e => { const k = e.target.dataset.k; if (!k) return; const v = e.target.value; S()[k] = v === 'true' ? true : v === 'false' ? false : e.target.type === 'range' || k === 'textScale' || k === 'speed' ? +v : v; applySettings(); };
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
/** Move progress between browsers or devices: a copyable code or a file out; a pasted code or a file in. */
function transferMenu(back) {
  const code = exportSave(G.save);
  const m = G.hud.menu('TRANSFER SAVE', html`<p>Your progress as a save code. Copy it or download it, then import it on another browser or device.</p><textarea readonly rows="4" aria-label="Your save code" data-export>${code}</textarea>
    <label>Import a save code <textarea rows="3" data-import spellcheck="false" placeholder="ODE1...."></textarea></label><label>…or a save file <input type="file" accept=".odesave,.txt,text/plain" data-file></label><p data-msg role="status"></p>`, [
    { label: 'Copy my save code', action: () => copyFromDialog(code, 'Save code copied.') },
    { label: 'Download save file', action: () => { const a = document.createElement('a'), url = URL.createObjectURL(new Blob([code + '\n'], { type: 'text/plain' })); a.href = url; a.download = `ode-save-${new Date().toISOString().slice(0, 10)}.odesave`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); } },
    { label: 'Check import', action: () => check(m.querySelector('[data-import]').value) },
    { label: 'Back', primary: true, action: () => settingsMenu(back) }], 'SETTINGS');
  const msg = m.querySelector('[data-msg]');
  const check = text => {
    try {
      const { save, summary } = importSave(text); msg.textContent = `Valid save: ${summary}. Importing replaces your progress on this browser.`;
      if (!m.querySelector('[data-confirm]')) { const b = document.createElement('button'); b.dataset.confirm = ''; b.textContent = 'Replace my progress with this save'; b.onclick = () => { G.save = save; storeSave(G.save); applySettings(); title(); }; m.querySelector('nav').prepend(b); b.focus(); }
    } catch (e) { msg.textContent = e.message; m.querySelector('[data-confirm]')?.remove(); }
  };
  m.querySelector('[data-file]').onchange = e => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 1 << 20) { msg.textContent = 'That file is too large to be a save.'; return; } f.text().then(t => { m.querySelector('[data-import]').value = t.trim(); check(t); }); };
}
/** Rebind keys: Change captures the next key press (Esc cancels); a key already in use moves to the new action. */
function controlsMenu(back, note = '') {
  const b = normalise(S().bindings);
  const m = G.hud.menu('CONTROLS', html`<p data-note role="status">${note || 'Choose Change, then press the new key. Esc cancels.'}</p><table class="binds">${ACTIONS.map(([a, label]) => html`<tr><th scope="row">${label}</th><td><kbd>${describe(b, a)}</kbd></td><td><button data-rebind="${a}" aria-label="Change ${label}">Change</button></td></tr>`)}</table>`,
    [{ label: 'Done', primary: true, action: () => settingsMenu(back) }, { label: 'Reset to defaults', action: () => { S().bindings = null; applySettings(); controlsMenu(back, 'All keys reset to the defaults.'); } }], 'SETTINGS');
  for (const btn of m.querySelectorAll('[data-rebind]')) btn.onclick = () => {
    const a = btn.dataset.rebind, label = ACTIONS.find(x => x[0] === a)[1]; m.querySelector('[data-note]').textContent = `Press a key for “${label}”…`; btn.textContent = '…'; G.input.capture = true;
    const grab = e => {
      e.preventDefault(); e.stopImmediatePropagation(); removeEventListener('keydown', grab, true); G.input.capture = false;
      if (e.code === 'Escape') { controlsMenu(back, 'Cancelled.'); return; }
      try { const r = rebind(b, a, e.code); S().bindings = r.bindings; applySettings(); controlsMenu(back, `${label}: ${keyName(e.code)}${r.moved ? ` (taken from “${ACTIONS.find(x => x[0] === r.moved)[1]}”)` : ''}.`); document.querySelector(`[data-rebind="${a}"]`)?.focus(); }
      catch (err) { controlsMenu(back, err.message); }
    };
    addEventListener('keydown', grab, true);
  };
}
const copyDiagnostics = () => copyFromDialog(JSON.stringify(G.telemetry?.report() ?? {}, null, 2), 'Diagnostic report copied.');
// ---------------------------------------------------------------- speedrun timer (in-game time = simulation ticks)
function timerEl() { let el = document.getElementById('igt'); if (!el) { el = document.createElement('span'); el.id = 'igt'; el.setAttribute('aria-live', 'off'); document.getElementById('measurePanel')?.append(el); } return el; }
function updateTimer() { const el = timerEl(), last = G.splitShown; el.hidden = !G.run; if (!G.run) return; const t = formatTicks(G.sim.tick); const text = last && last.until > G.sim.tick ? `${t}  ${last.text}` : t; if (el.textContent !== text) { el.textContent = text; el.className = last && last.until > G.sim.tick ? last.cls : ''; } }
function showSplit(s) { G.splitShown = { text: `${s.label} ${s.delta === null ? formatTicks(s.tick) : formatDelta(s.delta)}`, cls: s.gold ? 'gold' : s.delta === null ? '' : s.delta <= 0 ? 'ahead' : 'behind', until: G.sim.tick + 3 * TICK_HZ }; }
function splitsTable(f) {
  const rows = G.run.splits.map(s => html`<tr class="${s.gold ? 'gold' : s.delta === null ? '' : s.delta <= 0 ? 'ahead' : 'behind'}"><th scope="row">${s.label}</th><td>${formatTicks(s.tick)}</td><td>${s.delta === null ? '—' : formatDelta(s.delta)}</td></tr>`);
  return html`<table class="splits"><thead><tr><th>Split</th><th>Time</th><th>vs PB</th></tr></thead><tbody>${rows}</tbody></table><p>${f.newPb ? 'NEW PERSONAL BEST · ' : ''}Sum of best ${formatTicks(f.sumOfBest)}</p>`;
}
function crashed(report) {
  if (G.mode === 'crashed') return; cancelDeferred(); G.mode = 'crashed'; G.input.enabled = false; document.exitPointerLock?.(); G.save.lastCrash = { at: report.at, message: report.message, chapter: report.chapter }; storeSave(G.save);
  G.hud.menu('SOMETHING BROKE', html`<p>The game hit an error and stopped this chapter. Your saved progress is safe. Restarting rebuilds the renderer; if the error returns, reload the game.</p><p>The report below contains the chapter, seed and your inputs so the bug can be replayed exactly. It contains nothing about you.</p><p><code>${String(report.message)}</code></p>`,
    [{ label: 'Copy crash report', primary: true, action: () => copyFromDialog(JSON.stringify(report), 'Crash report copied.') }, { label: G.endless ? 'Restart verse' : 'Restart chapter', action: recoverFromCrash }, { label: 'Reload the game', action: () => location.reload() }, { label: 'Title', action: () => { freshPipeline(); title(); } }], 'ERROR');
}
/** Crash recovery: the same chapter, or the same Endless verse (unlike the pause menu's one-life 'Restart run'). */
function recoverFromCrash() {
  freshPipeline(); G.mode = 'play'; if (G.epilogue) startEpilogue(); else if (G.endless) startEndless(G.endless.seed, G.endless.depth, null, G.endless.mods); else startChapter(G.chapter);
}
function recordBest(depth) { const by = (G.save.endlessBestBy ||= {}), k = G.endless.mods || 0; by[k] = Math.max(by[k] || 0, depth); }
function died() {
  if (G.epilogue) { G.mode = 'dead'; G.input.enabled = false; document.exitPointerLock?.(); if (G.save.checkpoint?.epilogue) G.save.checkpoint = null; storeSave(G.save);
    G.hud.menu('UNWRITTEN', html`<p>They heard you. Even the silent can be heard, if they breathe.</p>`, [{ label: 'Walk again', primary: true, action: () => startEpilogue() }, { label: 'Title', action: title }], 'EPILOGUE'); return; }
  if (G.endless) { const d = G.endless.depth - 1; G.save.endlessBest = Math.max(G.save.endlessBest || 0, d); recordBest(d); if (G.save.checkpoint?.endless) G.save.checkpoint = null; storeSave(G.save); /* a campaign save survives an Endless run */
    G.telemetry?.track('endless_end', { depth: d }); G.mode = 'dead'; G.input.enabled = false; document.exitPointerLock?.();
    G.hud.menu('UNWRITTEN', html`<p>The choir goes on without you. Verses completed: ${d}. Seed code <strong>${encodeSeed(G.endless.seed)}</strong> — share it to let others sing the same verses.</p>`, [{ label: 'Begin again', primary: true, action: () => startEndless(G.endless.seed, 1, null, G.endless.mods) }, { label: 'Copy seed code', action: () => copyFromDialog(encodeSeed(G.endless.seed), 'Seed code copied.') }, { label: 'Title', action: title }], 'ENDLESS CHOIR'); return; }
  G.mode = 'dead'; G.input.enabled = false; document.exitPointerLock?.(); G.hud.menu('UNWRITTEN', html`<p>The page forgets you. The stanza begins again.</p>`, [{ label: 'Begin the chapter again', primary: true, action: () => startChapter(G.chapter) }, { label: 'Title', action: title }], `CHAPTER ${G.sim.def.id}`); }
function completed() {
  if (G.epilogue) { G.mode = 'complete'; G.input.enabled = false; document.exitPointerLock?.(); G.save.epilogue = true; if (G.save.checkpoint?.epilogue) G.save.checkpoint = null; storeSave(G.save);
    G.hud.menu(EPILOGUE_TITLE.toUpperCase(), html`${EPILOGUE_CLOSING.map(t => html`<p>${t}</p>`)}<p>Time ${(G.sim.tick / TICK_HZ).toFixed(1)}s</p>`, [{ label: 'Title', primary: true, action: title }], 'EPILOGUE · THE END'); return; }
  if (G.endless) { const { seed, depth, mods } = G.endless; G.save.endlessBest = Math.max(G.save.endlessBest || 0, depth); recordBest(depth); if (G.save.checkpoint?.endless) G.save.checkpoint = null; storeSave(G.save); G.mode = 'complete'; G.input.enabled = false; document.exitPointerLock?.();
    G.hud.menu(`VERSE ${depth}`, html`<p class="stanza">${STANZAS[(depth - 1) % STANZAS.length].slice(0, 4).join('\n')}</p><p>Time ${(G.sim.tick / TICK_HZ).toFixed(1)}s · written ${G.sim.p.hp}/${TUNE.hpMax}</p>`, [{ label: `Verse ${depth + 1}`, primary: true, action: () => startEndless(seed, depth + 1, null, mods) }, { label: 'Title', action: title }], 'ENDLESS CHOIR'); return; }
  G.mode = 'complete'; G.input.enabled = false; document.exitPointerLock?.(); const next = G.chapter + 1, secs = (G.sim.tick / TICK_HZ).toFixed(1);
  G.telemetry?.perf(G.pl.quality, G.frames, G.intervals);
  G.save.unlocked = Math.max(G.save.unlocked, Math.min(CHAPTERS.length, next + 1)); G.save.checkpoint = null; const assisted = (S().speed || 1) < 1, book = assisted ? (G.save.bestAssisted ||= {}) : G.save.best; /* assisted runs keep their own records */
  const record = G.sim.tick < (book[G.sim.def.id] ?? 1e9); book[G.sim.def.id] = Math.min(book[G.sim.def.id] ?? 1e9, G.sim.tick);
  if (record && !assisted && !G.base && !G.bot) (G.save.ghosts ||= {})[G.sim.def.id] = recordGhost(G.chapter, G.runSeed, G.log, G.sim.tick); // a whole unassisted run from tick 0 becomes the new ghost
  const runResult = G.run && !G.bot ? G.run.finish(G.sim.tick) : null; if (runResult) (G.save.splits ||= {})[G.sim.def.id] = runResult.record;
  storeSave(G.save);
  const stanza = html`<p class="stanza">${STANZAS[G.sim.def.id - 1].join('\n')}</p><p>Time ${secs}s · written ${G.sim.p.hp}/${TUNE.hpMax} · state hash ${hashState(G.sim).toString(16)}${assisted ? ` · assist: ${Math.round(S().speed * 100)}% game speed` : ''}</p>${runResult && S().speedrun ? splitsTable(runResult) : ''}`;
  if (G.sim.c.ending) { const sang = G.sim.c.ending === 1; if (!G.save.endings.includes(G.sim.c.ending)) G.save.endings.push(G.sim.c.ending); storeSave(G.save);
    G.hud.menu(sang ? 'YOU SING' : 'YOU ARE SILENT', html`${stanza}<p>${sang ? 'The sleeper wakes with your face. The Choir is whole again, ceaseless and sorrowless, and there is no one left on the shore to hear it.' : 'You cross without a sound. Behind you they renew the world, in spite of a dreamer who slumbers, and a singer who sings no more.'}</p>`, [{ label: 'Title', primary: true, action: title }].concat(sang ? [] : [{ label: 'Epilogue: A Singer Who Sings No More', action: () => startEpilogue() }]), `ENDING ${G.sim.c.ending} OF 2`); return; }
  G.hud.menu(G.sim.def.title.toUpperCase(), stanza, next < CHAPTERS.length ? [{ label: `Continue to chapter ${next + 1}`, primary: true, action: () => startChapter(next) }, { label: 'Title', action: title }] : [{ label: 'Title', primary: true, action: title }], next < CHAPTERS.length ? 'STANZA COMPLETE' : 'END OF THIS BUILD');
}

// ---------------------------------------------------------------- event presentation
const CY = [0.5, 1.4, 1.3], RED = [1.6, 0.25, 0.15], PALE = [1.1, 1.05, 0.95], GOLDC = [1.5, 1.1, 0.4];
function present(e) {
  const pl = G.pl, x = e.x * U, z = e.z * U, hud = G.hud, def = G.sim.def; G.audio.event(e); G.telemetry?.event(e, G.sim); if (S().soundCaptions) hud.sound(captionFor(e, G.sim.p));
  const split = G.run?.onEvent(e, G.sim.tick); if (split && S().speedrun) showSplit(split);
  switch (e.type) {
    case 'measure': burst(pl, x, 1.2, z, 40, 3.5, CY, 1.1); hud.alert(`A MEASURE RETURNS · ${e.a}/${def.need}`); hud.caption(STANZAS[def.id - 1].slice(2 + e.a * 2 - 2, 2 + e.a * 2 + 2).slice(0, 2)); break;
    case 'hum': burst(pl, x + Math.cos(pl.cam.yaw) * 0.8, 1.2, z + Math.sin(pl.cam.yaw) * 0.8, 5, 1.6, CY, 0.9, pl.cam.yaw); break;
    case 'chord': pl.flash = 1; burst(pl, x + Math.cos(pl.cam.yaw), 1.3, z + Math.sin(pl.cam.yaw), 70, 9, CY, 0.8, pl.cam.yaw); break;
    case 'hurt': G.input.rumble?.(0.7, 170); G.hurtFlash = 1; hud.pain(); burst(pl, x, 1.2, z, 14, 2, RED, 0.5); hud.alert('YOU ARE BEING UNWRITTEN', 1.2); break;
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
    case 'death': G.input.rumble?.(1, 600); burst(pl, x, 1.2, z, 120, 4, PALE, 1.6); defer(died, S().reducedMotion ? 300 : 1400); break;
    case 'complete': defer(completed, 500); break;
    default: break;
  }
}

// ---------------------------------------------------------------- loop
function frame(t) {
  requestAnimationFrame(frame);
  if (G.mode !== 'play') G.input?.menuPoll?.(); // controller navigation of every menu, including the crash dialog
  if (G.mode === 'crashed') return;
  try { frameBody(t); } catch (e) { crashed(G.telemetry ? G.telemetry.crash(e, 'frame') : { message: String(e) }); }
}
function frameBody(t) {
  const interval = G.last ? t - G.last : 0, elapsed = Math.min(0.25, interval / 1000); G.last = t;
  if (interval && G.mode === 'play') { G.intervals.push(interval); if (G.intervals.length > 240) G.intervals.shift(); } // display-side frame time
  if (!G.sim || G.mode === 'title' || G.mode === 'boot') return;
  let ticks = 0; const simT0 = performance.now();
  if (G.mode === 'play') {
    ticks = consumeTicks(G, elapsed, MAX_CATCHUP, S().speed || 1); // assist speed scales wall time only; each tick is unchanged
    for (let k = 0; k < ticks; k++) {
      G.prev = snapshot(G.sim); const word = G.bot ? botInput(G.bot, G.sim) : G.input.poll();
      if (G.log.length >= INPUT_CAP) { G.base = { tick: G.sim.tick, state: Array.from(serialize(G.sim)) }; G.log = []; } // re-base instead of truncating
      G.failingInput = word; step(G.sim, word); G.failingInput = null; G.log.push(word); /* the log holds completed ticks only */
      for (const e of G.sim.events) present(e); G.sim.events.length = 0; stepGhost(G.ghost);
    }
  }
  const simMs = performance.now() - simT0, alpha = G.mode === 'play' ? Math.min(1, G.acc / TICK) : 1, view = viewOf(G.prev, G.sim, alpha), p = G.sim.p;
  if (G.mode === 'photo') { photoMove(elapsed); Object.assign(view, { x: G.photo.x, z: G.photo.z, y: G.photo.y, yaw: G.photo.yaw, fov: G.photo.fov, hold: 0 }); }
  if (G.ghost) view.ghost = ghostPose(G.ghost, alpha, U);
  G.bob += elapsed * (p.hold ? 4 : 9) * (ticks && (G.prev.p.x !== p.x || G.prev.p.z !== p.z) ? 1 : 0); view.bob = Math.sin(G.bob) * 1.6;
  const dt = G.mode === 'play' ? elapsed : 0; renderFrame(G.pl, view, dt);
  G.hurtFlash *= Math.exp(-elapsed / 0.25); const bg = [3 / 255 + G.hurtFlash * 0.25, 5 / 255, 11 / 255];
  if (G.out) G.out.draw(G.pl.sel.inst, G.pl.sel.count, G.pl.w, G.pl.h, bg);
  else { const c = G.cpu; compositeCPU(c.img.data, G.pl.w, G.pl.h, 2, G.pl.sel.inst, G.pl.sel.count, G.atlas, G.atlasPx, undefined, G.cvd); c.ctx.putImageData(c.img, 0, 0); }
  if (G.photoShot) { G.photoShot = false; savePhoto($('view')); } // read in the same task as the draw, while the WebGL buffer is valid
  if (S().debug) { const d = $('debug'), ctx = d.getContext('2d'), img = ctx.createImageData(G.pl.w, G.pl.h); debugImage(img.data, G.pl, S().debug); ctx.putImageData(img, 0, 0); }
  G.hud.update(G.sim, elapsed, S().captions); if (S().speedrun) updateTimer();
  if (S().soundCaptions) { G.heartCue = (G.heartCue || 0) - elapsed; if (G.mode === 'play' && G.heartCue <= 0) { G.heartCue = 0.9; G.hud.sound(heartbeatCaption(G.sim)); } } G.hud.renderSounds(S().soundCaptions ? elapsed : 99); G.audio.update(G.sim, G.pl, elapsed, G.mode === 'play' && !G.sim.c.done && !G.sim.c.dead);
  // rolling statistics: G.frames is CPU work time for this frame, G.intervals the time between frames
  const total = performance.now() - simT0; G.frames.push(total);
  if (G.auto && G.mode === 'play') { const t2 = sampleFrame(G.auto, G.pl.remote ? G.pl.stats.ms.total || total : total); if (t2) setTier(t2); } /* a worker's cost is its own frame time */
  if (G.frames.length > 240) G.frames.shift(); G.switchRates.push(G.pl.sel.stats.switchRate); if (G.switchRates.length > 240) G.switchRates.shift();
  if (S().stats && (t | 0) % 6 === 0) { const f = [...G.frames].sort((a, b) => a - b), sw = [...G.switchRates].sort((a, b) => a - b), ms = G.pl.stats.ms, q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0;
    const iv = [...G.intervals].sort((a, b) => a - b);
    $('stats').textContent = `cpu p50 ${q(f, 0.5).toFixed(1)} p95 ${q(f, 0.95).toFixed(1)} ms\ninterval p50 ${q(iv, 0.5).toFixed(1)} p95 ${q(iv, 0.95).toFixed(1)} ms\nsim ${simMs.toFixed(2)} ms x${ticks}\ngbuf ${ms.gbuffer.toFixed(1)} light ${ms.light.toFixed(1)} fog ${ms.fog.toFixed(1)}\ntree ${ms.tree.toFixed(1)} flow ${ms.flow.toFixed(1)} sel ${ms.select.toFixed(1)}\nleaves ${G.pl.qt.stats.leaves} [${G.pl.qt.stats.byLevel}] ovf ${G.pl.qt.stats.overflow}\nglyphs ${G.pl.sel.count} tris ${G.pl.stats.tris} tier ${G.pl.quality} exposure ${(G.pl.stats.exposure ?? 1).toFixed(2)}${G.auto ? ' (auto)' : ''}\nswitch p95 ${(q(sw, 0.95) * 100).toFixed(1)}%\n${G.out ? `gpu upload ${G.out.stats.uploadMs.toFixed(2)} draw ${G.out.stats.drawMs.toFixed(2)}` : 'cpu compositor'}\ntick ${G.sim.tick} hash ${hashState(G.sim).toString(16)}`; }
}

async function boot() {
  try { await loadAssets(); } catch (e) { setHTML($('menu'), html`<div class="card"><h1>ODE</h1><p>Could not load the glyph atlas (${String(e.message || e)}). Serve the folder over HTTP: <code>npm start</code>.</p></div>`); return; }
  const canvas = $('view'); resize(); addEventListener('resize', resize);
  if (params.get('quality')) S().quality = params.get('quality'); if (params.get('stats')) S().stats = true;
  if (!params.get('cpu')) try { G.out = createGLOutput(canvas, G.atlas, G.atlasImage); } catch (e) { console.warn('WebGL2 output unavailable:', e); G.out = null; }
  if (!G.out) { // last-resort CPU compositor fallback
    const oc = new OffscreenCanvas(G.atlasImage.width, G.atlasImage.height), o2 = oc.getContext('2d'); o2.drawImage(G.atlasImage, 0, 0); const d = o2.getImageData(0, 0, oc.width, oc.height);
    G.atlasPx = { pixels: d.data, w: oc.width, h: oc.height, channels: 4 }; if (S().quality !== 'auto') S().quality = 'low'; }
  G.telemetryConfig = await loadTelemetryConfig();
  G.telemetry = createTelemetry({ version: VERSION, endpoint: G.telemetryConfig?.endpoint ?? null, getState: () => G.sim ? { chapter: G.chapter + 1, endless: G.endless, epilogue: G.epilogue || undefined, seed: G.runSeed, tick: G.sim.tick, hash: G.failingInput == null ? hashState(G.sim) : null, failingInput: G.failingInput, log: G.log, base: G.base, tier: G.pl?.quality } : {} });
  G.telemetry.install(report => crashed(report));
  G.input = createInput(canvas); G.input.onPause = pause;
  G.input.onMenuBack = intent => { if (G.mode === 'pause') { resume(); return; } if (intent === 'back') [...document.querySelectorAll('#menu nav button')].find(b => /^(Back|Done)$/.test(b.textContent))?.click(); };
  addEventListener('gamepadconnected', e => { G.hud.alert(`CONTROLLER CONNECTED · ${String(e.gamepad.id).slice(0, 28).toUpperCase()}`, 2.4); }); applySettings(); // applies saved consent before the first event
  G.telemetry.track('session_start', { tier: S().quality, reducedMotion: !!S().reducedMotion, textScale: S().textScale });
  if (!G.out) { canvas.width = G.pl.w * 2; canvas.height = G.pl.h * 2; const ctx = canvas.getContext('2d'); G.cpu = { ctx, img: ctx.createImageData(canvas.width, canvas.height) }; }
  if (matchMedia('(pointer: coarse)').matches) $('touch').hidden = false;
  addEventListener('keydown', e => { if (e.code === 'Escape' && G.mode === 'pause') resume(); });
  addEventListener('keydown', e => photoKey(e, true)); addEventListener('keyup', e => photoKey(e, false));
  $('view').addEventListener('pointermove', e => { if (G.mode === 'photo' && e.buttons & 1) G.photo.yaw += e.movementX * 0.004; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  globalThis.__ode = { G, startChapter, startEndless, title, security: () => ({ trustedTypes: trustedTypesEnforced(), ...htmlStats }), hashState: () => hashState(G.sim), stats: () => ({ tier: G.pl.quality, auto: G.auto ? { tier: G.auto.tier, changes: G.auto.changes, lastP95: G.auto.lastP95 } : null, frames: [...G.frames], intervals: [...G.intervals], switchRates: [...G.switchRates], ms: { ...G.pl.stats.ms }, leaves: { ...G.pl.qt.stats }, glyphs: { ...G.pl.sel.stats }, out: G.out ? { ...G.out.stats, kind: G.out.kind } : { kind: 'cpu' }, tick: G.sim?.tick, mode: G.mode, chapter: G.chapter, cascade: G.pl.stats.cascade }) };
  requestAnimationFrame(frame);
  let shared = null; try { shared = params.get('seed') ? decodeSeed(params.get('seed')) : null; } catch (e) { console.info('ignoring ?seed:', e.message); }
  const urlMods = (+params.get('mods') || 0) & 7;
  if (shared && !shared.flags) startEndless(shared.seed, 1, null, urlMods); else if (params.get('endless')) startEndless(+params.get('endless') || 1, +(params.get('depth') || 1), null, urlMods); else if (params.get('chapter')) startChapter(Math.max(0, Math.min(CHAPTERS.length - 1, +params.get('chapter') - 1))); else title();
}
boot();
