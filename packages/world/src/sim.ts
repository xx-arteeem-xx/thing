/**
 * Ядро симуляции мира.
 *
 * Один тик: пересчёт только грязных чанков (снизу вверх), затем тепловой проход.
 * Всё поведение клетки выводится из таблицы веществ — отдельных «скриптов»
 * для песка или воды здесь нет, есть состояние и правила.
 *
 * Детерминизм: порядок обхода фиксирован, все случайные решения берутся
 * из w.rng, «уже двигалась» хранится в бите-паритете (MOVE_A/MOVE_B),
 * который переключается каждый тик — поэтому никакой очистки флагов не нужно.
 */
import { CHUNK, FLAG, MOVE_MASK } from './grid.ts';
import {
  MAT,
  MATERIALS,
  NO_FREEZE,
  NO_TEMP,
  ST,
  canDisplace,
} from './materials.ts';
import type { MatDef } from './materials.ts';
import type { World } from './world.ts';

/** Полный тик мира. */
export function stepWorld(w: World): void {
  const g = w.grid;
  g.beginTick();

  const moveBit = (w.tick & 1) === 0 ? FLAG.MOVE_A : FLAG.MOVE_B;
  updateMaterials(w, moveBit);

  if (w.tick % w.cfg.heatEveryTicks === 0) stepHeat(w);

  w.tick++;
}

function updateMaterials(w: World, moveBit: number): void {
  const g = w.grid;
  const rng = w.rng;
  const W = g.w;
  const H = g.h;
  const cols = g.cols;
  const rows = g.rows;
  const ambient = w.cfg.ambient;

  // Чанки снизу вверх: тяжёлое падает в уже обработанную область и не
  // пересчитывается повторно, а лёгкое всплывает наверх и там тормозится битом MOVED.
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
          if (m0 !== MAT.AIR && cellNeedsTime(g, i, m0, ambient)) awake = true;
          updateCell(w, x, y, i, moveBit);
        }
      }

      if (awake) g.keepAwake(c);
    }
  }
}

/**
 * Клетке нужно внимание и на следующем тике?
 *
 * Так помечаются: всё, у чего есть время жизни (огонь, дым, пар); всё, что
 * нагрето выше среды и может воспламениться; всё, что может сменить фазу.
 * Обычный камень или вода при температуре среды сюда не попадают — их чанк
 * засыпает, и именно на этом экономится процессор.
 */
function cellNeedsTime(g: { mat: Uint8Array; temp: Int16Array }, i: number, m: number, ambient: number): boolean {
  const d = MATERIALS[m];
  if (d.lifetime > 0) return true;

  const t = g.temp[i];
  if (d.flammable > 0 && t > ambient + 5) return true;
  if ((d.meltTemp !== NO_TEMP || d.freezeTemp !== NO_FREEZE) && t !== ambient) return true;

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
    g.set(x, y, MAT.FIRE);
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
      if (nm === MAT.WATER || nm === MAT.ICE) {
        g.set(x, y, MAT.STEAM);
        if (rng.chance(0.5)) g.set(nx, ny, MAT.STEAM);
        return;
      }
      const nd = MATERIALS[nm];
      if (nd.flammable > 0 && rng.chance(nd.flammable)) {
        g.set(nx, ny, MAT.FIRE);
      }
    }
  }

  if (g.aux[i] === 0) {
    g.set(x, y, rng.chance(0.35) ? MAT.SMOKE : MAT.AIR);
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

  // Растекание: ищем самую дальнюю свободную клетку в ряду.
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
 * Упрощение: считаем по всей сетке каждые heatEveryTicks тиков, а не по
 * горячим чанкам. Пока это ~0.3 мс на тик в среднем — в бюджет влезает.
 * Если в мире всё остыло до ambient, проход выключается целиком (thermalIdle),
 * и статичный мир не тратит на тепло вообще ничего.
 */
export function stepHeat(w: World): void {
  if (w.thermalIdle) return;

  const g = w.grid;
  const W = g.w;
  const H = g.h;
  const mat = g.mat;
  const temp = g.temp;
  const ambient = w.cfg.ambient;

  let nonAmbient = 0;

  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
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

      const d = MATERIALS[m];
      const avg = sum / cnt;
      let t = temp[i] + (avg - temp[i]) * d.conductivity * 0.25;
      // Воздух тянется к температуре среды быстро (это упрощённая конвекция),
      // твёрдое тело — очень медленно.
      t += (ambient - t) * (m === MAT.AIR ? 0.02 : 0.0008);

      const ti = Math.round(t);
      temp[i] = ti;
      if (ti > ambient + 1 || ti < ambient - 1) nonAmbient++;
    }
  }

  w.thermalIdle = nonAmbient === 0;
}
