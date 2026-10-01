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
  BURN_INTO_CHANCE,
  BURN_TEMP,
  CONDUCT,
  DENSITY,
  DISPERSION,
  EMISSIVE,
  FLAMMABLE,
  FREEZE_CHANCE,
  FREEZE_INTO,
  FREEZE_TEMP,
  IS_PLANT,
  LIFETIME,
  LIFETIME_INTO,
  LIGHT_ATTEN,
  MAT,
  MAT_STATE,
  MATERIALS,
  MELT_CHANCE,
  MELT_INTO,
  MELT_TEMP,
  NEEDS_TIME,
  NO_FREEZE,
  NO_TEMP,
  ST,
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

/** Частота мира по умолчанию: 60 тиков в секунду. */
export const TICK_HZ = 60;

/** Полный тик мира. */
export function stepWorld(w: World): void {

  const g = w.grid;
  g.beginTick();

  // Свет считаем ДО материалов: от него зависит, растёт ли трава и прорастает
  // ли семя. Если считать его после, то на самом первом тике весь мир будет
  // «тёмным», растения решат, что расти некуда, и их чанки уснут навсегда.
  // Свет обновляем четвертями: полный проход по 131 072 клеткам давал
  // пик в 5 мс, из-за которого мир дёргался. Теперь каждые 4 тика
  // пересчитывается четверть столбцов, а полный круг занимает 16 тиков.
  const lightParts = 4;
  const lightStep = Math.max(1, Math.round(w.cfg.lightEveryTicks / lightParts));
  if (w.tick === 0) {
    // На старте свет считаем целиком. Иначе часть столбцов остаётся с нулём,
    // и растущие в них растения решают, что света нет, и засыпают навсегда.
    stepLight(w, 0, 1);
  } else if (w.tick % lightStep === 0) {
    stepLight(w, ((w.tick / lightStep) | 0) % lightParts, lightParts);
  }

  const moveBit = (w.tick & 1) === 0 ? FLAG.MOVE_A : FLAG.MOVE_B;
  updateMaterials(w, moveBit);

  if (w.tick % w.cfg.heatEveryTicks === 0) stepHeat(w);
  if (w.tick % SLOW_EVERY === 0) stepSlow(w);
  if (w.cfg.weather) stepWeather(w);

  // Живность ходит каждый тик: движение должно быть плавным, а восприятие
  // внутри устроено реже (см. Fauna.step).
  w.fauna.step(w);
  // Существо живёт в том же времени, что и мир.
  if (w.creature !== null) w.creature.step(w, 1 / TICK_HZ, 0);

  w.tick++;
}

/** Счётчики для замеров: сколько работы реально делается за тик. */
export const debugStats = { chunks: 0, cells: 0, ticks: 0 };

function updateMaterials(w: World, moveBit: number): void {
  const g = w.grid;
  const rng = w.rng;
  const W = g.w;
  const H = g.h;
  const cols = g.cols;
  const rows = g.rows;
  const ambient = w.ambient;
  const mat = g.mat;
  const flags = g.flags;
  const temp = g.temp;
  const botanyTick = w.tick % BOTANY_EVERY === 0;

  debugStats.ticks++;
  debugStats.chunks = 0;
  debugStats.cells = 0;

  for (let cy = rows - 1; cy >= 0; cy--) {
    for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx;
      if (g.isDirty(c) === false) continue;
      debugStats.chunks++;
      debugStats.cells += CHUNK * CHUNK;

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
        for (let x = x0; x < x1; x++) flags[rowBase + x] &= ~stale;
      }

      for (let y = y1 - 1; y >= y0; y--) {
        const ltr = (rng.nextU32() & 1) === 0;
        const rowBase = y * W;
        for (let k = x0; k < x1; k++) {
          const x = ltr ? k : x1 - 1 - (k - x0);
          const i = rowBase + x;
          if ((flags[i] & moveBit) !== 0) continue;

          const m0 = mat[i];
          if (m0 !== MAT.AIR && NEEDS_TIME[m0] === 1 && cellNeedsTime(w, i, m0, ambient[i], temp[i])) {
            awake = true;
          }

          updateCell(w, x, y, i, moveBit);

          if (botanyTick && IS_PLANT[mat[i]] === 1) growPlant(w, x, y, i);
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
 * может сменить фазу или загореться; всё, что растёт. Обычный камень или
 * вода при температуре среды сюда не попадают — их чанк засыпает, и именно
 * на этом экономится процессор.
 */
function cellNeedsTime(w: World, i: number, m: number, ambient: number, t: number): boolean {
  // Время жизни — это время, оно течёт независимо от температуры.
  if (LIFETIME[m] > 0) return true;

  const melt = MELT_TEMP[m];
  const freeze = FREEZE_TEMP[m];

  // Важно сравнивать не только с температурой клетки, но и со средой: вода
  // в холодной полосе мира обязана замёрзнуть, даже если её собственная
  // температура уже сравнялась со средой. Иначе её чанк уснёт и лёд не встанет.
  if (melt !== NO_TEMP && (t >= melt || ambient >= melt)) return true;
  if (freeze !== NO_FREEZE && (t <= freeze || ambient <= freeze)) return true;

  if (FLAMMABLE[m] > 0 && (t >= BURN_TEMP[m] || t > ambient + 5)) return true;

  if (IS_PLANT[m] === 1) return plantNeedsTime(w, i, m);
  return false;
}

function updateCell(w: World, x: number, y: number, i: number, moveBit: number): void {
  const g = w.grid;
  const flags = g.flags;
  const mat = g.mat;
  let m = mat[i];
  if (m === MAT.AIR) return;

  react(w, x, y, i);
  m = mat[i];
  if (m === MAT.AIR) return;

  // Покоящуюся клетку двигать не пробуем: попытка стоит столько же, сколько
  // движение, а решение «стою» пересматривается только когда рядом что-то
  // изменилось (Grid.touch снимает флаг).
  if ((flags[i] & FLAG.SETTLED) !== 0) return;

  switch (MAT_STATE[m]) {
    case ST.POWDER:
      if (!movePowder(w, x, y, i, moveBit)) flags[i] |= FLAG.SETTLED;
      break;
    case ST.LIQUID:
      if (!moveLiquid(w, x, y, i, moveBit, m)) flags[i] |= FLAG.SETTLED;
      break;
    case ST.GAS:
      if (!moveGas(w, x, y, i, moveBit, m)) flags[i] |= FLAG.SETTLED;
      break;
    default:
      // Твёрдое тело и огонь стоят на месте. Огонь намеренно не всплывает:
      // иначе пламя отрывалось бы от топлива и пожар не распространялся бы.
      break;
  }
}

/**
 * Отметить превращение в летописи. Ключ — пара «было > стало»: именно такие
 * пары и есть открытия мира, и именно их потом будет искать любопытство.
 */
function noteChange(w: World, from: number, to: number): void {
  if (from === to) return;
  w.journal.note(
    w.tick,
    'превращение',
    `${MATERIALS[from].key}>${MATERIALS[to].key}`,
    `${MATERIALS[from].name} → ${MATERIALS[to].name}`,
  );
}

/** Поджечь клетку, запомнив, останется ли после неё пепел. */
function ignite(w: World, x: number, y: number, i: number, ashChance: number): void {
  const g = w.grid;
  const ash = w.rng.chance(ashChance);
  noteChange(w, g.mat[i], MAT.FIRE);
  g.set(x, y, MAT.FIRE);
  g.flags[i] = ash ? FLAG.BURNING : 0;
}

/** Превращения: время жизни, воспламенение, плавление, замерзание. */
function react(w: World, x: number, y: number, i: number): void {
  const g = w.grid;
  const rng = w.rng;
  const mat = g.mat;
  const m = mat[i];

  if (m === MAT.FIRE) {
    reactFire(w, x, y, i);
    return;
  }

  const t = g.temp[i];

  const life = LIFETIME[m];
  if (life > 0) {
    const aux = g.aux;
    if (aux[i] === 0) aux[i] = (life * (0.6 + rng.nextFloat() * 0.8)) | 0;
    aux[i]--;
    if (aux[i] === 0) {
      noteChange(w, m, LIFETIME_INTO[m]);
      g.set(x, y, LIFETIME_INTO[m]);
      return;
    }
  }

  const flam = FLAMMABLE[m];
  if (flam > 0 && t >= BURN_TEMP[m] && rng.chance(flam)) {
    ignite(w, x, y, i, BURN_INTO_CHANCE[m]);
    return;
  }

  // Лава, встретив воду, застывает обсидианом, а вода уходит паром.
  if (m === MAT.LAVA) {
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w.grid.w || ny >= w.grid.h) continue;
      const j = ny * w.grid.w + nx;
      if (g.mat[j] !== MAT.WATER) continue;
      noteChange(w, MAT.LAVA, MAT.OBSIDIAN);
      g.set(x, y, MAT.OBSIDIAN);
      noteChange(w, MAT.WATER, MAT.STEAM);
      g.set(nx, ny, MAT.STEAM);
      return;
    }
  }

  const melt = MELT_TEMP[m];
  if (melt !== NO_TEMP && t >= melt && rng.chance(MELT_CHANCE[m])) {
    noteChange(w, m, MELT_INTO[m]);
    g.set(x, y, MELT_INTO[m]);
    return;
  }

  const freeze = FREEZE_TEMP[m];
  if (freeze !== NO_FREEZE && t <= freeze && rng.chance(FREEZE_CHANCE[m])) {
    noteChange(w, m, FREEZE_INTO[m]);
    g.set(x, y, FREEZE_INTO[m]);
    return;
  }

  // Мокрый грунт превращается в грязь, а грязь на свету высыхает.
  // Это медленный процесс, и он вынесен в stepSlow: внутри обхода клеток
  // он не работал бы, потому что уснувший чанк не пересчитывается, а ждать
  // события рядом можно вечно.
}

/**
 * Медленные превращения: раз в SLOW_EVERY тиков по всей сетке.
 *
 * Здесь живут процессы, которые зависят от соседства двух неподвижных
 * веществ (мокрая земля → грязь, грязь на свету → земля). Внутри обычного
 * обхода они не работают: уснувший чанк не пересчитывается, а повода
 * проснуться у него нет — вода уже утекла, и всё замерло навсегда.
 *
 * Стоимость: полный проход раз в 64 тика — около 0.05 мс на тик.
 */
export const SLOW_EVERY = 64;

export function stepSlow(w: World): void {
  const g = w.grid;
  const rng = w.rng;
  const W = g.w;
  const H = g.h;
  const mat = g.mat;
  const light = g.light;
  const temp = g.temp;
  let waterCells = 0;

  for (let y = 1; y < H - 1; y++) {
    const row = y * W;
    for (let x = 1; x < W - 1; x++) {
      const i = row + x;
      const m = mat[i];

      if (m === MAT.WATER || m === MAT.ICE || m === MAT.SNOW || m === MAT.STEAM) {
        waterCells++;
        // Круговорот воды: нагретая на свету вода испаряется и возвращается
        // дождём. Без испарения дождь копил воду без предела и затапливал луг —
        // трава оказывалась под водой, и зверью было не до чего дотянуться.
        if (m === MAT.WATER && light[i] > 80 && temp[i] > 8 && rng.chance(0.0009)) {
          noteChange(w, MAT.WATER, MAT.STEAM);
          g.set(x, y, MAT.STEAM);
          continue;
        }
      }

      if (m === MAT.DIRT) {
        if (!rng.chance(0.02)) continue;
        if (
          mat[i - 1] === MAT.WATER ||
          mat[i + 1] === MAT.WATER ||
          mat[i - W] === MAT.WATER ||
          mat[i + W] === MAT.WATER
        ) {
          noteChange(w, MAT.DIRT, MAT.MUD);
          g.set(x, y, MAT.MUD);
        }
      } else if (m === MAT.MUD) {
        if (light[i] > 140 && rng.chance(0.06)) {
          noteChange(w, MAT.MUD, MAT.DIRT);
          g.set(x, y, MAT.DIRT);
        }
      }
    }
  }

  w.waterCells = waterCells;
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
        noteChange(w, MAT.FIRE, MAT.STEAM);
        g.set(x, y, MAT.STEAM);
        if (rng.chance(0.5)) g.set(nx, ny, nm === MAT.ICE ? MAT.WATER : MAT.STEAM);
        return;
      }
      const nd = FLAMMABLE[nm];
      if (nd > 0 && rng.chance(nd)) {
        ignite(w, nx, ny, j, BURN_INTO_CHANCE[nm]);
      }
    }
  }

  if (g.aux[i] === 0) {
    const ash = (g.flags[i] & FLAG.BURNING) !== 0;
    if (ash) {
      noteChange(w, MAT.FIRE, MAT.ASH);
      g.set(x, y, MAT.ASH);
    } else {
      // Часть перегоревшего дерева остаётся древесным углём — лучшим топливом.
      const roll = rng.nextFloat();
      const into = roll < 0.1 ? MAT.CHARCOAL : roll < 0.65 ? MAT.SMOKE : MAT.AIR;
      noteChange(w, MAT.FIRE, into);
      g.set(x, y, into);
    }
  }
}

/** Может ли вещество с такими свойствами занять клетку target. */
function canDisplaceFast(selfState: number, selfDensity: number, target: number): boolean {
  if (target === MAT.AIR) return true;
  const ts = MAT_STATE[target];
  if (ts === ST.SOLID || ts === ST.POWDER) return false;
  if (ts === ST.LIQUID) return selfState === ST.GAS;
  if (selfState === ST.GAS || selfState === ST.ENERGY) return DENSITY[target] > selfDensity;
  return true;
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
  const flags = g.flags;
  if ((flags[j] & moveBit) !== 0) return false;

  const mat = g.mat;
  const self = mat[i];
  const targetMat = mat[j];
  if (!canDisplaceFast(MAT_STATE[self], DENSITY[self], targetMat)) return false;

  const temp = g.temp;
  const aux = g.aux;

  const tFlags = flags[j];
  const tTemp = temp[j];
  const tAux = aux[j];

  mat[j] = self;
  // Ставим бит «двигалась» только за текущий тик: если оставить и старый,
  // частица накопила бы оба бита и застряла навсегда.
  flags[j] = (flags[i] & ~MOVE_MASK) | moveBit;
  temp[j] = temp[i];
  aux[j] = aux[i];

  mat[i] = targetMat;
  flags[i] = tFlags & ~MOVE_MASK; // вытесненному газу даём шанс всплыть в этом же тике
  temp[i] = tTemp;
  aux[i] = tAux;

  g.touch(x, y);
  g.touch(nx, ny);
  return true;
}

function movePowder(w: World, x: number, y: number, i: number, moveBit: number): boolean {
  if (tryMove(w, x, y, x, y + 1, i, moveBit)) return true;
  const dir = w.rng.sign();
  if (tryMove(w, x, y, x + dir, y + 1, i, moveBit)) return true;
  return tryMove(w, x, y, x - dir, y + 1, i, moveBit);
}

function moveLiquid(
  w: World,
  x: number,
  y: number,
  i: number,
  moveBit: number,
  m: number,
): boolean {
  if (tryMove(w, x, y, x, y + 1, i, moveBit)) return true;

  const dir = w.rng.sign();
  if (tryMove(w, x, y, x + dir, y + 1, i, moveBit)) return true;
  if (tryMove(w, x, y, x - dir, y + 1, i, moveBit)) return true;

  const g = w.grid;
  const mat = g.mat;
  let best = -1;
  const dispersion = DISPERSION[m];
  for (let s = 1; s <= dispersion; s++) {
    const nx = x + dir * s;
    if (nx < 0 || nx >= g.w) break;
    if (!canDisplaceFast(MAT_STATE[m], DENSITY[m], mat[y * g.w + nx])) break;
    best = nx;
  }
  if (best >= 0) return tryMove(w, x, y, best, y, i, moveBit);
  return false;
}

function moveGas(
  w: World,
  x: number,
  y: number,
  i: number,
  moveBit: number,
  m: number,
): boolean {
  const rng = w.rng;
  if (tryMove(w, x, y, x, y - 1, i, moveBit)) return true;

  const dir = rng.sign();
  if (tryMove(w, x, y, x + dir, y - 1, i, moveBit)) return true;
  if (tryMove(w, x, y, x - dir, y - 1, i, moveBit)) return true;

  const spread = Math.max(1, DISPERSION[m]);
  const step = 1 + rng.nextInt(spread);
  return tryMove(w, x, y, x + dir * step, y, i, moveBit);
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
export function stepLight(w: World, part = 0, parts = 1): void {
  const g = w.grid;
  const W = g.w;
  const H = g.h;
  const light = g.light;
  const mat = g.mat;
  const sky = w.skyLight;

  const span = Math.ceil(W / parts);
  const xStart = part * span;
  const xEnd = Math.min(W, xStart + span);

  for (let x = xStart; x < xEnd; x++) {
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
    const from = Math.max(1, xStart);
    const to = Math.min(W - 1, xEnd);
    for (let x = from; x < to; x++) {
      const v = light[row + x - 1] - 14;
      if (v > light[row + x]) light[row + x] = v;
    }
    for (let x = to - 1; x >= from; x--) {
      const v = light[row + x + 1] - 14;
      if (v > light[row + x]) light[row + x] = v;
    }
  }

  for (let y = H - 2; y >= 0; y--) {
    const row = y * W;
    const up = row + W;
    for (let x = xStart; x < xEnd; x++) {
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
    if (kind !== WEATHER.CLEAR) {
      w.journal.note(w.tick, 'погода', String(kind), `в мире впервые: ${WEATHER_NAME[kind]}`);
    }
    w.weather.until = w.tick + 1800 + rng.nextInt(5400);
    w.weather.cloudW = 70 + rng.nextInt(120);
    w.weather.cloudX = rng.nextInt(g.w);
    w.weather.wind = (rng.chance(0.5) ? 1 : -1) * (0.15 + rng.nextFloat() * 0.5);
  }

  const kind = w.weather.kind;
  if (kind === WEATHER.CLEAR) return;

  // Воды в мире и так достаточно — дождь ждёт, пока она вернётся в небо.
  if (w.waterCells > w.cfg.maxWaterCells) return;

  // Дождь идёт из тучи, а не по всему миру сразу. Это и честнее, и в разы
  // дешевле: сплошной ливень держал бодрствующими 205 чанков из 512.
  w.weather.cloudX += w.weather.wind;
  if (w.weather.cloudX < -w.weather.cloudW) {
    w.weather.cloudX = g.w + w.weather.cloudW;
    w.weather.wind = 0.15 + rng.nextFloat() * 0.5;
  }
  if (w.weather.cloudX > g.w + w.weather.cloudW) {
    w.weather.cloudX = -w.weather.cloudW;
    w.weather.wind = -(0.15 + rng.nextFloat() * 0.5);
  }

  const drops = kind === WEATHER.STORM ? 4 : 2;
  const x0 = Math.max(0, Math.round(w.weather.cloudX - w.weather.cloudW / 2));
  const x1 = Math.min(g.w - 1, Math.round(w.weather.cloudX + w.weather.cloudW / 2));

  for (let k = 0; k < drops; k++) {
    const x = x0 + rng.nextInt(Math.max(1, x1 - x0));
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
    if (FLAMMABLE[m] > 0) {
      ignite(w, x, y, i, BURN_INTO_CHANCE[m]);
    } else if (MAT_STATE[m] === ST.SOLID || MAT_STATE[m] === ST.POWDER) {
      // Разряд уходит в землю: там просто становится жарко.
      w.heat(x, y, 2, 250);
    }
    return;
  }
}

export { MATERIALS };
