// Static ES-module dependency extraction for the build gate. Paths are POSIX ('/') on every OS.
import path from 'node:path';

// import x from '…' · import { a, b as c } from '…' · import * as n from '…' · export { a } from '…' · export * from '…'
// import '…' (side effect) · import('…') with a string literal. The keyword must stand alone (not "important", not import.meta).
const SPEC = /\b(?:import|export)\b\s*(?:\(\s*|[\w$*{}\s,]*?\bfrom\s*)?['"]([^'"\n]+)['"]/g;

/** Every module specifier in a source text, in order. */
export function importSpecifiers(src) { return [...src.matchAll(SPEC)].map(m => m[1]); }

/** Problems for each .js file in `files` (POSIX paths relative to the build root): bare or unresolved imports. */
export function checkImports(files, read) {
  const have = new Set(files), problems = [];
  for (const f of files.filter(f => f.endsWith('.js'))) for (const spec of importSpecifiers(read(f))) {
    if (!spec.startsWith('.')) { problems.push(`${f}: bare import ${spec}`); continue; }
    if (!have.has(path.posix.join(path.posix.dirname(f), spec))) problems.push(`${f}: missing ${spec}`);
  }
  return problems;
}
