// Presentation-side world: converts the simulation's integer tile map into height-field cells
// for the tracer and animates wall heights. Reads simulation state; never writes it.
import { TILE, solidAt } from '../sim/sim.js';
import { MAT } from '../shared/materials.js';
import { FAR } from './gbuffer.js';

export const CEILING = 3.4, WALL_OUT = 4.6;

export function buildWorld(sim) {
  const n = sim.w * sim.h, world = { w: sim.w, h: sim.h, floorH: new Float32Array(n), ceilH: new Float32Array(n).fill(FAR), floorMat: new Uint8Array(n), wallMat: new Uint8Array(n), ceilMat: new Uint8Array(n), target: new Float32Array(n), dirty: true, indoor: !!sim.def.indoor };
  syncWorld(world, sim, 1e3);
  return world;
}

/** Update targets from the simulation and move heights toward them. Returns true when occupancy changed. */
export function syncWorld(world, sim, dt) {
  const { w, h } = world, indoor = world.indoor, top = indoor ? CEILING : WALL_OUT, def = sim.def; let changed = false;
  const stoneFloor = def.id === 5 ? MAT.WOOD : MAT.STONE;
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    const i = z * w + x, t = sim.tiles[i]; let fh = 0, fm = indoor ? stoneFloor : MAT.GRASS, wm = MAT.STONE, ch = indoor ? CEILING : FAR, cm = def.id === 5 ? MAT.WOOD : MAT.STONE;
    switch (t) {
      case TILE.WALL: case TILE.VOID: fh = top; break;
      case TILE.INS: fh = top; wm = MAT.INSCRIPTION; break;
      case TILE.ROCK: fh = indoor ? top : 1.25 + ((x * 7 + z * 13) % 5) * 0.12; break;
      case TILE.TREE: fh = indoor ? top : 6.5; wm = MAT.WOOD; break;
      case TILE.DEEP: fh = -0.4; fm = MAT.WATER; break;
      case TILE.WATER: fh = -0.14; fm = MAT.WATER; break;
      case TILE.SAND: fm = MAT.SAND; break;
      case TILE.GRASS: fm = MAT.GRASS; break;
      case TILE.SHADE: fm = MAT.SAND; ch = 2.8; cm = MAT.WOOD; wm = MAT.WOOD; break;
      case TILE.GATE: if (solidAt(sim, x, z)) { fh = top; wm = MAT.INSCRIPTION; } else fm = MAT.ARCANE; break;
      case TILE.FOUND: fh = 1.15; wm = MAT.INSCRIPTION; break;
      case TILE.BRAZ: fh = 0.9; wm = MAT.STONE; break;
      case TILE.RAISE: case TILE.PA: case TILE.PB: if (solidAt(sim, x, z)) fh = top; wm = t === TILE.RAISE ? MAT.STONE : def.glory ? MAT.GOLD : MAT.STONE; break;
      default: break;
    }
    if (t === TILE.FLOOR && !indoor) fm = MAT.STONE;
    world.target[i] = fh; world.floorMat[i] = fm; world.wallMat[i] = wm; world.ceilMat[i] = cm; world.ceilH[i] = ch;
    const cur = world.floorH[i];
    if (cur !== fh) {
      const stepH = dt * 5.5, next = Math.abs(fh - cur) <= stepH ? fh : cur + Math.sign(fh - cur) * stepH;
      if ((cur > 1.6) !== (next > 1.6)) changed = true; world.floorH[i] = next;
    }
  }
  if (changed) world.dirty = true;
  return changed;
}
