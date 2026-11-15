// Speedrun timing: in-game time is the simulation tick count, so it is exact, identical on every machine and
// unaffected by frame rate, pauses or assists' wall-clock speed. Splits fall on objectives (measures, braziers, the
// gate opening, the exit); each is compared with the split from the personal-best run (PB) and with the best time
// ever reached for that split (gold). Pure: the shell feeds events and renders the strings.
import { TICK_HZ } from '../sim/sim.js';

export const SPLIT_EVENTS = { measure: e => `Measure ${e.a}`, brazier: e => `Brazier ${e.a}`, gate: () => 'The way opens', complete: () => 'Exit' };
export function formatTicks(t) { const s = t / TICK_HZ, m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; }
export function formatDelta(d) { return `${d < 0 ? '−' : '+'}${(Math.abs(d) / TICK_HZ).toFixed(2)}`; }

/** rec: { pb: [{label, tick}], gold: {label: best segment duration in ticks} } for one chapter (or undefined).
 *  A segment is the time from the previous split (or the start) to this one; gold is the best ever for that segment. */
export function createRun(rec) {
  const pb = rec?.pb || [], gold = { ...(rec?.gold || {}) }, splits = [];
  return {
    splits,
    /** @returns the split made by this event, or null */
    onEvent(e, tick) {
      const name = SPLIT_EVENTS[e.type]?.(e); if (!name || splits.some(s => s.label === name)) return null;
      const ref = pb.find(s => s.label === name), seg = tick - (splits.length ? splits[splits.length - 1].tick : 0), prevGold = gold[name];
      const s = { label: name, tick, segment: seg, delta: ref ? tick - ref.tick : null, gold: prevGold === undefined || seg < prevGold };
      if (s.gold) gold[name] = seg; splits.push(s); return s;
    },
    /** Finish: the record to store (PB replaced only by a faster exit) and the sum of best segments along the PB route. */
    finish(tick) {
      const exitPb = pb.find(s => s.label === 'Exit')?.tick ?? Infinity, newPb = tick < exitPb, route = (newPb ? splits : pb).map(s => s.label);
      const sumOfBest = route.length && route.every(l => gold[l] !== undefined) ? route.reduce((acc, l) => acc + gold[l], 0) : tick;
      return { record: { pb: newPb ? splits.map(({ label, tick: t }) => ({ label, tick: t })) : pb, gold }, newPb, sumOfBest };
    },
  };
}
