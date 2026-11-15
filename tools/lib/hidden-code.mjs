// Finds statements swallowed by a trailing line comment: `a(); // note b();` runs a() and silently drops b().
// This has broken the shipped game more than once (events, autoplay, Endless death), so the test suite gates on it.
// Only comments that follow code on the same line are checked; whole-line comments and /* */ blocks are prose.
const CODE = [
  /[\w$\])]\??\.[\w$]+(\?\.)?(\((?!\s*\))|\s*=(?![=>]))/, /* member call or member assignment: G.bot = …, f.g(x); prose 'f.g (x)' has a space */
  /\)\s*;/, /* a finished call statement: …); */
  /\b(const|let|var)\s+[\w$]+\s*=/, /* a declaration */
  /;\s*(if|for|while|return|await|const|let)\b/, /* a statement after a semicolon */
  /\b(if|for|while)\s*\([^)]*\)\s*[\w${]/, /* if (…) stmt */
];
const REGEX_BEFORE = /(^|[=(,:;!&|?{}[\]]|\breturn|\btypeof)\s*$/;

/** @returns {{line: number, comment: string}[]} */
export function hiddenCode(src) {
  const hits = [];
  src.split('\n').forEach((line, i) => {
    let q = null;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (q) { if (ch === '\\') j++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
      if (ch !== '/') continue;
      if (line[j + 1] === '*') { const k = line.indexOf('*/', j + 2); if (k < 0) return; j = k + 1; continue; }
      if (line[j + 1] === '/') {
        const text = line.slice(j + 2);
        if (line.slice(0, j).trim() && CODE.some(r => r.test(text))) hits.push({ line: i + 1, comment: text.trim() });
        return;
      }
      if (REGEX_BEFORE.test(line.slice(0, j))) { // a regex literal: skip to its closing slash (outside a class)
        let cls = false; for (j++; j < line.length; j++) { const c = line[j]; if (c === '\\') j++; else if (c === '[') cls = true; else if (c === ']') cls = false; else if (c === '/' && !cls) break; }
      }
    }
  });
  return hits;
}
