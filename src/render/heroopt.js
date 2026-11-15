// Guide task 3-3: offline differentiable asset optimisation for hero glyph art.
//
// A hero image (coverage 0..1) is approximated by a grid of glyphs. Each cell holds logits over a candidate alphabet;
// the soft assignment p = softmax(logits / tau) drives a differentiable rasteriser: the rendered image is
// sum_g p[c][g] * bitmap[g] in every cell, where bitmap[g] is the glyph's coverage reconstructed from the MSDF atlas at
// the cell's pixel size. The loss is perceptual: L2 between Gaussian-blurred render and blurred target. The blur couples
// neighbouring cells, which is exactly what independent per-cell matching (classic ASCII art) cannot see: strokes that
// continue across cell borders, and darkness balanced over a neighbourhood. A smaller unblurred term (weight `detail`)
// keeps edges in place, so the optimiser cannot satisfy the blurred term with mean-matching texture noise. Gradients are analytic (blur is symmetric, so
// dL/dI = K * (K * I - K * T)); logits are updated with Adam while tau is annealed, and the discrete export is the
// arg-max. The result reports the relaxed loss, the discrete export's loss, and the per-cell greedy baseline.
const median = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

/** Coverage bitmaps (cw x ch each) for glyph ids; id -1 is the blank cell. Area-averaged from the full-res MSDF tile. */
export function glyphBitmaps(atlas, atlasPx, ids, cw, ch) {
  const out = new Float32Array(ids.length * cw * ch), tw = atlas.tileW, tH = atlas.tileH, px = atlasPx.pixels, aw = atlasPx.w, chn = atlasPx.channels, sx = tw / cw, sy = tH / ch;
  ids.forEach((g, n) => {
    if (g < 0) return; const ox = (g % atlas.cols) * tw, oy = Math.floor(g / atlas.cols) * tH;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let s = 0, k = 0;
      for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
        const p = ((oy + yy) * aw + ox + xx) * chn, m = median(px[p], px[p + 1], px[p + 2]) / 255; s += Math.min(1, Math.max(0, (m - 0.5) * atlas.range + 0.5)); k++;
      }
      out[(n * ch + y) * cw + x] = s / k;
    }
  });
  return out;
}

function gaussian(sigma) { const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1); let s = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; } return k.map(v => v / s); }
function blur(src, W, H, k, tmp, out) { // separable, clamp-to-edge
  const r = (k.length - 1) >> 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let i = -r; i <= r; i++) s += k[i + r] * src[y * W + Math.min(W - 1, Math.max(0, x + i))]; tmp[y * W + x] = s; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let i = -r; i <= r; i++) s += k[i + r] * tmp[Math.min(H - 1, Math.max(0, y + i)) * W + x]; out[y * W + x] = s; }
  return out;
}

/** The relaxed problem: loss and analytic gradient of the logits at a temperature. Shared by the optimiser and tests. */
export function heroProblem(target, cols, rows, cw, ch, B, G, opts = {}) {
  const W = cols * cw, H = rows * ch, N = cols * rows, P = cw * ch, k = gaussian(opts.sigma ?? 1.2), lam = opts.detail ?? 0.25;
  const tmp = new Float32Array(W * H), tmp2 = new Float32Array(W * H), KT = blur(target, W, H, k, tmp, new Float32Array(W * H)), I = new Float32Array(W * H), KI = new Float32Array(W * H), R = new Float32Array(W * H), p = new Float32Array(N * G), Gc = new Float32Array(G);
  const render = fill => { for (let c = 0; c < N; c++) { const cx = (c % cols) * cw, cy = ((c / cols) | 0) * ch; for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) I[(cy + y) * W + cx + x] = fill(c, y * cw + x); } };
  const imageLoss = () => { blur(I, W, H, k, tmp, KI); let s = 0; for (let i = 0; i < W * H; i++) { const d = KI[i] - KT[i], e = I[i] - target[i]; s += d * d + lam * e * e; } return s / (W * H); };
  const softmax = (th, tau) => { for (let c = 0; c < N; c++) { let mx = -Infinity; for (let g = 0; g < G; g++) mx = Math.max(mx, th[c * G + g] / tau); let z = 0; for (let g = 0; g < G; g++) { const e = Math.exp(th[c * G + g] / tau - mx); p[c * G + g] = e; z += e; } for (let g = 0; g < G; g++) p[c * G + g] /= z; } };
  const relaxed = (th, tau) => { softmax(th, tau); render((c, j) => { let s = 0; for (let g = 0; g < G; g++) s += p[c * G + g] * B[g * P + j]; return s; }); return imageLoss(); };
  return {
    W, H, N, P, p,
    loss: relaxed,
    /** Loss and dL/dlogits (into `out`). L = mean(|K(I-T)|^2 + lam |I-T|^2), so dL/dI = 2/(WH) (K(K I - K T) + lam (I - T)). */
    grad(th, tau, out) {
      const L = relaxed(th, tau);
      for (let i = 0; i < W * H; i++) tmp[i] = KI[i] - KT[i]; blur(tmp, W, H, k, tmp2, R); const sc = 2 / (W * H); for (let i = 0; i < W * H; i++) R[i] = sc * (R[i] + lam * (I[i] - target[i]));
      for (let c = 0; c < N; c++) {
        const cx = (c % cols) * cw, cy = ((c / cols) | 0) * ch; let mean = 0;
        for (let g = 0; g < G; g++) { let s = 0; for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) s += R[(cy + y) * W + cx + x] * B[g * P + y * cw + x]; Gc[g] = s; mean += p[c * G + g] * s; }
        for (let g = 0; g < G; g++) out[c * G + g] = (p[c * G + g] * (Gc[g] - mean)) / tau; // softmax Jacobian
      }
      return L;
    },
    discrete(ids) { render((c, j) => B[ids[c] * P + j]); return imageLoss(); },
  };
}

/**
 * @param target Float32Array (cols*cw) x (rows*ch) coverage
 * @param B glyph bitmaps from glyphBitmaps (G candidates)
 * @returns {{ids, greedyIds, relaxedLoss, discreteLoss, greedyLoss, history}} ids index into the candidate list
 */
export function optimiseHero(target, cols, rows, cw, ch, B, G, opts = {}) {
  const pr = heroProblem(target, cols, rows, cw, ch, B, G, opts), { N, P, W } = pr, iters = opts.iterations ?? 160, lr = opts.lr ?? 0.25, t0 = opts.tau0 ?? 0.6, t1 = opts.tau1 ?? 0.02;
  // per-cell greedy baseline: independent, unblurred L2 (classic glyph matching)
  const cellT = new Float32Array(P), err = new Float32Array(N * G), greedyIds = new Int32Array(N);
  for (let c = 0; c < N; c++) { const cx = (c % cols) * cw, cy = ((c / cols) | 0) * ch; for (let j = 0; j < P; j++) cellT[j] = target[(cy + ((j / cw) | 0)) * W + cx + (j % cw)];
    let best = Infinity; for (let g = 0; g < G; g++) { let s = 0; for (let j = 0; j < P; j++) { const d = B[g * P + j] - cellT[j]; s += d * d; } err[c * G + g] = s / P; if (s < best) { best = s; greedyIds[c] = g; } } }
  // relaxed optimisation: logits start from the greedy scores (the search begins at the classic answer); Adam, annealed tau
  const th = new Float32Array(N * G), m = new Float32Array(N * G), v = new Float32Array(N * G), gr = new Float32Array(N * G), history = [], b1 = 0.9, b2 = 0.999, eps = 1e-8;
  for (let i = 0; i < N * G; i++) th[i] = -err[i] * (opts.init ?? 8);
  for (let it = 0; it < iters; it++) {
    const tau = t0 * (t1 / t0) ** (it / Math.max(1, iters - 1)); history.push(pr.grad(th, tau, gr)); const c1 = 1 - b1 ** (it + 1), c2 = 1 - b2 ** (it + 1);
    for (let i = 0; i < N * G; i++) { m[i] = b1 * m[i] + (1 - b1) * gr[i]; v[i] = b2 * v[i] + (1 - b2) * gr[i] * gr[i]; th[i] -= (lr * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + eps); }
  }
  const ids = new Int32Array(N); for (let c = 0; c < N; c++) { let b = 0; for (let g = 1; g < G; g++) if (th[c * G + g] > th[c * G + b]) b = g; ids[c] = b; }
  return { ids, greedyIds, relaxedLoss: history[history.length - 1], discreteLoss: pr.discrete(ids), greedyLoss: pr.discrete(greedyIds), history };
}
