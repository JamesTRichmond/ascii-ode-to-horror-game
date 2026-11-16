// Finds statements swallowed by a trailing line comment: `a(); // note b();` runs a() and silently drops b().
// This has broken the shipped game more than once (events, autoplay, Endless death), so the test suite gates on it.
// Only comments that follow code on the same line are checked; whole-line comments and /* */ blocks are prose.
//
// acorn finds the comments, so strings, template literals and regex literals are never mistaken for them.
// A comment is flagged when some tail of it, starting at a word boundary, parses as JavaScript that does
// something: a call with arguments or ending in `;`, an assignment, an update, a declaration or a control
// statement. Prose ("see the guide", "f.g (x)", "uses scriptURL()") does not parse or does nothing.
import * as acorn from 'acorn';

const PARSE = { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };
const CONTROL = new Set(['IfStatement', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement', 'ReturnStatement', 'ThrowStatement', 'SwitchStatement', 'TryStatement']);

/** True when a parsed program has a statement that would change state if it ran. */
function acts(program, text) {
  for (const s of program.body) {
    if (CONTROL.has(s.type) || s.type === 'VariableDeclaration' || s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') return true;
    if (s.type !== 'ExpressionStatement') continue;
    let e = s.expression; if (e.type === 'ChainExpression') e = e.expression;
    if (e.type === 'AwaitExpression') return true;
    if (e.type === 'UpdateExpression') return true;
    // `t = 0` in prose is maths; `t = 0;`, `G.mode = 'dead'`, `x += 1` and `x = f(y)` are code.
    if (e.type === 'AssignmentExpression' && (e.operator !== '=' || e.left.type !== 'Identifier' || text[s.end - 1] === ';'
      || !['Literal', 'Identifier'].includes(e.right.type))) return true;
    if (e.type === 'ConditionalExpression' || e.type === 'LogicalExpression' || e.type === 'SequenceExpression') return true;
    // A bare `name()` is how prose cites a function, and `CIELAB (D65)` is a parenthetical: a call counts
    // only when `(` touches its callee and it has arguments or a closing `;`.
    if (e.type === 'CallExpression' && !/\s/.test(text[e.callee.end] ?? '') && (e.arguments.length || text[s.end - 1] === ';')) return true;
  }
  return false;
}

/** The first tail of `text` (from a word start) that parses and acts, or null. */
function codeIn(text) {
  if (!/[(=;]/.test(text)) return null;
  for (let i = 0; i < text.length; i++) {
    if (i && !/\s|;/.test(text[i - 1])) continue;
    if (/\s/.test(text[i])) continue;
    const tail = text.slice(i);
    let program; try { program = acorn.parse(tail, PARSE); } catch { continue; }
    if (acts(program, tail)) return tail;
  }
  return null;
}

/** @returns {{line: number, comment: string}[]} */
export function hiddenCode(src) {
  const comments = [];
  try { acorn.parse(src, { ...PARSE, onComment: comments }); }
  catch { // not a whole module (a snippet in a test): find comments with the tokenizer alone
    comments.length = 0;
    try { for (const _ of acorn.tokenizer(src, { ...PARSE, onComment: comments })); } catch { /* keep what was found */ }
  }
  const lineStart = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStart.push(i + 1);
  const lineOf = pos => { let lo = 0, hi = lineStart.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStart[m] <= pos) lo = m; else hi = m - 1; } return lo; };
  const hits = [];
  for (const c of comments) {
    if (c.type !== 'Line') continue;
    const ln = lineOf(c.start);
    if (!src.slice(lineStart[ln], c.start).trim()) continue; // a whole-line comment is prose
    if (codeIn(c.value)) hits.push({ line: ln + 1, comment: c.value.trim() });
  }
  return hits;
}
