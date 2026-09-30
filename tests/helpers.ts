/**
 * Общие помощники тестов.
 */
import { World } from '../packages/world/src/world.ts';
import type { WorldConfig } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { MAT } from '../packages/world/src/materials.ts';

export const TEST_CFG: WorldConfig = {
  width: 128,
  height: 96,
  seed: 12345,
  ambient: 20,
  heatEveryTicks: 4,
};

/** Мир с рельефом, водой, льдом и деревьями. */
export function makeWorld(seed = TEST_CFG.seed, width = TEST_CFG.width, height = TEST_CFG.height): World {
  const w = new World({ ...TEST_CFG, seed, width, height });
  generateTerrain(w, { trees: 3 });
  return w;
}

/** Пустой мир — для проверок отдельных правил. */
export function emptyWorld(width = 32, height = 32, seed = 1): World {
  return new World({ width, height, seed, ambient: 20, heatEveryTicks: 4 });
}

/** Горизонтальная твёрдая подложка. */
export function addFloor(w: World, y: number, mat: number = MAT.STONE): void {
  for (let x = 0; x < w.grid.w; x++) w.grid.set(x, y, mat);
}

export function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) w.tickOnce();
}

export function count(w: World, mat: number): number {
  const cells = w.grid.mat;
  let n = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === mat) n++;
  return n;
}

/** Прямоугольная заливка. */
export function fillRect(w: World, x0: number, y0: number, x1: number, y1: number, mat: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (w.grid.inBounds(x, y)) w.grid.set(x, y, mat);
    }
  }
}

/** Координаты всех клеток заданного вещества. */
export function positionsOf(w: World, mat: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const g = w.grid;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.mat[y * g.w + x] === mat) out.push({ x, y });
    }
  }
  return out;
}
