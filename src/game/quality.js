// Automatic quality (dynamic resolution by tier). Measures CPU frame time over a window and steps
// the G-buffer tier down when the 95th percentile exceeds the budget, and back up when there is
// sustained headroom. Hysteresis: two good windows to step up, one bad window to step down.
export const TIERS = ['low', 'medium', 'high'];
export function createAutoQuality(opts = {}) {
  return { tier: opts.start ?? 'medium', window: opts.window ?? 90, budget: opts.budget ?? 33, upBelow: opts.upBelow ?? 17, samples: [], good: 0, changes: 0, cooldown: 0 };
}
/** Feed one frame's CPU time (ms). Returns the new tier name when it should change, else null. */
export function sampleFrame(aq, ms) {
  if (aq.cooldown > 0) { aq.cooldown--; return null; } // ignore frames right after a tier change (allocation, history reset)
  aq.samples.push(ms); if (aq.samples.length < aq.window) return null;
  const s = aq.samples.sort((a, b) => a - b), p95 = s[Math.floor(s.length * 0.95)]; aq.samples = []; aq.lastP95 = p95;
  const i = TIERS.indexOf(aq.tier);
  if (p95 > aq.budget && i > 0) { aq.good = 0; return change(aq, TIERS[i - 1]); }
  if (p95 < aq.upBelow && i < TIERS.length - 1) { if (++aq.good >= 2) { aq.good = 0; return change(aq, TIERS[i + 1]); } } else aq.good = 0;
  return null;
}
function change(aq, tier) { aq.tier = tier; aq.changes++; aq.cooldown = 30; return tier; }
