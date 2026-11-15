import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { html, markup, checkMarkup, checkScriptURL, escapeHTML, htmlStats, trustedTypesEnforced } from '../src/game/safe-html.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOSTILE = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', "' onfocus='alert(1)' autofocus='", '<a href="javascript:alert(1)">x</a>', '<iframe srcdoc="<script>1</script>">'];

test('html`` escapes every interpolated value; nested html`` and arrays pass through; null and false render nothing', () => {
  for (const h of HOSTILE) { const out = String(html`<p title="${h}">${h}</p>`); assert.equal(out, `<p title="${escapeHTML(h)}">${escapeHTML(h)}</p>`); assert.doesNotThrow(() => checkMarkup(out)); assert.ok(!/<(script|img|svg|a|iframe)\b/.test(out)); }
  assert.equal(String(html`<ul>${['a<', 'b'].map(x => html`<li>${x}</li>`)}</ul>`), '<ul><li>a&lt;</li><li>b</li></ul>');
  assert.equal(String(html`<p>${null}${undefined}${false}${0}</p>`), '<p>0</p>');
  assert.equal(String(markup('<b>x</b>')), '<b>x</b>');
});

test('ode-html policy rejects script-capable markup in every form', () => {
  const before = htmlStats.rejected;
  const bad = [...HOSTILE.filter(h => h.includes('<')), '<SCRIPT>x</SCRIPT>', '<p onclick="x">', '<p title="a" onmouseover="b">', '<p/onclick=x>', '<p style="background:url(x)">', '<form action="x"><button formaction="x">', '<input type="image" src="x">', '<math><mi>x</mi></math>', '<template><p></p></template>', '<!-- x -->', '<p>a < b</p>', '<object data="x">', '<base href="x">', '<link rel="stylesheet" href="x">', '<meta http-equiv="refresh">', '<p data-x="1" src="y">'];
  for (const s of bad) assert.throws(() => checkMarkup(s), TypeError, s);
  assert.equal(htmlStats.rejected - before, bad.length);
});

test('ode-html policy accepts the markup the menus use', () => {
  const ok = ['<div class="card" role="dialog" aria-modal="true" aria-labelledby="menuTitle"><h2>ODE</h2><h1 id="menuTitle">PAUSED</h1><p class="stanza">We are the music makers,\nAnd we are…</p><nav><button data-i="0" class="primary" >Resume</button><button data-i="1" class="" disabled>Chapters</button></nav></div>',
    '<label>Render quality <select data-k="quality"><option value="auto" selected>auto</option><option value="low" >low (160×90)</option></select></label><label>Volume <input type="range" min="0" max="1" step="0.05" value="0.8" data-k="volume"></label>',
    '<dl><dt>W A S D</dt><dd>Walk and strafe</dd></dl><p><code>TypeError: x</code> <kbd>Esc</kbd></p><table><thead><tr><th scope="col">Split</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    '<textarea rows="4" spellcheck="false" aria-label="Save code" readonly></textarea><input type="file" accept=".json" data-import><input type="checkbox" checked>'];
  for (const s of ok) assert.equal(checkMarkup(s), s);
});

test('script URLs: same-origin .js only', () => {
  const base = 'https://ode.example/play/index.html';
  assert.equal(checkScriptURL('src/render/worker.js', base), 'https://ode.example/play/src/render/worker.js');
  assert.equal(checkScriptURL('/sw.js', base), 'https://ode.example/sw.js');
  for (const u of ['https://evil.example/x.js', '//evil.example/x.js', 'data:text/javascript,1', 'javascript:alert(1)', 'blob:https://ode.example/1', 'src/data.json', 'https://u:p@ode.example/x.js']) assert.throws(() => checkScriptURL(u, base), TypeError, u);
});

test('the shipped CSP enforces Trusted Types with the single ode-html policy and no unsafe sources', () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')), csp = v.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  const dir = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(dir['require-trusted-types-for'], ["'script'"]); assert.deepEqual(dir['trusted-types'], ['ode-html']); assert.deepEqual(dir['script-src'], ["'self'"]);
  assert.ok(!/unsafe-|allow-duplicates|\*/.test(csp), csp); assert.equal(trustedTypesEnforced(), false, 'Node has no Trusted Types; the allowlist still runs');
});

test('no HTML or script sink in src outside safe-html.js', () => {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : /\.js$/.test(e.name) ? [path.join(d, e.name)] : []);
  const SINK = /\.(innerHTML|outerHTML)\s*[+]?=(?!=)|\binsertAdjacentHTML\s*\(|\bdocument\.write(ln)?\s*\(|\bsrcdoc\b|\bcreateContextualFragment\s*\(|\bDOMParser\b|\bnew\s+Function\s*\(|\beval\s*\(|\bsetTimeout\s*\(\s*['"`]/;
  const hits = walk(path.join(root, 'src')).filter(f => !f.endsWith('safe-html.js')).flatMap(f => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => SINK.test(l) ? `${path.relative(root, f)}:${i + 1}` : null).filter(Boolean));
  assert.deepEqual(hits, [], 'route markup through setHTML(el, html`…`) from src/game/safe-html.js');
});
