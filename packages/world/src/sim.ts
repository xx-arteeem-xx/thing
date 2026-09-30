/**
 * Ядро симуляции мира.
 *
 * Один тик: пересчёт только бодрствующих чанков (снизу вверх), затем свет,
 * тепло и погода. Всё поведение клетки выводится из таблицы веществ, а
 * жизнь растений живёт в botany.ts.
 *
 * Детерминизм: порядок обхода фиксирован, все случайные решения берутся
 * из w.rng, «уже двигалась» хранится в бите-паритете (MOVE_A/MOVE_B),
 * который переключается каждый тик.
 */
import { CHUNK, FLAG, MOVE_MASK } from './grid.ts';
import { BOTANY_EVERY, growPlant, plantNeedsTime } from './botany.ts';
import {
  CONDUCT,
  EMISSIVE,
  IS_PLANT,
  LIGHT_ATTEN,
  MAT,
  MATERIALS,
  NEEDS_TIME,
  NO_FREEZE,
  NO_TEMP,
  ST,
  canDisplace,
} from './materials.ts';
import type { MatDef } from './materials.ts';
import type { World } from './world.ts';

/** Погода. */
export const WEATHER = {
  CLEAR: 0,
  RAIN: 1,
  SNOW: 2,
  STORM: 3,
} as const;

export const WEATHER_NAME: Record<number, string> = {
  0: 'ясно',
  1: 'дождь',
  2: 'снег',
  3: 'гроза',
};

/** Откуда дует «свет неба»: насколько темно в пещере под землёй. */
const SKY_MIN = 34;
const SKY_MAX = 255;

/** Полный тик мира. */
export function stepWorld(w: World): void {
  const g = w.grid;
  g.beginTick();

  // Свет считаем ДО материалов: от него зависит, растёт ли трава и прорастает
  // ли семя. Если считать его после, то на самом первом тике весь мир будет
  // «тёмным», растения решат, что расти некуда, и их чанки уснут навсегда.
  if (w.tick % w.cfg.lightEveryTicks === 0) stepLight(w);

  const moveBit = (w.tick & 1) === 0 ? FLAG.MOVE_A : FLAG.MOVE_B;
  updateMaterials(w, moveBit);

  if (w.tick % w.cfg.heatEveryTicks === 0) stepHeat(w);
  if (w.cfg.weather) stepWeather(w);

  w.tick++;
}

function updateMaterials(w: World, moveBit: number): void {
  const g = w.grid;
  const rng = w.rng;
  const W = g.w;
  const H = g.h;
  const cols = g.cols;
  const rows = g.rows;
  const ambient = w.ambient;
  const botanyTick = w.tick % BOTANY_EVERY === 0;

  for (let cy = rows - 1; cy >= 0; cy--) {
    for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx;
      if (!g.isDirty(c)) continue;

      const x0 = cx * CHUNK;
      const x1 = Math.min(x0 + CHUNK, W);
      const y0 = cy * CHUNK;
      const y1 = Math.min(y0 + CHUNK, H);
      let awake = false;

      // Забываем отметки прошлого тика у всех клеток чанка. Без этого клетка,
      // которая не сдвинулась, сохранила бы старый бит и через тик снова
      // совпала бы с текущим — то есть пропускалась бы через раз, и время
      // жизни огня или дыма текло бы вдвое медленнее реального.
      const stale = moveBit === FLAG.MOVE_A ? FLAG.MOVE_B : FLAG.MOVE_A;
      for (let y = y0; y < y1; y++) {
        const rowBase = y * W;
        for (let x = x0; x < x1; x++) g.flags[rowBase + x] &= ~stale;
      }

      for (let y = y1 - 1; y >= y0; y--) {
        const ltr = (rng.nextU32() & 1) === 0;
        const rowBase = y * W;
        for (let k = x0; k < x1; k++) {
          const x = ltr ? k : x1 - 1 - (k - x0);
          const i = rowBase + x;
          if ((g.flags[i] & moveBit) !== 0) continue;

          const m0 = g.mat[i];
          if (m0 !== MAT.AIR && NEEDS_TIME[m0] === 1 && cellNeedsTime(w, i, m0, ambient[i])) {
            awake = true;
          }

          updateCell(w, x, y, i, moveBit);

          if (botanyTick && g.mat[i] !== MAT.AIR && isPlant(g.mat[i])) {
            growPlant(w, x, y, i);
          }
        }
      }

      if (awake) g.keepAwake(c);
    }
  }
}

/** Растения — то, чем занимается ботаника, а не физика. */
function isPlant(m: number): boolean {
  return IS_PLANT[m] === 1;
}

/**
 * Клетке нужно внимание и на следующем тике?
 *
 * Так помечаются: всё, у чего есть время жизни (огонь, дым, пар); всё, что
 * нагрето выше среды и может воспламениться; всё, что может сменить фазу;
 * всё, что растёт. Обычный камень или вода при температуре среды сюда не
 * попадают — их чанк засыпает, и именно на этом экономится процессор.
 */
function cellNeedsTime(w: World, i: number, m: number, ambient: number): boolean {
  const g = w.grid;
  const d = MATERIALS[m];

  // Время жизни — это время, оно течёт независимо от температуры.
  if (d.lifetime > 0) return true;

  // Фазовые переходы и горение смотрим только при отклонении от среды.
  const t = g.temp[i];
  if (t !== ambient) {
    if (d.flammable > 0 && t > ambient + 5) return true;
    if (d.meltTemp !== NO_TEMP || d.freezeTemp !== NO_FREEZE) return true;
  }

  if (IS_PLANT[m] === 1) return plantNeedsTime(w, i, m);
  return false;
}

function updateCell(w: World, x: number, y: number, i: number, moveBit: number): void {
  const g = w.grid;
  let m = g.mat[i];
  if (m === MAT.AIR) return;

  react(w, x, y, i);
  m = g.mat[i];
  if (m === MAT.AIR) return;

  const d = MATERIALS[m];
  switch (d.state) {
    case ST.POWDER:
      movePowder(w, x, y, i, moveBit);
      break;
    case ST.LIQUID:
      moveLiquid(w, x, y, i, moveBit, d);
      break;
    case ST.GAS:
      moveGas(w, x, y, i, moveBit, d);
      break;
    default:
      // Твёрдое тело и огонь стоят на месте. Огонь намеренно не всплывает:
      // иначе пламя отрывалось бы от топлива и пожар не распространялся бы.
      break;
  }
}

/** Поджечь клетку, запомнив, останется ли после неё пепел. */
function ignite(w: World, x: number, y: number, i: number, fuel: MatDef): void {
  const g = w.grid;
  const ash = w.rng.chance(fuel.burnIntoChance);
  g.set(x, y, MAT.FIRE);
  g.flags[i] = ash ? FLAG.BURNING : 0;
}

/** Превращения: время жизни, воспламенение, плавление, замерзание. */
function react(w: World, x: number, y: number, i: number): void {
  const g = w.grid;
  const rng = w.rng;
  const m = g.mat[i];

  if (m === MAT.FIRE) {
    reactFire(w, x, y, i);
    return;
  }

  const d = MATERIALS[m];
  const t = g.temp[i];

  if (d.lifetime > 0) {
    if (g.aux[i] === 0) g.aux[i] = (d.lifetime * (0.6 + rng.nextFloat() * 0.8)) | 0;
    g.aux[i]--;
    if (g.aux[i] === 0) {
      g.set(x, y, d.lifetimeInto);
      return;
    }
  }

  if (d.flammable > 0 && t >= d.burnTemp && rng.chance(d.flammable)) {
    ignite(w, x, y, i, d);
    return;
  }

  if (d.meltTemp !== NO_TEMP && t >= d.meltTemp && rng.chance(d.meltChance)) {
    g.set(x, y, d.meltInto);
    return;
  }

  if (d.freezeTemp !== NO_FREEZE && t <= d.freezeTemp && rng.chance(d.freezeChance)) {
    g.set(x, y, d.freezeInto);
    return;
  }

  // Мокрый грунт превращается в грязь, а грязь на свету высыхает.
  if (m === MAT.DIRT) {
    if (rng.chance(0.004) && hasNeighbor(w, x, y, MAT.WATER)) g.set(x, y, MAT.MUD);
  } else if (m === MAT.MUD) {
    if (g.light[i] > 140 && rng.chance(0.001)) g.set(x, y, MAT.DIRT);
  }
}

function hasNeighbor(w: World, x: number, y: number, mat: number): boolean {
  const g = w.grid;
  const W = g.w;
  if (x > 0 && g.mat[y * W + x - 1] === mat) return true;
  if (x < W - 1 && g.mat[y * W + x + 1] === mat) return true;
  if (y > 0 && g.mat[(y - 1) * W + x] === mat) return true;
  if (y < g.h - 1 && g.mat[(y + 1) * W + x] === mat) return true;
  return false;
}

function reactFire(w: World, x: number, y: number, i: number): void {
  const g = w.grid;
  const rng = w.rng;
  const W = g.w;
  const H = g.h;

  // Живой огонь сам держит свою температуру — иначе тепло утечёт и он погаснет.
  if (g.temp[i] < 600) {
    g.temp[i] = (600 + (rng.nextU32() % 300)) | 0;
    w.thermalIdle = false;
    w.markHot(x, y);
  }

  if (g.aux[i] === 0) g.aux[i] = (40 + (rng.nextU32() % 60)) | 0;
  g.aux[i]--;

  // Вода и лёд тушат, сухое рядом занимается.
  for (let dy = -1; dy <= 1; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= H) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      if (nx < 0 || nx >= W) continue;
      const j = ny * W + nx;
      const nm = g.mat[j];
      if (nm === MAT.WATER || nm === MAT.SNOW || nm === MAT.ICE) {
        g.set(x, y, MAT.STEAM);
        if (rng.chance(0.5)) g.set(nx, ny, nm === MAT.ICE ? MAT.WATER : MAT.STEAM);
        return;
      }
      const nd = MATERIALS[nm];
      if (nd.flammable > 0 && rng.chance(nd.flammable)) {
        ignite(w, nx, ny, j, nd);
      }
    }
  }

  if (g.aux[i] === 0) {
    const ash = (g.flags[i] & FLAG.BURNING) !== 0;
    if (ash) g.set(x, y, MAT.ASH);
    else g.set(x, y, rng.chance(0.65) ? MAT.SMOKE : MAT.AIR);
  }
}

/** Перемещение с обменом: тяжёлое вниз, лёгкое вверх, воздух просто уступает место. */
function tryMove(
  w: World,
  x: number,
  y: number,
  nx: number,
  ny: number,
  i: number,
  moveBit: number,
): boolean {
  const g = w.grid;
  if (nx < 0 || nx >= g.w || ny < 0 || ny >= g.h) return false;

  const j = ny * g.w + nx;
  if ((g.flags[j] & moveBit) !== 0) return false;

  const self = MATERIALS[g.mat[i]];
  const targetMat = g.mat[j];
  if (!canDisplace(self, targetMat)) return false;

  const tMat = targetMat;
  const tFlags = g.flags[j];
  const tTemp = g.temp[j];
  const tAux = g.aux[j];

  g.mat[j] = self.id;
  // Ставим бит «двигалась» только за текущий тик: если оставить и старый,
  // частица накопила бы оба бита и застряла навсегда.
  g.flags[j] = (g.flags[i] & ~MOVE_MASK) | moveBit;
  g.temp[j] = g.temp[i];
  g.aux[j] = g.aux[i];

  g.mat[i] = tMat;
  g.flags[i] = tFlags & ~MOVE_MASK; // вытесненному газу даём шанс всплыть в этом же тике
  g.temp[i] = tTemp;
  g.aux[i] = tAux;

  g.touch(x, y);
  g.touch(nx, ny);
  return true;
}

function movePowder(w: World, x: number, y: number, i: number, moveBit: number): void {
  if (tryMove(w, x, y, x, y + 1, i, moveBit)) return;
  const dir = w.rng.sign();
  if (tryMove(w, x, y, x + dir, y + 1, i, moveBit)) return;
  tryMove(w, x, y, x - dir, y + 1, i, moveBit);
}

function moveLiquid(
  w: World,
  x: number,
  y: number,
  i: number,
  moveBit: number,
  d: MatDef,
): void {
  if (tryMove(w, x, y, x, y + 1, i, moveBit)) return;

  const dir = w.rng.sign();
  if (tryMove(w, x, y, x + dir, y + 1, i, moveBit)) return;
  if (tryMove(w, x, y, x - dir, y + 1, i, moveBit)) return;

  const g = w.grid;
  const self = MATERIALS[g.mat[i]];
  let best = -1;
  for (let s = 1; s <= d.dispersion; s++) {
    const nx = x + dir * s;
    if (nx < 0 || nx >= g.w) break;
    if (!canDisplace(self, g.mat[y * g.w + nx])) break;
    best = nx;
  }
  if (best >= 0) tryMove(w, x, y, best, y, i, moveBit);
}

function moveGas(
  w: World,
  x: number,
  y: number,
  i: number,
  moveBit: number,
  d: MatDef,
): void {
  const rng = w.rng;
  if (tryMove(w, x, y, x, y - 1, i, moveBit)) return;

  const dir = rng.sign();
  if (tryMove(w, x, y, x + dir, y - 1, i, moveBit)) return;
  if (tryMove(w, x, y, x - dir, y - 1, i, moveBit)) return;

  const spread = Math.max(1, d.dispersion);
  const step = 1 + rng.nextInt(spread);
  tryMove(w, x, y, x + dir * step, y, i, moveBit);
}

/**
 * Тепловой проход.
 *
 * Считаем по всей сетке каждые heatEveryTicks тиков. Если всё остыло до
 * своей температуры среды, проход выключается целиком (thermalIdle),
 * и статичный мир не тратит на тепло ничего.
 */
export function stepHeat(w: World): void {
  if (w.thermalIdle) return;

  const g = w.grid;
  const W = g.w;
  const H = g.h;
  const mat = g.mat;
  const temp = g.temp;
  const ambientMap = w.ambient;
  const cols = g.cols;
  const rows = g.rows;

  const hot = w.hotChunks;
  const hotNext = w.hotChunksNext;
  hotNext.fill(0);

  let nonAmbient = 0;

  for (let cy = 0; cy < rows; cy++) {
    const y0 = cy * CHUNK;
    const y1 = Math.min(y0 + CHUNK, H);
    for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx;
      // Чанк целиком при температуре среды — считать нечего.
      if (hot[c] === 0) continue;

      const x0 = cx * CHUNK;
      const x1 = Math.min(x0 + CHUNK, W);
      let chunkHot = false;

      for (let y = y0; y < y1; y++) {
        const row = y * W;
        for (let x = x0; x < x1; x++) {
          const i = row + x;
          const m = mat[i];

          let sum = 0;
          let cnt = 0;
          if (x > 0) {
            sum += temp[i - 1];
            cnt++;
          }
          if (x < W - 1) {
            sum += temp[i + 1];
            cnt++;
          }
          if (y > 0) {
            sum += temp[i - W];
            cnt++;
          }
          if (y < H - 1) {
            sum += temp[i + W];
            cnt++;
          }

          const ambient = ambientMap[i];
          const avg = sum / cnt;
          let t = temp[i] + (avg - temp[i]) * CONDUCT[m] * 0.25;
          // Воздух тянется к температуре среды быстро (упрощённая конвекция),
          // твёрдое тело — очень медленно.
          t += (ambient - t) * (m === MAT.AIR ? 0.02 : 0.0008);

          const ti = Math.round(t);
          temp[i] = ti;
          // Порог в пару градусов: поле температур среды неоднородно, и требовать
          // точного совпадения нельзя — иначе проход не выключится никогда.
          if (ti > ambient + 2 || ti < ambient - 2) {
            nonAmbient++;
            chunkHot = true;
          }
        }
      }

      if (!chunkHot) continue;

      // Тепло течёт через границы чанков: будим сам чанк и всех соседей.
      hotNext[c] = 1;
      if (cx > 0) hotNext[c - 1] = 1;
      if (cx + 1 < cols) hotNext[c + 1] = 1;
      if (cy > 0) hotNext[c - cols] = 1;
      if (cy + 1 < rows) hotNext[c + cols] = 1;
    }
  }

  w.swapHotChunks();
  w.thermalIdle = nonAmbient === 0;
}

/**
 * Свет: небесный сверху плюс растекание в стороны и вверх (пещеры, огонь).
 *
 * Свет нужен не для красоты: от него зависит, растёт ли трава, прорастает ли
 * семя и где селятся грибы. Поэтому он часть симуляции, а не эффект отрисовки.
 */
export function stepLight(w: World): void {
  const g = w.grid;
  const W = g.w;
  const H = g.h;
  const light = g.light;
  const mat = g.mat;
  const sky = w.skyLight;

  for (let x = 0; x < W; x++) {
    let l = sky;
    for (let y = 0; y < H; y++) {
      const i = y * W + x;
      const m = mat[i];
      const e = EMISSIVE[m];
      if (e > l) l = e;
      light[i] = l;
      l -= LIGHT_ATTEN[m];
      if (l < 0) l = 0;
    }
  }

  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 1; x < W; x++) {
      const v = light[row + x - 1] - 14;
      if (v > light[row + x]) light[row + x] = v;
    }
    for (let x = W - 2; x >= 0; x--) {
      const v = light[row + x + 1] - 14;
      if (v > light[row + x]) light[row + x] = v;
    }
  }

  for (let y = H - 2; y >= 0; y--) {
    const row = y * W;
    const up = row + W;
    for (let x = 0; x < W; x++) {
      const v = light[up + x] - 18;
      if (v > light[row + x]) light[row + x] = v;
    }
  }
}

/** Небесный свет по времени суток: от ночи к дню и обратно. */
export function computeSkyLight(tick: number, dayLengthTicks: number): number {
  const phase = (tick % dayLengthTicks) / dayLengthTicks;
  // Тик 0 — полдень: мир рождается днём, а не в темноте.
  const s = Math.sin(phase * Math.PI * 2 + Math.PI / 2);
  const norm = (s + 1) / 2;
  return Math.round(SKY_MIN + (SKY_MAX - SKY_MIN) * norm);
}

/**
 * Погода: дождь, снег и гроза.
 *
 * Дождь добавляет воду сверху, снег — только в холодной полосе мира,
 * гроза изредка бьёт молнией и поджигает сухое. Это и источник воды,
 * и источник опасности, и причина лесных пожаров.
 */
export function stepWeather(w: World): void {
  const g = w.grid;
  const rng = w.rng;

  if (w.tick >= w.weather.until) {
    const roll = rng.nextFloat();
    let kind: number = WEATHER.CLEAR;
    if (roll < 0.22) kind = WEATHER.RAIN;
    else if (roll < 0.34) kind = WEATHER.SNOW;
    else if (roll < 0.42) kind = WEATHER.STORM;
    w.weather.kind = kind;
    w.weather.until = w.tick + 1800 + rng.nextInt(5400);
  }

  const kind = w.weather.kind;
  if (kind === WEATHER.CLEAR) return;

  const drops = kind === WEATHER.STORM ? 5 : 3;
  for (let k = 0; k < drops; k++) {
    const x = rng.nextInt(g.w);
    const cold = w.ambientAt(x, 0) <= 1;
    const mat = kind === WEATHER.SNOW ? MAT.SNOW : cold ? MAT.SNOW : MAT.WATER;
    const y = rng.nextInt(3);
    const i = y * g.w + x;
    if (g.mat[i] === MAT.AIR) g.set(x, y, mat);
  }

  if (kind === WEATHER.STORM && rng.chance(0.002)) {
    strikeLightning(w, rng.nextInt(g.w));
  }
}

/** Разряд молнии: бьёт в первое, что встретит сверху, и поджигает сухое. */
export function strikeLightning(w: World, x: number): void {
  const g = w.grid;
  for (let y = 0; y < g.h; y++) {
    const i = y * g.w + x;
    const m = g.mat[i];
    if (m === MAT.AIR || m === MAT.WATER || m === MAT.SMOKE || m === MAT.STEAM) continue;
    const d = MATERIALS[m];
    if (d.flammable > 0) {
      ignite(w, x, y, i, d);
    } else if (d.state === ST.SOLID || d.state === ST.POWDER) {
      // Разряд уходит в землю: там просто становится жарко.
      w.heat(x, y, 2, 250);
    }
    return;
  }
}

export { MATERIALS };
