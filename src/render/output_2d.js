// Text fallback output (guide phase 6, task 5-1): a character grid with dirty-run coalescing.
// Only spans whose character or colour changed since the previous frame are redrawn, and
// adjacent changed cells of one colour are merged into a single fillText call.
import { toneMap } from './output_cpu.js';
import { INSTANCE_FLOATS } from './select.js';

const FALLBACK = { box: '+', rune: '*' };
export class TextGrid {
  constructor(cols, rows) { this.cols = cols; this.rows = rows; const n = cols * rows; this.ch = new Uint32Array(n).fill(32); this.col = new Uint16Array(n); this.pch = new Uint32Array(n).fill(0xffffffff); this.pcol = new Uint16Array(n); this.stats = { runs: 0, cells: 0, fullCells: n }; }
  clear() { this.ch.fill(32); this.col.fill(0); }
  /** colour is quantised to 4 bits per channel so neighbouring cells can share a run */
  set(x, y, codepoint, r, g, b) { if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return; const i = y * this.cols + x; this.ch[i] = codepoint; this.col[i] = ((toneMap(r) * 15) << 8) | ((toneMap(g) * 15) << 4) | (toneMap(b) * 15 | 0); }
  /** Rasterise an instance stream onto the grid (one glyph per covered cell centre, no rotation). */
  /** keepBoxes: terminals have box-drawing glyphs, so only canvas text needs the '+' fallback. */
  fromInstances(inst, count, atlas, w, h, keepBoxes = false) {
    this.clear(); const sx = this.cols / w, sy = this.rows / h;
    for (let n = 0; n < count; n++) { const o = n * INSTANCE_FLOATS, g = inst[o + 6] | 0; let cp = atlas.codepoint[g]; if (cp >= 0x2500 && cp < 0x2580) { if (!keepBoxes) cp = FALLBACK.box.charCodeAt(0); } else if (cp >= 0x16a0 && cp < 0x1700) cp = FALLBACK.rune.charCodeAt(0); else if (cp >= 0x1fb00) cp = 0x2588; this.set((inst[o] * sx) | 0, (inst[o + 1] * sy) | 0, cp, inst[o + 7], inst[o + 8], inst[o + 9]); }
    return this;
  }
  /** Collect dirty runs: [{x, y, text, color}] and swap history. Pass full=true to force a full redraw. */
  diff(full = false) {
    const runs = [], { cols, rows, ch, col, pch, pcol } = this; let cells = 0;
    for (let y = 0; y < rows; y++) { let x = 0; while (x < cols) {
      const i = y * cols + x; if (!full && ch[i] === pch[i] && col[i] === pcol[i]) { x++; continue; }
      const c = col[i], start = x; let text = '';
      while (x < cols) { const j = y * cols + x; if (col[j] !== c || (!full && ch[j] === pch[j] && col[j] === pcol[j])) break; text += String.fromCodePoint(ch[j]); x++; cells++; }
      runs.push({ x: start, y, text, color: c });
    } }
    pch.set(ch); pcol.set(col); this.stats.runs = runs.length; this.stats.cells = cells; return runs;
  }
  /** Draw dirty runs into a 2D context. */
  flush(ctx, cellW, cellH, full = false) {
    const runs = this.diff(full); ctx.textBaseline = 'top'; ctx.font = `${cellH}px monospace`;
    for (const r of runs) { ctx.fillStyle = '#03050b'; ctx.fillRect(r.x * cellW, r.y * cellH, r.text.length * cellW, cellH); ctx.fillStyle = `rgb(${((r.color >> 8) & 15) * 17},${((r.color >> 4) & 15) * 17},${(r.color & 15) * 17})`; ctx.fillText(r.text, r.x * cellW, r.y * cellH); }
    return runs.length;
  }
}
