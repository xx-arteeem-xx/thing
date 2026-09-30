/**
 * Генерация стартового мира.
 *
 * Мир должен быть местом, где можно жить, а не серым срезом породы:
 * выраженный рельеф, слои грунта, пещеры, руды, водоём с ледяной кромкой,
 * трава, кусты, цветы, лес и грибы в темноте. Плюс поле температур:
 * слева холодная кромка, справа тепло — иначе мир быстро становится
 * однородным, а лёд тает навсегда.
 *
 * Генерация полностью детерминирована от seed мира.
 */
import { hash2d } from '../../core/src/rng.ts';
import { seedFauna } from './fauna.ts';
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

  const seaLevelOffset = opts.seaLevelOffset ?? 8;
  const treeCount = opts.trees ?? 26;
  const icyLeft = opts.icyLeft ?? true;

  buildAmbient(w);
  const heights = buildHeights(w);
  const seaLevel = Math.round(H * 0.42) + seaLevelOffset;

  fillGround(w, heights);
  carveCaves(w, heights);
  scatterOres(w, heights);
  fillWater(w, heights, seaLevel);
  makeBeach(w, heights, seaLevel);
  if (icyLeft) freezeEdge(w, seaLevel);
  caveSoil(w, heights);

  // Температура всех клеток — по локальной среде. Иначе тепловой проход
  // будет бесконечно грести мир к одной температуре.
  for (let i = 0; i < g.temp.length; i++) g.temp[i] = w.ambient[i];
  w.thermalIdle = true;

  growSurface(w, heights, seaLevel, treeCount);
  growAlgaeBeds(w, heights, seaLevel);
  seedFauna(w);

  g.touchAll();
}

/** Водоросли на дне водоёмов — основа водной жизни. */
function growAlgaeBeds(w: World, heights: Int32Array, seaLevel: number): void {
  const g = w.grid;
  const rng = w.rng;
  const W = g.w;
  const H = g.h;

  for (let x = 0; x < W; x++) {
    for (let y = Math.max(0, seaLevel - 2); y < H - 1; y++) {
      const i = y * W + x;
      if (g.mat[i] !== MAT.WATER) continue;
      const below = g.mat[(y + 1) * W + x];
      if (below !== MAT.SAND && below !== MAT.DIRT && below !== MAT.STONE && below !== MAT.GRAVEL) continue;
      if (!rng.chance(0.6)) break;
      g.set(x, y, MAT.ALGAE);
      // Водоросли стелются не в одну клетку, а ковром по дну.
      if (rng.chance(0.5) && y > 0 && g.mat[(y - 1) * W + x] === MAT.WATER) {
        g.set(x, y - 1, MAT.ALGAE);
      }
      break;
    }
  }
}

/** Поле температур среды: холодная кромка слева, тепло справа. */
function buildAmbient(w: World): void {
  const g = w.grid;
  const W = g.w;
  const H = g.h;
  const cold = w.cfg.ambient - 34;
  const warm = w.cfg.ambient + 15;

  for (let x = 0; x < W; x++) {
    const u = x / Math.max(1, W - 1);
    const base = cold + (warm - cold) * Math.pow(u, 0.8);
    for (let y = 0; y < H; y++) {
      // Шум нарочно низкочастотный: резкие перепады среды заставляют тепловой
      // проход работать вечно, потому что равновесие диффузии не совпадает
      // с локальной температурой среды.
      const n = (valueNoise(x * 0.012, y * 0.015, 91) - 0.5) * 7;
      const t = Math.round(base + n);
      w.ambient[y * W + x] = Math.max(-120, Math.min(120, t));
    }
  }
}

function buildHeights(w: World): Int32Array {
  const W = w.grid.w;
  const H = w.grid.h;
  const rng = w.rng;
  const heights = new Int32Array(W);
  const base = Math.round(H * 0.42);
  const ph1 = rng.nextFloat() * Math.PI * 2;
  const ph2 = rng.nextFloat() * Math.PI * 2;
  const ph3 = rng.nextFloat() * Math.PI * 2;
  const ph4 = rng.nextFloat() * Math.PI * 2;

  for (let x = 0; x < W; x++) {
    const u = x / W;
    // Впадина слева (озеро с ледяной кромкой) и широкая низина справа (море).
    // Внимание: высота здесь — координата Y, поэтому впадина это прибавка.
    const basin = 34 * Math.max(0, 1 - u / 0.34);
    const sea = 32 * Math.max(0, (u - 0.68) / 0.32);
    const hgt =
      base +
      basin +
      sea +
      Math.sin(u * Math.PI * 2 * 0.75 + ph1) * 26 +
      Math.sin(u * Math.PI * 2 * 1.9 + ph2) * 12 +
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
  return heights;
}

/** Порода, почва и осадочные слои. */
function fillGround(w: World, heights: Int32Array): void {
  const g = w.grid;
  const rng = w.rng;
  const W = g.w;
  const H = g.h;

  for (let x = 0; x < W; x++) {
    const hgt = heights[x];
    const soil = 3 + rng.nextInt(3);
    for (let y = Math.max(0, hgt); y < H; y++) {
      const depth = y - hgt;
      let m: number = MAT.STONE;

      if (depth < soil) m = MAT.DIRT;
      else if (depth < soil + 3) m = rng.chance(0.45) ? MAT.DIRT : MAT.STONE;
      else {
        // осадочные линзы: глина, гравий, песок
        const n = valueNoise(x * 0.05, y * 0.09, 17);
        if (n > 0.72) m = MAT.CLAY;
        else if (n < 0.24) m = MAT.GRAVEL;
        else if (n > 0.62 && rng.chance(0.35)) m = MAT.SAND;
      }
      g.set(x, y, m);
    }
  }
}

/** Пещеры: две октавы шума дают связные ходы, а не дырки в случайных местах. */
function carveCaves(w: World, heights: Int32Array): void {
  const g = w.grid;
  const W = g.w;
  const H = g.h;

  for (let x = 0; x < W; x++) {
    const top = heights[x] + 12;
    for (let y = top; y < H - 2; y++) {
      const n1 = valueNoise(x * 0.055, y * 0.085, 31);
      const n2 = valueNoise(x * 0.13, y * 0.19, 57);
      const v = n1 * 0.68 + n2 * 0.32;
      if (v > 0.68) g.set(x, y, MAT.AIR);
    }
  }
}

/** Рудные жилы в камне. */
function scatterOres(w: World, heights: Int32Array): void {
  const g = w.grid;
  const rng = w.rng;
  const W = g.w;
  const H = g.h;

  const veins: Array<{ mat: number; count: number; size: number }> = [
    { mat: MAT.COAL, count: 26, size: 16 },
    { mat: MAT.IRON_ORE, count: 16, size: 12 },
    { mat: MAT.COPPER_ORE, count: 14, size: 10 },
  ];

  for (const vein of veins) {
    for (let k = 0; k < vein.count; k++) {
      const x = rng.nextInt(W);
      const y = heights[x] + 8 + rng.nextInt(Math.max(4, H - heights[x] - 10));
      if (y >= H) continue;
      let cx = x;
      let cy = y;
      for (let s = 0; s < vein.size; s++) {
        if (cx < 0 || cx >= W || cy < 0 || cy >= H) break;
        if (g.mat[cy * W + cx] === MAT.STONE) g.set(cx, cy, vein.mat);
        cx += rng.nextInt(3) - 1;
        cy += rng.nextInt(3) - 1;
      }
    }
  }
}

/**
 * Вода.
 *
 * Заливаем не «всё, что ниже уровня моря», а только то, что связано с
 * поверхностью. Иначе любая замкнутая пещера ниже уровня моря превращается
 * в подземное озеро, и мир выглядит затопленным изнутри. Пещеры с выходом
 * на поверхность при этом затапливаются честно — как в природе.
 */
function fillWater(w: World, heights: Int32Array, seaLevel: number): void {
  const g = w.grid;
  const W = g.w;
  const H = g.h;

  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let top = 0;

  for (let x = 0; x < W; x++) {
    if (g.mat[x] !== MAT.AIR) continue;
    seen[x] = 1;
    stack[top++] = x;
  }

  while (top > 0) {
    const i = stack[--top];
    const y = (i / W) | 0;
    const x = i - y * W;

    if (x > 0 && seen[i - 1] === 0 && g.mat[i - 1] === MAT.AIR) {
      seen[i - 1] = 1;
      stack[top++] = i - 1;
    }
    if (x < W - 1 && seen[i + 1] === 0 && g.mat[i + 1] === MAT.AIR) {
      seen[i + 1] = 1;
      stack[top++] = i + 1;
    }
    if (y > 0 && seen[i - W] === 0 && g.mat[i - W] === MAT.AIR) {
      seen[i - W] = 1;
      stack[top++] = i - W;
    }
    if (y < H - 1 && seen[i + W] === 0 && g.mat[i + W] === MAT.AIR) {
      seen[i + W] = 1;
      stack[top++] = i + W;
    }
  }

  for (let y = seaLevel; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      if (seen[i] === 1 && g.mat[i] === MAT.AIR) g.set(x, y, MAT.WATER);
    }
  }
}

function makeBeach(w: World, heights: Int32Array, seaLevel: number): void {
  const g = w.grid;
  const W = g.w;
  const H = g.h;
  for (let x = 0; x < W; x++) {
    const hgt = heights[x];
    if (Math.abs(hgt - seaLevel) > 3) continue;
    for (let y = Math.max(0, hgt); y < Math.min(H, hgt + 3); y++) {
      if (g.mat[y * W + x] === MAT.DIRT) g.set(x, y, MAT.SAND);
    }
  }
}

/** Ледяная кромка на озере слева. */
function freezeEdge(w: World, seaLevel: number): void {
  const g = w.grid;
  const W = g.w;
  const H = g.h;
  const edge = Math.round(W * 0.14);

  for (let x = 0; x < edge; x++) {
    let frozen = 0;
    for (let y = 0; y < H && frozen < 5; y++) {
      const i = y * W + x;
      if (g.mat[i] !== MAT.WATER) continue;
      g.set(x, y, MAT.ICE);
      frozen++;
    }
  }
  // Снег на берегах холодной кромки.
  for (let x = 0; x < edge; x++) {
    for (let y = 0; y < H; y++) {
      const i = y * W + x;
      if (g.mat[i] === MAT.DIRT || g.mat[i] === MAT.STONE) {
        const above = y > 0 ? g.mat[(y - 1) * W + x] : MAT.STONE;
        if (above === MAT.AIR && w.rng.chance(0.5)) g.set(x, y, MAT.SNOW);
      }
    }
  }
}

/** Почва на полу пещер — без неё там нечему расти. */
function caveSoil(w: World, heights: Int32Array): void {
  const g = w.grid;
  const rng = w.rng;
  const W = g.w;
  const H = g.h;

  for (let y = 1; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (g.mat[i] !== MAT.AIR) continue;
      if (y <= heights[x] + 8) continue; // это ещё поверхность, не пещера
      const below = g.mat[(y + 1) * W + x];
      if (below !== MAT.STONE) continue;
      if (!rng.chance(0.35)) continue;
      g.set(x, y + 1, MAT.DIRT);
      if (rng.chance(0.22)) g.set(x, y, MAT.MUSHROOM);
    }
  }
}

/** Трава, кусты, цветы и лес на поверхности. */
function growSurface(w: World, heights: Int32Array, seaLevel: number, treeCount: number): void {
  const g = w.grid;
  const rng = w.rng;
  const W = g.w;
  const H = g.h;

  for (let x = 0; x < W; x++) {
    const surface = surfaceY(g, x);
    if (surface < 1) continue;
    const m = g.mat[surface * W + x];

    const cold = w.ambientAt(x, surface) < 0;
    if (cold) {
      // В холодной полосе вместо травы снег.
      if ((m === MAT.DIRT || m === MAT.MUD) && rng.chance(0.85)) g.set(x, surface, MAT.SNOW);
      continue;
    }

    // Луг засеваем везде, где есть почва: и на земле, и на грязи, и на глине.
    const soil = m === MAT.DIRT || m === MAT.MUD || m === MAT.CLAY;
    if (m === MAT.SAND) {
      if (rng.chance(0.06)) g.set(x, surface - 1, MAT.BUSH);
      continue;
    }
    if (!soil) continue;
    if (surface >= seaLevel) continue;

    g.set(x, surface, MAT.GRASS);
    const roll = rng.nextFloat();
    if (roll < 0.08) g.set(x, surface - 1, MAT.FLOWER);
    else if (roll < 0.14) g.set(x, surface - 1, MAT.BUSH);
    else if (roll < 0.17) g.set(x, surface - 1, MAT.MUSHROOM);
  }

  // Лес: сразу взрослые деревья, чтобы мир с первого кадра был живым.
  const step = Math.max(8, Math.floor(W / (treeCount + 1)));
  for (let k = 1; k <= treeCount; k++) {
    const jitter = rng.nextInt(Math.max(1, step - 3));
    const x = Math.min(W - 4, Math.max(4, k * step + jitter));
    const surface = surfaceY(g, x);
    if (surface < 2) continue;
    if (g.mat[surface * W + x] !== MAT.GRASS) continue;
    if (w.ambientAt(x, surface) < 2) continue;
    plantTree(w, x, surface);
  }
}

function plantTree(w: World, x: number, surface: number): void {
  const g = w.grid;
  const rng = w.rng;
  const W = g.w;
  const H = g.h;

  const trunk = 9 + rng.nextInt(9);
  for (let t = 0; t < trunk; t++) {
    const y = surface - 1 - t;
    if (y < 1) break;
    g.set(x, y, MAT.WOOD);
  }

  const topY = Math.max(1, surface - trunk);
  const radius = 3 + rng.nextInt(2);
  for (let dy = -radius; dy <= 1; dy++) {
    const half = radius - Math.abs(dy);
    for (let dx = -half; dx <= half; dx++) {
      const nx = x + dx;
      const ny = topY + dy;
      if (nx < 0 || nx >= W || ny < 1 || ny >= H) continue;
      const i = ny * W + nx;
      if (g.mat[i] !== MAT.AIR) continue;
      if (!rng.chance(0.8)) continue;
      const roll = rng.nextFloat();
      g.set(nx, ny, roll < 0.05 ? MAT.FRUIT : MAT.LEAVES);
    }
  }
}

/** Первая непустая клетка сверху в столбце, или -1. */
function surfaceY(g: { w: number; h: number; mat: Uint8Array }, x: number): number {
  for (let y = 0; y < g.h; y++) {
    if (g.mat[y * g.w + x] !== MAT.AIR) return y;
  }
  return -1;
}

/** Гладкий шум по значению: нужен для пещер, слоёв и поля температур. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const a = hash2d(xi + seed, yi) / 4294967296;
  const b = hash2d(xi + 1 + seed, yi) / 4294967296;
  const c = hash2d(xi + seed, yi + 1) / 4294967296;
  const d = hash2d(xi + 1 + seed, yi + 1) / 4294967296;

  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}
