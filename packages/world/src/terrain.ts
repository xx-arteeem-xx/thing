/**
 * Генерация стартового мира.
 *
 * Мир должен быть «щедрым на открытия» (см. §7 PLAN.md): выраженный рельеф,
 * водоём с берегом, ледяная кромка, лес. Этого достаточно, чтобы существу
 * было что исследовать, а огню, воде и теплу — что делать.
 *
 * Генерация полностью детерминирована от seed мира.
 */
import { MAT } from './materials.ts';
import type { World } from './world.ts';

export interface TerrainOptions {
  /** Насколько уровень воды ниже средней линии рельефа. */
  seaLevelOffset?: number;
  trees?: number;
  icyLeft?: boolean;
}

export function generateTerrain(w: World, opts: TerrainOptions = {}): void {
  const g = w.grid;
  const rng = w.rng;
  const W = g.w;
  const H = g.h;

  const seaLevelOffset = opts.seaLevelOffset ?? 6;
  const treeCount = opts.trees ?? 9;
  const icyLeft = opts.icyLeft ?? true;

  // --- рельеф: крупная форма + две волны деталей
  const heights = new Int32Array(W);
  const base = Math.round(H * 0.42);
  const ph1 = rng.nextFloat() * Math.PI * 2;
  const ph2 = rng.nextFloat() * Math.PI * 2;
  const ph3 = rng.nextFloat() * Math.PI * 2;
  const ph4 = rng.nextFloat() * Math.PI * 2;

  for (let x = 0; x < W; x++) {
    const u = x / W;
    // Слева намеренно низина: там будет озеро, а на нём — ледяная кромка.
    // Внимание: высота здесь — это координата Y, поэтому впадина означает
    // прибавку, а не вычитание.
    const leftBasin = 30 * Math.max(0, 1 - u / 0.32);
    const hgt =
      base +
      leftBasin +
      Math.sin(u * Math.PI * 2 * 0.75 + ph1) * 32 +
      Math.sin(u * Math.PI * 2 * 1.9 + ph2) * 14 +
      Math.sin(u * Math.PI * 2 * 4.7 + ph3) * 5 +
      Math.sin(u * Math.PI * 2 * 9.3 + ph4) * 2;
    heights[x] = Math.round(hgt);
  }

  for (let pass = 0; pass < 2; pass++) {
    const prev = heights.slice();
    for (let x = 1; x < W - 1; x++) {
      heights[x] = Math.round((prev[x - 1] + prev[x] * 2 + prev[x + 1]) / 4);
    }
  }

  const seaLevel = base + seaLevelOffset;

  // --- порода и почва
  for (let x = 0; x < W; x++) {
    const hgt = heights[x];
    const soil = 3 + rng.nextInt(3);
    for (let y = Math.max(0, hgt); y < H; y++) {
      const depth = y - hgt;
      let m: number = MAT.STONE;
      if (depth < soil) m = MAT.DIRT;
      else if (depth < soil + 3) m = rng.chance(0.5) ? MAT.DIRT : MAT.STONE;
      g.set(x, y, m);
    }
  }

  // --- вода: всё, что ниже уровня моря и не занято породой
  for (let x = 0; x < W; x++) {
    for (let y = Math.max(0, seaLevel); y < H; y++) {
      if (g.mat[y * W + x] === MAT.AIR) g.set(x, y, MAT.WATER);
    }
  }

  // --- берег: песок только у самой кромки воды, а не по всему миру
  for (let x = 0; x < W; x++) {
    const hgt = heights[x];
    if (Math.abs(hgt - seaLevel) > 3) continue;
    for (let y = Math.max(0, hgt); y < Math.min(H, hgt + 3); y++) {
      if (g.mat[y * W + x] === MAT.DIRT) g.set(x, y, MAT.SAND);
    }
  }

  // --- ледяная кромка: замерзает только поверхность воды, а не вся толща
  if (icyLeft) {
    const iceEdge = Math.round(W * 0.13);
    for (let x = 0; x < iceEdge; x++) {
      let frozen = 0;
      for (let y = 0; y < H && frozen < 4; y++) {
        const i = y * W + x;
        if (g.mat[i] !== MAT.WATER) continue;
        g.set(x, y, MAT.ICE);
        g.temp[i] = -12;
        frozen++;
      }
      // холодный воздух над льдом — он и держит кромку замёрзшей
      for (let y = Math.max(0, seaLevel - 6); y < seaLevel; y++) {
        const i = y * W + x;
        if (g.mat[i] === MAT.AIR) g.temp[i] = -14;
      }
    }
    w.thermalIdle = false;
  }

  // --- лес: только на сухой земле заметно выше воды
  const step = Math.max(6, Math.floor(W / (treeCount + 1)));
  for (let k = 1; k <= treeCount; k++) {
    const jitter = rng.nextInt(Math.max(1, step - 2));
    const x = Math.min(W - 3, Math.max(3, k * step + jitter));
    const surface = surfaceY(g, x);
    if (surface < 0) continue;
    if (surface > seaLevel - 4) continue; // у воды деревья не растут

    const trunk = 9 + rng.nextInt(8);
    for (let t = 0; t < trunk; t++) {
      const y = surface - 1 - t;
      if (y < 0) break;
      g.set(x, y, MAT.WOOD);
    }

    // крона: пока без листвы в наборе Ф0, поэтому просто округлая шапка
    const topY = surface - trunk;
    for (let dy = -3; dy <= 0; dy++) {
      const half = 3 + dy;
      if (half < 1) continue;
      for (let dx = -half; dx <= half; dx++) {
        const nx = x + dx;
        const ny = topY + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        if (g.mat[ny * W + nx] === MAT.AIR) g.set(nx, ny, MAT.WOOD);
      }
    }
  }

  g.touchAll();
  w.thermalIdle = false;
}

/** Первая непустая клетка сверху в столбце, или -1. */
function surfaceY(g: { w: number; h: number; mat: Uint8Array }, x: number): number {
  for (let y = 0; y < g.h; y++) {
    if (g.mat[y * g.w + x] !== MAT.AIR) return y;
  }
  return -1;
}
