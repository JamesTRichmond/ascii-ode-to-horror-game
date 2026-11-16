// Markup safety under Trusted Types (CSP: require-trusted-types-for 'script'; trusted-types ode-html).
// 1. html`…` escapes every interpolated value unless it is itself html`…` output (arrays are joined), so data
//    such as chapter text, version strings or error messages can never become markup.
// 2. setHTML() is the game's only HTML sink. It goes through the 'ode-html' Trusted Types policy, whose
//    createHTML accepts only an allowlist of tags and attributes: no script, no event handlers, no URLs,
//    no inline style. Where Trusted Types is unsupported the same check runs before the plain assignment,
//    so every browser gets the allowlist and Trusted Types browsers also block every other sink.
// 3. scriptURL() is the only way to make a TrustedScriptURL (workers, service worker): same-origin .js only.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHTML = v => String(v).replace(/[&<>"']/g, c => ESC[c]);

class SafeHTML { constructor(s) { this.s = s; } toString() { return this.s; } }
export const isSafeHTML = v => v instanceof SafeHTML;
const part = v => v instanceof SafeHTML ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : escapeHTML(v);
/** Tagged template: `html\`<p>${text}</p>\`` escapes text; nested html`` and arrays of it pass through. */
export function html(strings, ...values) { let s = strings[0]; for (let i = 0; i < values.length; i++) s += part(values[i]) + strings[i + 1]; return new SafeHTML(s); }
/** Static markup written by hand elsewhere (not built with html``): not escaped, still validated at the sink. */
export const markup = s => new SafeHTML(String(s ?? ''));

const TAGS = new Set('div span p h1 h2 h3 nav button kbd b i strong em code pre small br hr ul ol li dl dt dd table thead tbody tr th td label select option input textarea section sup sub abbr'.split(' '));
const ATTRS = new Set('class id role hidden disabled selected checked readonly multiple type value min max step rows cols for title tabindex colspan rowspan scope lang name placeholder maxlength spellcheck autocomplete accept'.split(' '));
const TYPES = new Set(['range', 'checkbox', 'number', 'text', 'file', 'button']);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/y;
const ATTR = /\s+([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
export const htmlStats = { accepted: 0, rejected: 0, lastRejection: '' };

/** Returns the markup unchanged if every tag and attribute is on the allowlist; throws TypeError otherwise. */
export function checkMarkup(s) {
  s = String(s); const fail = why => { htmlStats.rejected++; htmlStats.lastRejection = why; throw new TypeError('ode-html policy: ' + why); };
  for (let i = s.indexOf('<'); i >= 0; i = s.indexOf('<', i)) {
    TAG.lastIndex = i; const m = TAG.exec(s); if (!m) fail(`unparseable markup at ${i}: ${s.slice(i, i + 24)}`);
    const tag = m[2].toLowerCase(); if (!TAGS.has(tag)) fail(`tag <${tag}> is not allowed`);
    if (m[1] && m[3].trim()) fail(`closing tag </${tag}> has attributes`);
    for (ATTR.lastIndex = 0; ATTR.lastIndex < m[3].length;) {
      const a = ATTR.exec(m[3]); if (!a) break; const name = a[1].toLowerCase(), value = a[2] ?? a[3] ?? a[4] ?? '';
      if (!ATTRS.has(name) && !/^(data|aria)-[a-z][a-z0-9-]*$/.test(name)) fail(`attribute ${name} on <${tag}> is not allowed`);
      if (name === 'type' && !TYPES.has(value.toLowerCase())) fail(`type="${value}" is not allowed`);
    }
    i = TAG.lastIndex;
  }
  htmlStats.accepted++; return s;
}
/** Same origin and a .js path, or throws. base defaults to the document URL. */
export function checkScriptURL(u, base = globalThis.location?.href) {
  const url = new URL(String(u), base);
  if (url.origin !== new URL(base).origin || !/\.m?js$/.test(url.pathname) || url.username || url.password) throw new TypeError('ode-html policy: script URL not allowed: ' + url.href);
  return url.href;
}

const policy = globalThis.trustedTypes?.createPolicy?.('ode-html', { createHTML: checkMarkup, createScriptURL: u => checkScriptURL(u) }) ?? null;
export const trustedTypesEnforced = () => !!policy;
/** The only innerHTML write in the game. Accepts html``/markup() output; plain strings are treated as markup() and validated. */
export function setHTML(el, value) { const s = isSafeHTML(value) ? value.s : String(value ?? ''); el.innerHTML = policy ? policy.createHTML(s) : checkMarkup(s); }
/** Script URL for new Worker() / serviceWorker.register(): a TrustedScriptURL where supported, else the checked string. */
export const scriptURL = u => policy ? policy.createScriptURL(String(u)) : checkScriptURL(u);
