// Minimal TrueType (glyf) outline reader: cmap 4/12, simple + composite glyphs, hmtx.
export function parseTTF(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = o => dv.getUint16(o), i16 = o => dv.getInt16(o), u32 = o => dv.getUint32(o);
  const tables = {};
  for (let i = 0, n = u16(4); i < n; i++) {
    const o = 12 + i * 16;
    tables[String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3])] = { off: u32(o + 8), len: u32(o + 12) };
  }
  const head = tables.head.off, unitsPerEm = u16(head + 18), locaLong = i16(head + 50) === 1;
  const hhea = tables.hhea.off, ascender = i16(hhea + 4), descender = i16(hhea + 6), nH = u16(hhea + 34);
  const numGlyphs = u16(tables.maxp.off + 4);
  const loca = i => locaLong ? u32(tables.loca.off + i * 4) : u16(tables.loca.off + i * 2) * 2;
  const advance = g => u16(tables.hmtx.off + Math.min(g, nH - 1) * 4);

  // cmap: prefer format 12, fall back to format 4.
  const cmapOff = tables.cmap.off; let sub4 = 0, sub12 = 0;
  for (let i = 0, n = u16(cmapOff + 2); i < n; i++) {
    const o = cmapOff + u32(cmapOff + 4 + i * 8 + 4), f = u16(o);
    if (f === 12) sub12 = o; else if (f === 4) sub4 = o;
  }
  function glyphIndex(cp) {
    if (sub12) {
      for (let i = 0, n = u32(sub12 + 12); i < n; i++) {
        const o = sub12 + 16 + i * 12, s = u32(o), e = u32(o + 4);
        if (cp >= s && cp <= e) return u32(o + 8) + cp - s;
      }
    }
    if (sub4 && cp <= 0xffff) {
      const segX2 = u16(sub4 + 6), endO = sub4 + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
      for (let i = 0; i < segX2; i += 2) {
        if (cp > u16(endO + i)) continue;
        const start = u16(startO + i); if (cp < start) return 0;
        const ro = u16(rangeO + i);
        if (ro === 0) return (cp + i16(deltaO + i)) & 0xffff;
        const g = u16(rangeO + i + ro + (cp - start) * 2);
        return g ? (g + i16(deltaO + i)) & 0xffff : 0;
      }
    }
    return 0;
  }

  /** @returns {Array<Array<{x:number,y:number,on:boolean}>>} contours in font units */
  function contours(g, depth = 0) {
    if (g >= numGlyphs || depth > 6) return [];
    const a = loca(g), b = loca(g + 1); if (a === b) return [];
    let o = tables.glyf.off + a; const nc = i16(o); o += 10;
    if (nc >= 0) {
      const ends = []; for (let i = 0; i < nc; i++, o += 2) ends.push(u16(o));
      const np = nc ? ends[nc - 1] + 1 : 0; o += 2 + u16(o);
      const flags = [];
      while (flags.length < np) { const f = buf[o++]; flags.push(f); if (f & 8) for (let r = buf[o++]; r > 0; r--) flags.push(f); }
      const xs = [], ys = []; let v = 0;
      for (const f of flags) { if (f & 2) { const d = buf[o++]; v += f & 16 ? d : -d; } else if (!(f & 16)) { v += i16(o); o += 2; } xs.push(v); }
      v = 0;
      for (const f of flags) { if (f & 4) { const d = buf[o++]; v += f & 32 ? d : -d; } else if (!(f & 32)) { v += i16(o); o += 2; } ys.push(v); }
      const out = []; let s = 0;
      for (const e of ends) { const c = []; for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) }); out.push(c); s = e + 1; }
      return out;
    }
    const out = []; let flags;
    do {
      flags = u16(o); const gi = u16(o + 2); o += 4; let dx, dy;
      if (flags & 1) { dx = i16(o); dy = i16(o + 2); o += 4; } else { dx = dv.getInt8(o); dy = dv.getInt8(o + 1); o += 2; }
      let m = [1, 0, 0, 1]; const f2 = x => x / 16384;
      if (flags & 8) { m[0] = m[3] = f2(i16(o)); o += 2; }
      else if (flags & 0x40) { m[0] = f2(i16(o)); m[3] = f2(i16(o + 2)); o += 4; }
      else if (flags & 0x80) { m = [f2(i16(o)), f2(i16(o + 2)), f2(i16(o + 4)), f2(i16(o + 6))]; o += 8; }
      for (const c of contours(gi, depth + 1)) out.push(c.map(p => ({ x: m[0] * p.x + m[2] * p.y + dx, y: m[1] * p.x + m[3] * p.y + dy, on: p.on })));
    } while (flags & 0x20);
    return out;
  }

  /** Contours -> edge segments. Each edge: {p:[[x,y],...]} with 2 (line) or 3 (quadratic) points. */
  function edges(g) {
    return contours(g).map(c => {
      const pts = [];
      for (let i = 0; i < c.length; i++) { // insert implied on-curve midpoints
        const a = c[i], b = c[(i + 1) % c.length]; pts.push(a);
        if (!a.on && !b.on) pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
      }
      const start = pts.findIndex(p => p.on); if (start < 0) return [];
      const out = [], n = pts.length; let prev = pts[start];
      for (let k = 1; k <= n; k++) {
        const p = pts[(start + k) % n];
        if (p.on) { out.push({ p: [[prev.x, prev.y], [p.x, p.y]] }); prev = p; }
        else { const q = pts[(start + k + 1) % n]; out.push({ p: [[prev.x, prev.y], [p.x, p.y], [q.x, q.y]] }); prev = q; k++; }
      }
      return out.filter(e => e.p.length === 3 || e.p[0][0] !== e.p[1][0] || e.p[0][1] !== e.p[1][1]);
    }).filter(c => c.length);
  }
  return { unitsPerEm, ascender, descender, glyphIndex, advance, edges };
}
