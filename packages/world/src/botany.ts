/**
 * Ботаника: жизнь растений.
 *
 * Здесь живёт всё, что делает мир живым, а не набором веществ: трава
 * наползает на землю, семена прорастают, росток тянется вверх и превращается
 * в дерево с кроной, листва без ствола опадает, грибы растут в темноте.
 *
 * Растения растут медленно, поэтому этот проход выполняется не каждый тик,
 * а раз в BOTANY_EVERY тиков — экономия вчетверо без потери смысла.
 */
import { hash2d } from '../../core/src/rng.ts';
import { MAT, MATERIALS } from './materials.ts';
import type { World } from './world.ts';

export const BOTANY_EVERY = 4;

/** Нужно ли этой клетке внимание на следующем тике (иначе её чанк уснёт). */
export function plantNeedsTime(w: World, i: number, m: number): boolean {
  const g = w.grid;
  const x = i % g.w;
  const y = (i / g.w) | 0;

  switch (m) {
    case MAT.SAPLING:
      return true;
    case MAT.LEAVES:
      return true;
    case MAT.GRASS:
    case MAT.BUSH: {
      // Трава живёт, пока есть куда расти или пока её не засыпало.
      if (g.light[i] < 25) return true;
      return canSpreadToSoil(w, x, y);
    }
    case MAT.MUSHROOM:
      // Грибница тянется только в темноте.
      return g.light[i] < 90 && hasNeighborSoil(w, x, y);
    case MAT.SEED: {
      const below = y + 1 < g.h ? g.mat[(y + 1) * g.w + x] : MAT.AIR;
      const onSoil = below === MAT.DIRT || below === MAT.GRASS || below === MAT.MUD;
      return onSoil && g.light[i] > 60;
    }
    default:
      return false;
  }
}

/** Растительная жизнь клетки. Вызывается только на «ботанических» тиках. */
export function growPlant(w: World, x: number, y: number, i: number): void {
  switch (w.grid.mat[i]) {
    case MAT.GRASS:
      growGrass(w, x, y, i);
      break;
    case MAT.SAPLING:
      growSapling(w, x, y, i);
      break;
    case MAT.SEED:
      growSeed(w, x, y, i);
      break;
    case MAT.LEAVES:
      growLeaves(w, x, y, i);
      break;
    case MAT.MUSHROOM:
      growMushroom(w, x, y, i);
      break;
    case MAT.BUSH:
      growBush(w, x, y, i);
      break;
    default:
      break;
  }
}

function idx(g: { w: number }, x: number, y: number): number {
  return y * g.w + x;
}

function isSoil(m: number): boolean {
  return m === MAT.DIRT || m === MAT.MUD || m === MAT.CLAY;
}

/** Есть ли рядом земля, на которую можно наползти (и есть ли над ней воздух). */
function canSpreadToSoil(w: World, x: number, y: number): boolean {
  const g = w.grid;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) continue;
    const j = idx(g, nx, ny);
    if (g.mat[j] !== MAT.DIRT) continue;
    const above = ny - 1;
    if (above < 0) continue;
    if (g.mat[idx(g, nx, above)] === MAT.AIR) return true;
  }
  return false;
}

function hasNeighborSoil(w: World, x: number, y: number): boolean {
  const g = w.grid;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) continue;
    if (isSoil(g.mat[idx(g, nx, ny)])) return true;
  }
  return false;
}

function growGrass(w: World, x: number, y: number, i: number): void {
  const g = w.grid;
  const rng = w.rng;

  // Засыпанная или затемнённая трава погибает и возвращается в землю.
  if (g.light[i] < 25) {
    if (rng.chance(0.05)) g.set(x, y, MAT.DIRT);
    return;
  }

  if (!rng.chance(0.05)) return;

  const dirs = [
    [1, 0],
    [-1, 0],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  const [dx, dy] = dirs[rng.nextInt(dirs.length)];
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) return;

  const j = idx(g, nx, ny);
  if (g.mat[j] !== MAT.DIRT) return;
  if (ny - 1 < 0 || g.mat[idx(g, nx, ny - 1)] !== MAT.AIR) return;

  g.set(nx, ny, MAT.GRASS);
}

function growBush(w: World, x: number, y: number, i: number): void {
  const g = w.grid;
  const rng = w.rng;
  if (g.light[i] < 30) {
    if (rng.chance(0.01)) g.set(x, y, MAT.DIRT);
    return;
  }
  if (!rng.chance(0.006)) return;

  // Куст либо тянется вверх, либо роняет плод.
  if (rng.chance(0.35)) {
    const above = y - 1;
    if (above >= 0 && g.mat[idx(g, x, above)] === MAT.AIR && rng.chance(0.5)) {
      g.set(x, above, MAT.BUSH);
      return;
    }
    if (above >= 0 && g.mat[idx(g, x, above)] === MAT.AIR) g.set(x, above, MAT.FRUIT);
    return;
  }

  const dirs = [
    [1, 0],
    [-1, 0],
    [1, -1],
    [-1, -1],
  ];
  const [dx, dy] = dirs[rng.nextInt(dirs.length)];
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) return;
  const j = idx(g, nx, ny);
  if (g.mat[j] === MAT.AIR) {
    g.set(nx, ny, MAT.BUSH);
  } else if (g.mat[j] === MAT.DIRT && ny - 1 >= 0 && g.mat[idx(g, nx, ny - 1)] === MAT.AIR) {
    g.set(nx, ny, MAT.BUSH);
  }
}

function growMushroom(w: World, x: number, y: number, i: number): void {
  const g = w.grid;
  const rng = w.rng;

  // На свету гриб гибнет.
  if (g.light[i] > 120) {
    if (rng.chance(0.01)) g.set(x, y, MAT.DIRT);
    return;
  }
  if (!rng.chance(0.02)) return;

  const dirs = [
    [1, 0],
    [-1, 0],
    [1, 1],
    [-1, 1],
  ];
  const [dx, dy] = dirs[rng.nextInt(dirs.length)];
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) return;
  const j = idx(g, nx, ny);
  if (g.mat[j] === MAT.AIR && ny + 1 < g.h && isSoil(g.mat[idx(g, nx, ny + 1)])) {
    g.set(nx, ny, MAT.MUSHROOM);
  } else if (isSoil(g.mat[j]) && ny - 1 >= 0 && g.mat[idx(g, nx, ny - 1)] === MAT.AIR) {
    g.set(nx, ny, MAT.MUSHROOM);
  }
}

function growSeed(w: World, x: number, y: number, i: number): void {
  const g = w.grid;
  const rng = w.rng;

  const below = y + 1 < g.h ? g.mat[(y + 1) * g.w + x] : MAT.AIR;
  if (below !== MAT.DIRT && below !== MAT.GRASS && below !== MAT.MUD) return;
  if (g.light[i] < 60) return;

  // Семя под кроной не прорастает: там мало света. Так лес не превращается в ковёр ростков.
  if (!rng.chance(0.006)) return;
  g.set(x, y, MAT.SAPLING);
  g.aux[i] = 40 + rng.nextInt(120);
}

function growSapling(w: World, x: number, y: number, i: number): void {
  const g = w.grid;
  const rng = w.rng;

  // Росток без опоры и без света гибнет.
  const support = y + 1 < g.h ? g.mat[(y + 1) * g.w + x] : MAT.AIR;
  const rooted = support === MAT.DIRT || support === MAT.GRASS || support === MAT.WOOD || support === MAT.MUD;
  if (!rooted || g.light[i] < 40) {
    if (rng.chance(0.003)) g.set(x, y, MAT.DIRT);
    return;
  }

  if (g.aux[i] === 0) {
    g.aux[i] = 30 + rng.nextInt(90);
    return;
  }
  g.aux[i]--;
  if (g.aux[i] > 0) return;

  // Считаем, сколько ствола уже выросло под ростком.
  let height = 0;
  for (let yy = y + 1; yy < g.h && height < 32; yy++) {
    if (g.mat[yy * g.w + x] === MAT.WOOD) height++;
    else break;
  }

  // Высота дерева стабильна для колонки: иначе деревья получаются рваными.
  const maxHeight = 9 + (hash2d(x, 7) % 9);

  if (height >= maxHeight) {
    crown(w, x, y);
    g.set(x, y, MAT.WOOD);
    return;
  }

  const above = y - 1;
  if (above < 0 || g.mat[idx(g, x, above)] !== MAT.AIR) {
    crown(w, x, y);
    g.set(x, y, MAT.WOOD);
    return;
  }

  g.set(x, y, MAT.WOOD);
  g.set(x, above, MAT.SAPLING);
  g.aux[idx(g, x, above)] = 30 + rng.nextInt(90);
}

function crown(w: World, x: number, y: number): void {
  const g = w.grid;
  const rng = w.rng;
  const radius = 2 + (hash2d(x, 11) % 2);

  for (let dy = -radius; dy <= 1; dy++) {
    const half = radius - Math.abs(dy);
    for (let dx = -half; dx <= half; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) continue;
      const j = idx(g, nx, ny);
      if (g.mat[j] !== MAT.AIR) continue;
      if (!rng.chance(0.82)) continue;
      g.set(nx, ny, rng.chance(0.06) ? MAT.FRUIT : MAT.LEAVES);
    }
  }
}

function growLeaves(w: World, x: number, y: number, i: number): void {
  const g = w.grid;
  const rng = w.rng;

  if (hasWoodNear(w, x, y, 3)) {
    // Живая листва изредка роняет семя — так лес расходится сам.
    if (rng.chance(0.0006)) {
      const below = y + 1;
      if (below < g.h && g.mat[idx(g, x, below)] === MAT.AIR) {
        g.set(x, below, MAT.SEED);
      }
    }
    return;
  }

  // Ствол исчез — листва опадает и превращается в перегной.
  if (rng.chance(0.04)) g.set(x, y, MAT.DIRT);
}

function hasWoodNear(w: World, x: number, y: number, radius: number): boolean {
  const g = w.grid;
  for (let dy = -radius; dy <= radius; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= g.h) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= g.w) continue;
      if (g.mat[ny * g.w + nx] === MAT.WOOD) return true;
    }
  }
  return false;
}

export { MATERIALS };
