#!/usr/bin/env node
// Browser acceptance checks (needs a local Playwright + Chromium; not a project dependency).
// Usage: node tools/browser-check.mjs [--dir dist] [--out dir] [--seconds 6] [--quality auto] [--gpu]
// Starts the static server itself, then reports JSON:
//   chapters  every chapter loads in play mode with zero console errors and the autoplay bot driving; frame p50/p95
//   ui        title -> begin -> pause (Esc) -> settings -> resume, keyboard focus trap, audio running
//   liveops   Endless Choir loads; a deliberate fault shows the crash overlay with replay context, sends nothing;
//             dying in Endless ends the run (mode dead, input off, run-over card)
//   security  Trusted Types enforced; every menu, card and overlay opens with zero CSP violations and zero policy
//             rejections; raw innerHTML, unknown policies, and a hostile menu body are all refused
//   hud       no panel overlap and no horizontal scroll at 1280px/100%, 1280px/200%, 320px/100%
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] ?? true : d; };
const out = arg('out', null), serveDir = path.resolve(root, arg('dir', '.')), seconds = +arg('seconds', 6), quality = arg('quality', 'auto'), port = 8000 + (process.pid % 900);
let chromium;
try { chromium = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright').chromium; }
catch { console.error('Playwright is not installed. Set PLAYWRIGHT_PATH to its package directory, or install it globally.'); process.exit(2); }
const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(port), serveDir], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const args = arg('gpu', false) ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let browser;
try { browser = await chromium.launch({ args: [...args, '--autoplay-policy=no-user-gesture-required'] }); }
catch (e) { server.kill(); console.error('Chromium failed to launch:', e.message); process.exit(2); } // never leave the server holding the port
const base = `http://localhost:${port}/`, report = { browser: browser.version(), quality, seconds, chapters: [], ui: null, hud: [] };
const watch = p => { const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/AudioContext was not allowed/.test(m.text())) errs.push(m.text()); }); return errs; };
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return +(s[Math.min(s.length - 1, Math.floor(s.length * f))] || 0).toFixed(1); };
try {
  for (let c = 1; c <= 9; c++) {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errs = watch(p);
    await p.goto(`${base}?chapter=${c}&autoplay=1&quality=${quality}`); await p.waitForTimeout(seconds * 1000);
    const s = await p.evaluate(() => globalThis.__ode.stats()), botInputs = await p.evaluate(() => __ode.G.bot ? __ode.G.log.filter(Boolean).length : -1);
    if (out) await p.screenshot({ path: path.join(out, `chapter${c}.png`) });
    report.chapters.push({ chapter: c, tier: s.tier, mode: s.mode, tick: s.tick, output: s.out.kind, glyphs: s.glyphs.emitted, frameP50: q(s.frames, 0.5), frameP95: q(s.frames, 0.95), botInputs, switchP95: q(s.switchRates.map(v => v * 100), 0.95), errors: errs });
    await p.close();
  }
  { const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errs = watch(p);
    await p.goto(base + '?quality=low'); await p.waitForSelector('text=Begin');
    const title = await p.$$eval('#menu button', bs => bs.map(b => b.textContent + (b.disabled ? ' (disabled)' : '')));
    await p.click('text=Begin'); await p.waitForTimeout(800); await p.keyboard.down('KeyW'); await p.waitForTimeout(800); await p.keyboard.up('KeyW');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200); const paused = await p.$eval('#menuTitle', e => e.textContent).catch(() => null);
    const tabs = []; for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); tabs.push(await p.evaluate(() => document.activeElement?.textContent)); }
    await p.click('text=Settings'); const selects = await p.$$eval('#menu select', ss => ss.map(e => ({ k: e.dataset.k, options: e.options.length, stray: /<\/?option/.test(e.parentElement.textContent) }))); await p.selectOption('select[data-k="reducedMotion"]', 'true'); await p.click('text=Done'); await p.click('text=Resume'); await p.waitForTimeout(500);
    const st = await p.evaluate(() => ({ mode: __ode.G.mode, audio: __ode.G.audio.ctx?.state ?? 'none', reducedMotion: __ode.G.pl.opts.reducedMotion }));
    // every simulation event must reach the presentation layer (audio, HUD, effects, death/completion flow): force chords
    await p.goto(base + '?chapter=2&quality=low'); await p.waitForFunction(() => globalThis.__ode?.G.sim); await p.waitForTimeout(500);
    await p.evaluate(() => { const G = __ode.G, ev = G.audio.event; G.__presented = 0; G.audio.event = e => { G.__presented++; ev(e); }; G.input.poll = () => 128; });
    await p.waitForTimeout(1500); const events = await p.evaluate(() => ({ presented: __ode.G.__presented, pending: __ode.G.sim.events.length }));
    report.ui = { title, paused, focusCycle: tabs, selects, ...st, events, errors: errs }; await p.close(); }
  { const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errs = watch(p);
    await p.goto(`${base}?endless=7&depth=2&autoplay=1&quality=low`); await p.waitForTimeout(3000);
    const e = await p.evaluate(() => ({ kicker: document.getElementById('chapterKicker').textContent, mode: __ode.G.mode, tick: __ode.G.sim.tick }));
    await p.evaluate(() => { __ode.G.pl.sel = null; }); await p.waitForTimeout(600); // deliberate render-stage fault
    const c = await p.evaluate(() => ({ mode: __ode.G.mode, overlay: document.getElementById('menuTitle')?.textContent, crashes: __ode.G.telemetry.crashes.length, sent: __ode.G.telemetry.sent, hasReplayContext: !!(__ode.G.telemetry.crashes[0]?.inputs?.length && __ode.G.telemetry.crashes[0]?.endless) }));
    await p.evaluate(() => [...document.querySelectorAll('#menu button')].find(b => b.textContent === 'Restart verse')?.click()); await p.waitForTimeout(800); // recovery rebuilds the pipeline
    const rec = await p.evaluate(() => ({ mode: __ode.G.mode, crashes: __ode.G.telemetry.crashes.length, tick: __ode.G.sim.tick, depth: __ode.G.endless?.depth }));
    await p.evaluate(() => { const s = __ode.G.sim; s.c.dead = 1; s.p.hp = 0; s.events.push({ type: 'death', x: s.p.x, z: s.p.z, a: 0, tick: s.tick }); }); await p.waitForTimeout(2200); /* the same event the sim emits on a fatal hit */
    const dead = await p.evaluate(() => ({ mode: __ode.G.mode, inputEnabled: __ode.G.input.enabled, card: document.getElementById('menuTitle')?.textContent, kicker: document.querySelector('#menu h2')?.textContent }));
    report.liveops = { endless: e, crash: c, recovered: rec, dead, errors: errs }; /* unfiltered: the deliberate fault is caught by the frame guard and logs nothing */ await p.close(); }
  { const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errs = watch(p);
    await p.addInitScript(() => { globalThis.__csp = []; document.addEventListener('securitypolicyviolation', e => __csp.push({ directive: e.effectiveDirective, sample: e.sample })); localStorage.setItem('ode.save.v1', JSON.stringify({ version: 1, unlocked: 9, endings: [2], best: {}, settings: { quality: 'low' } })); });
    await p.goto(base); await p.waitForSelector('text=Begin'); const seen = [];
    const card = async () => seen.push(await p.$eval('#menuTitle', e => e.textContent).catch(() => null));
    const click = async t => { await p.click(`#menu button:text-is("${t}")`); await p.waitForTimeout(150); await card(); };
    await card(); for (const [open, back] of [['How to play', 'Back'], ['Settings', 'Done'], ['Chapters', 'Back'], ['Endless Choir', 'Back']]) { await click(open); await click(back); }
    await click('Begin'); await p.waitForTimeout(400); await p.keyboard.press('Escape'); await p.waitForTimeout(200); await card(); await click('Settings'); await click('Done'); await click('Resume');
    const fire = type => p.evaluate(t => { const s = __ode.G.sim; if (t === 'death') { s.c.dead = 1; s.p.hp = 0; } else s.c.done = 1; s.events.push({ type: t, x: s.p.x, z: s.p.z, a: 0, tick: s.tick }); }, type);
    await fire('death'); await p.waitForTimeout(2000); await card(); await click('Begin the chapter again'); await p.waitForTimeout(300);
    await fire('complete'); await p.waitForTimeout(900); await card();
    await p.evaluate(() => __ode.startChapter(8)); await p.waitForTimeout(300); await p.evaluate(() => { __ode.G.sim.c.ending = 1; }); await fire('complete'); await p.waitForTimeout(900); await card();
    await p.evaluate(() => __ode.startEndless(5, 2)); await p.waitForTimeout(300); await fire('complete'); await p.waitForTimeout(900); await card(); await click('Verse 3'); await p.waitForTimeout(300);
    await fire('death'); await p.waitForTimeout(2000); await card(); await click('Begin again'); await p.waitForTimeout(300);
    await p.evaluate(() => { __ode.G.pl.sel = null; }); await p.waitForTimeout(600); await card(); /* deliberate render fault: crash overlay with the error text */
    const clean = await p.evaluate(() => ({ violations: [...__csp], ...__ode.security() })), cleanErrors = [...errs];
    const probes = await p.evaluate(() => {
      const refused = f => { try { f(); return false; } catch { return true; } }, el = document.createElement('div');
      return { rawInnerHTML: refused(() => { el.innerHTML = '<b>x</b>'; }), rawEmptyInnerHTML: refused(() => { el.innerHTML = ''; }), insertAdjacentHTML: refused(() => el.insertAdjacentHTML('beforeend', '<b>x</b>')),
        newPolicy: refused(() => trustedTypes.createPolicy('attacker', { createHTML: s => s })), duplicatePolicy: refused(() => trustedTypes.createPolicy('ode-html', { createHTML: s => s })),
        hostileMenu: refused(() => __ode.G.hud.menu('X', '<img src=x onerror="globalThis.__pwned=1">', [])), scriptElement: refused(() => { const s = document.createElement('script'); s.textContent = 'globalThis.__pwned=1'; document.body.append(s); }),
        pwned: !!globalThis.__pwned };
    });
    await p.waitForTimeout(300); probes.reported = await p.evaluate(n => [...new Set(__csp.slice(n).map(v => v.directive))].sort(), clean.violations.length); /* violation events are dispatched as a later task */
    report.security = { cards: seen, ...clean, errors: cleanErrors, probes }; await p.close(); }
  // [css width, css height, HUD text scale, device pixel ratio]: 200% text; 200% browser zoom (half the CSS viewport at 2x density); narrow phone
  for (const [w, h, scale, dpr] of [[1280, 720, 1, 1], [1280, 720, 2, 1], [640, 360, 1, 2], [320, 640, 1, 1]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr }), errs = watch(p);
    await p.addInitScript(sc => localStorage.setItem('ode.save.v1', JSON.stringify({ version: 1, settings: { textScale: sc, quality: 'low' } })), scale);
    await p.goto(`${base}?chapter=4&autoplay=1`); await p.waitForTimeout(3000);
    const r = await p.evaluate(() => { const r = [...document.querySelectorAll('#hud .panel')].filter(e => getComputedStyle(e).visibility !== 'hidden' && e.offsetParent).map(e => [e.id || e.className, e.getBoundingClientRect()]); const o = []; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const a = r[i][1], c = r[j][1]; if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) o.push(r[i][0] + ' x ' + r[j][0]); } return { overlaps: o, horizontalScroll: document.documentElement.scrollWidth > innerWidth, hpBarPx: Math.round(document.getElementById('hpBar').getBoundingClientRect().width) }; });
    if (out) await p.screenshot({ path: path.join(out, `hud-${w}-${scale * 100}-dpr${dpr}.png`) });
    report.hud.push({ viewport: `${w}x${h}`, textScale: scale, devicePixelRatio: dpr, ...r, errors: errs }); await p.close();
  }
} finally { await browser.close(); server.kill(); }
const PAUSE_MENU = new Set(['Resume', 'Settings', 'Restart chapter', 'Save and quit to title']);
const uiOk = !!report.ui && report.ui.selects.length > 0 && report.ui.selects.every(x => x.options >= 2 && !x.stray) /* every settings dropdown has real <option>s, none shown as text */ && report.ui.paused === 'PAUSED' && report.ui.mode === 'play' && !report.ui.errors.length
  && report.ui.audio === 'running' && report.ui.reducedMotion === true && report.ui.events.presented > 0 && report.ui.events.pending === 0 && report.ui.focusCycle.length > 0 && report.ui.focusCycle.every(t => PAUSE_MENU.has(t));
const SEC_CARDS = ['ODE', 'HOW TO PLAY', 'SETTINGS', 'CHAPTERS', 'ENDLESS CHOIR', 'PAUSED', 'UNWRITTEN', 'YOU SING', 'VERSE 2', 'SOMETHING BROKE'];
const sec = report.security, secOk = !!sec && sec.trustedTypes === true && !sec.violations.length && sec.rejected === 0 && sec.accepted >= new Set(sec.cards.filter(Boolean)).size && !sec.errors.length
  && SEC_CARDS.every(t => sec.cards.includes(t)) && Object.entries(sec.probes).every(([k, v]) => k === 'pwned' ? v === false : k === 'reported' ? ['require-trusted-types-for', 'trusted-types'].every(d => v.includes(d)) : v === true);
const ok = secOk && report.chapters.every(c => c.mode === 'play' && c.botInputs > 0 && !c.errors.length) && uiOk && report.hud.every(h => !h.overlaps.length && !h.horizontalScroll && !h.errors.length)
  && report.liveops?.endless.mode === 'play' && report.liveops?.crash.overlay === 'SOMETHING BROKE' && report.liveops.crash.sent === 0 && report.liveops.crash.hasReplayContext
  && report.liveops.recovered.mode === 'play' && report.liveops.recovered.crashes === report.liveops.crash.crashes && report.liveops.recovered.depth === 2 && !report.liveops.errors.length
  && report.liveops.dead.mode === 'dead' && report.liveops.dead.inputEnabled === false && report.liveops.dead.card === 'UNWRITTEN' && report.liveops.dead.kicker === 'ENDLESS CHOIR';
if (out) fs.writeFileSync(path.join(out, 'browser-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1)); console.log(ok ? 'BROWSER CHECK PASSED' : 'BROWSER CHECK FAILED'); process.exit(ok ? 0 : 1);
