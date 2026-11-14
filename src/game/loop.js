// Fixed-timestep accumulator (guide phase 6). Simulation time advances only in whole ticks.
import { TICK_HZ } from '../sim/sim.js';
export const TICK = 1 / TICK_HZ, MAX_CATCHUP = 5;

/**
 * Add elapsed wall time and return how many ticks to simulate now.
 * Slowdown policy: at most MAX_CATCHUP ticks per frame; a backlog beyond that is dropped (the game
 * slows down rather than spiralling), and no simulated tick is ever skipped or shortened.
 * @param st {acc:number} mutable accumulator holder
 */
export function consumeTicks(st, elapsedSeconds, maxCatchup = MAX_CATCHUP) {
  st.acc += elapsedSeconds; let ticks = 0;
  while (st.acc >= TICK && ticks < maxCatchup) { st.acc -= TICK; ticks++; }
  if (ticks === maxCatchup && st.acc >= TICK) st.acc = 0;
  return ticks;
}
/** Interpolation factor for presentation between the previous and current tick. */
export const interpolation = st => Math.min(1, Math.max(0, st.acc / TICK));
