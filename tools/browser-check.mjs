#!/usr/bin/env node
// Browser acceptance checks (needs a local Playwright + Chromium; not a project dependency).
// Usage: node tools/browser-check.mjs [--dir dist] [--out dir] [--seconds 6] [--quality auto] [--gpu]
// Starts the static server itself, then reports JSON:
//   chapters  every chapter loads in play mode with zero console errors; frame p50/p95
//   ui        title -> begin -> pause (Esc) -> settings -> resume, keyboard focus trap, audio running
//   liveops   Endless Choir loads; a deliberate fault shows the crash overlay with replay context, sends nothing
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
    const s = await p.evaluate(() => globalThis.__ode.stats());
    if (out) await p.screenshot({ path: path.join(out, `chapter${c}.png`) });
    report.chapters.push({ chapter: c, tier: s.tier, mode: s.mode, tick: s.tick, output: s.out.kind, glyphs: s.glyphs.emitted, frameP50: q(s.frames, 0.5), frameP95: q(s.frames, 0.95), switchP95: q(s.switchRates.map(v => v * 100), 0.95), errors: errs });
    await p.close();
  }
  { const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errs = watch(p);
    await p.goto(base + '?quality=low'); await p.waitForSelector('text=Begin');
    const title = await p.$$eval('#menu button', bs => bs.map(b => b.textContent + (b.disabled ? ' (disabled)' : '')));
    await p.click('text=Begin'); await p.waitForTimeout(800); await p.keyboard.down('KeyW'); await p.waitForTimeout(800); await p.keyboard.up('KeyW');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200); const paused = await p.$eval('#menuTitle', e => e.textContent).catch(() => null);
    const tabs = []; for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); tabs.push(await p.evaluate(() => document.activeElement?.textContent)); }
    await p.click('text=Settings'); await p.selectOption('select[data-k="reducedMotion"]', 'true'); await p.click('text=Done'); await p.click('text=Resume'); await p.waitForTimeout(500);
    const st = await p.evaluate(() => ({ mode: __ode.G.mode, audio: __ode.G.audio.ctx?.state ?? 'none', reducedMotion: __ode.G.pl.opts.reducedMotion }));
    report.ui = { title, paused, focusCycle: tabs, ...st, errors: errs }; await p.close(); }
  { const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errs = watch(p);
    await p.goto(`${base}?endless=7&depth=2&autoplay=1&quality=low`); await p.waitForTimeout(3000);
    const e = await p.evaluate(() => ({ kicker: document.getElementById('chapterKicker').textContent, mode: __ode.G.mode, tick: __ode.G.sim.tick }));
    await p.evaluate(() => { __ode.G.pl.sel = null; }); await p.waitForTimeout(600); // deliberate render-stage fault
    const c = await p.evaluate(() => ({ mode: __ode.G.mode, overlay: document.getElementById('menuTitle')?.textContent, crashes: __ode.G.telemetry.crashes.length, sent: __ode.G.telemetry.sent, hasReplayContext: !!(__ode.G.telemetry.crashes[0]?.inputs?.length && __ode.G.telemetry.crashes[0]?.endless) }));
    await p.evaluate(() => [...document.querySelectorAll('#menu button')].find(b => b.textContent === 'Restart verse')?.click()); await p.waitForTimeout(800); // recovery rebuilds the pipeline
    const rec = await p.evaluate(() => ({ mode: __ode.G.mode, crashes: __ode.G.telemetry.crashes.length, tick: __ode.G.sim.tick, depth: __ode.G.endless?.depth }));
    report.liveops = { endless: e, crash: c, recovered: rec, errors: errs.filter(x => !/sel/.test(x)) }; await p.close(); }
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
const uiOk = !!report.ui && report.ui.paused === 'PAUSED' && report.ui.mode === 'play' && !report.ui.errors.length
  && report.ui.audio === 'running' && report.ui.reducedMotion === true && report.ui.focusCycle.length > 0 && report.ui.focusCycle.every(t => PAUSE_MENU.has(t));
const ok = report.chapters.every(c => c.mode === 'play' && !c.errors.length) && uiOk && report.hud.every(h => !h.overlaps.length && !h.horizontalScroll && !h.errors.length)
  && report.liveops?.endless.mode === 'play' && report.liveops?.crash.overlay === 'SOMETHING BROKE' && report.liveops.crash.sent === 0 && report.liveops.crash.hasReplayContext
  && report.liveops.recovered.mode === 'play' && report.liveops.recovered.crashes === report.liveops.crash.crashes && report.liveops.recovered.depth === 2;
if (out) fs.writeFileSync(path.join(out, 'browser-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1)); console.log(ok ? 'BROWSER CHECK PASSED' : 'BROWSER CHECK FAILED'); process.exit(ok ? 0 : 1);
