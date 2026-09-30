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
import { MAT, MAT_STATE, MATERIAL_COUNT, MATERIALS, ST } from './materials.ts';
import type { World } from './world.ts';

export const BOTANY_EVERY = 4;

/**
 * Направления лежат в плоских типизированных массивах, а не в массивах
 * массивов. Раньше каждая проверка создавала по шесть маленьких массивов,
 * и на живой траве это давало тысячи аллокаций за тик — заметная часть
 * стоимости всей симуляции уходила в сборщик мусора.
 */
const DIRS6 = new Int8Array([1, 0, -1, 0, 0, 1, 0, -1, 1, 1, -1, 1]);
const DIRS4 = new Int8Array([1, 0, -1, 0, 0, 1, 0, -1]);
const DIRS4D = new Int8Array([1, 0, -1, 0, 1, 1, -1, 1]);

/** Нужно ли этой клетке внимание на следующем тике (иначе её чанк уснёт). */
export function plantNeedsTime(w: World, i: number, m: number): boolean {
  const g = w.grid;
  const x = i % g.w;
  const y = (i / g.w) | 0;

  switch (m) {
    case MAT.SAPLING:
    case MAT.LEAVES:
      return true;
    case MAT.GRASS:
    case MAT.BUSH:
      // Трава живёт, пока есть куда расти или пока её не засыпало.
      if (isBuried(w, x, y)) return true;
      if (g.light[i] < 6) return false;
      return canSpreadToSoil(w, x, y);
    case MAT.MUSHROOM:
      // Грибница тянется только в темноте.
      return g.light[i] < 90 && hasNeighborSoil(w, x, y);
    case MAT.ALGAE:
      // Водоросли живут только в воде: без неё они высыхают.
      return hasWaterAround(w, x, y);
    case MAT.SEED: {
      const below = y + 1 < g.h ? g.mat[(y + 1) * g.w + x] : MAT.AIR;
      const onSoil = below === MAT.DIRT || below === MAT.GRASS || below === MAT.MUD;
      return onSoil && g.light[i] > 60;
    }
    default:
      return false;
  }
}

/**
 * Что считается завалом.
 *
 * Только грунт и порода. Цветок, куст или гриб, стоящие на травинке, —
 * это не завал, а сосед по лугу: раньше они считались завалом, и трава
 * под каждым украшением погибала, отчего луг тихо вымирал сам по себе.
 */
const BURIES = new Uint8Array(MATERIAL_COUNT);
for (const m of [MAT.STONE, MAT.DIRT, MAT.SAND, MAT.CLAY, MAT.GRAVEL, MAT.MUD, MAT.SNOW, MAT.ASH, MAT.ICE]) {
  BURIES[m] = 1;
}

function isBuried(w: World, x: number, y: number): boolean {
  const g = w.grid;
  if (y === 0) return false;
  return BURIES[g.mat[(y - 1) * g.w + x]] === 1;
}

export function growSurfaceGrass(w: World, x: number, y: number): void {
  const g = w.grid;
  if (isSoil(g.mat[y * g.w + x]) && y > 0 && g.mat[(y - 1) * g.w + x] === MAT.AIR) {
    g.set(x, y, MAT.GRASS);
  }
}

/** Есть ли рядом вода — для водорослей. */
function hasWaterAround(w: World, x: number, y: number): boolean {
  const g = w.grid;
  const W = g.w;
  if (x > 0 && g.mat[y * W + x - 1] === MAT.WATER) return true;
  if (x < W - 1 && g.mat[y * W + x + 1] === MAT.WATER) return true;
  if (y > 0 && g.mat[(y - 1) * W + x] === MAT.WATER) return true;
  if (y < g.h - 1 && g.mat[(y + 1) * W + x] === MAT.WATER) return true;
  return false;
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
    case MAT.ALGAE:
      growAlgae(w, x, y, i);
      break;
    default:
      break;
  }
}

/**
 * Водоросли: стелются по дну водоёма, давая пищу рыбам.
 * Без воды высыхают — так водоём получает собственную жизнь.
 */
function growAlgae(w: World, x: number, y: number, i: number): void {
  const g = w.grid;
  const rng = w.rng;

  if (!hasWaterAround(w, x, y)) {
    if (rng.chance(0.02)) g.set(x, y, MAT.AIR);
    return;
  }
  if (g.light[i] < 30) return;
  if (!rng.chance(0.05)) return;

  for (let attempt = 0; attempt < 2; attempt++) {
    const dx = rng.nextInt(3) - 1;
    const dy = rng.nextInt(3) - 1;
    if (dx === 0 && dy === 0) continue;
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) continue;
    const j = ny * g.w + nx;
    if (g.mat[j] !== MAT.AIR) continue;
    // Растёт только на дне: под клеткой должно быть твёрдо.
    if (ny + 1 >= g.h) continue;
    if (MAT_STATE[g.mat[(ny + 1) * g.w + nx]] === ST.LIQUID) continue;
    g.set(nx, ny, MAT.ALGAE);
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
  const W = g.w;
  const H = g.h;

  for (let k = 0; k < DIRS6.length; k += 2) {
    const nx = x + DIRS6[k];
    const ny = y + DIRS6[k + 1];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const j = ny * W + nx;
    if (isSoil(g.mat[j]) === false) continue;
    if (ny === 0) continue;
    if (g.mat[j - W] === MAT.AIR) return true;
  }
  return false;
}

function hasNeighborSoil(w: World, x: number, y: number): boolean {
  const g = w.grid;
  const W = g.w;
  const H = g.h;

  for (let k = 0; k < DIRS4.length; k += 2) {
    const nx = x + DIRS4[k];
    const ny = y + DIRS4[k + 1];
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    if (isSoil(g.mat[ny * W + nx])) return true;
  }
  return false;
}

function growGrass(w: World, x: number, y: number, i: number): void {
  const g = w.grid;
  const rng = w.rng;

  // Засыпанная трава погибает и возвращается в землю.
  if (isBuried(w, x, y)) {
    if (rng.chance(0.05)) g.set(x, y, MAT.DIRT);
    return;
  }
  // В полной темноте трава тоже не живёт — но порог низкий.
  if (g.light[i] < 6) return;

  if (!rng.chance(0.16)) return;

  const dirs = [
    [1, 0],
    [-1, 0],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];

  // Пробуем два направления за раз: луг должен зарастать за минуту,
  // а не за десять.
  for (let attempt = 0; attempt < 2; attempt++) {
    const [dx, dy] = dirs[rng.nextInt(dirs.length)];
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) continue;

    const j = idx(g, nx, ny);
    // Грязь — такая же почва: после дождя поверхность становится грязью,
    // и трава обязана уметь зарастать её заново, иначе луг исчезает навсегда.
    if (isSoil(g.mat[j]) === false) continue;
    if (ny - 1 < 0 || g.mat[idx(g, nx, ny - 1)] !== MAT.AIR) continue;

    g.set(nx, ny, MAT.GRASS);
  }
}

function growBush(w: World, x: number, y: number, i: number): void {
  const g = w.grid;
  const rng = w.rng;
  if (isBuried(w, x, y)) {
    if (rng.chance(0.01)) g.set(x, y, MAT.DIRT);
    return;
  }
  if (g.light[i] < 6) return;
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
