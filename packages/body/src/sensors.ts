/**
 * Датчики: состояние тела и мира в виде вектора чисел.
 *
 * Это вход рефлекторного мозга из Ф2. Пока мозга нет, но вектор уже нужен:
 * без него нельзя ни учить политику, ни проверять, что существо вообще
 * способно чувствовать то, что с ним происходит.
 *
 * Раскладка фиксирована и не меняется: если сдвинуть индекс, обученные
 * веса станут бессмысленными. Все значения приводятся к диапазону
 * примерно -1..1 — сети так проще.
 */
import { MAT, MAT_STATE, ST } from '../../world/src/materials.ts';
import type { World } from '../../world/src/world.ts';
import { SEG, SEGMENTS, SEGMENT_COUNT } from './body.ts';
import type { Creature } from './creature.ts';
import { REGION_COUNT } from './physiology.ts';

export const SENSE = {
  /** Угол каждого сегмента относительно родителя: 15 штук. */
  JOINT_ANGLE: 0,
  /** Скорость каждого сегмента: 16 штук. */
  SEGMENT_SPEED: 15,
  /** Наклон корпуса и высота головы: 4 штуки. */
  ORIENTATION: 31,
  /** Опора под стопами и кистями: 4 штуки. */
  CONTACT: 35,
  /** Боль по шести частям тела. */
  PAIN: 39,
  /** Драйвы: голод, жажда, усталость, страх, боль в целом. */
  DRIVES: 45,
  /** Внутренние датчики: кровь, кислород, глюкоза, температура, пульс. */
  VITALS: 50,
  /** Обоняние рук: что в левой и правой кисти. */
  HANDS: 55,
  /** Зрение: полоса материалов перед головой, 9 клеток. */
  SIGHT: 57,
  /** Температура и свет вокруг головы. */
  AMBIENT: 66,
  COUNT: 68,
} as const;

export const SENSE_COUNT = SENSE.COUNT;

/** Полоса обзора: девять клеток вперёд на уровне головы. */
const SIGHT_CELLS = 9;

/** Что видит существо: воздух, твёрдое, жидкость, еда, опасность. */
function classify(m: number): number {
  if (m === MAT.AIR) return 0;
  if (m === MAT.FIRE || m === MAT.LAVA) return -1;
  if (MAT_STATE[m] === ST.LIQUID) return -0.5;
  if (m === MAT.GRASS || m === MAT.LEAVES || m === MAT.BUSH || m === MAT.FRUIT || m === MAT.MUSHROOM || m === MAT.ALGAE) {
    return 0.8;
  }
  if (m === MAT.MEAT) return 0.6;
  return 0.3;
}

/**
 * Заполнить вектор наблюдений. Ничего не возвращает: пишет в готовый буфер,
 * чтобы не создавать мусор на каждом тике.
 */
export function readSensors(w: World, c: Creature, out: Float32Array): void {
  const g = w.grid;
  const body = c.body;
  const p = c.physiology;

  out.fill(0);

  // --- углы суставов и скорости сегментов
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const s = SEGMENTS[i];
    if (s.parent >= 0) {
      const ax = body.x[i] - body.x[s.parent];
      const ay = body.y[i] - body.y[s.parent];
      const bx = s.dir[0];
      const by = s.dir[1];
      const cross = ax * by - ay * bx;
      const dot = ax * bx + ay * by;
      out[SENSE.JOINT_ANGLE + (i - 1)] = Math.max(-1, Math.min(1, Math.atan2(cross, dot) / Math.PI));
    }
    const vx = body.x[i] - body.prevX[i];
    const vy = body.y[i] - body.prevY[i];
    out[SENSE.SEGMENT_SPEED + i] = Math.max(-1, Math.min(1, (vx + vy) * 8));
  }

  // --- наклон корпуса, высота головы, «где земля»
  const pelvis = { x: body.x[SEG.PELVIS], y: body.y[SEG.PELVIS] };
  const chest = { x: body.x[SEG.CHEST], y: body.y[SEG.CHEST] };
  const upX = chest.x - pelvis.x;
  const upY = chest.y - pelvis.y;
  out[SENSE.ORIENTATION + 0] = Math.max(-1, Math.min(1, upX)); // наклон вбок
  out[SENSE.ORIENTATION + 1] = upY < 0 ? 1 : -1; // стоит ли вверх головой
  const headToGround = groundDistance(g, body.x[SEG.HEAD], body.y[SEG.HEAD]);
  out[SENSE.ORIENTATION + 2] = Math.max(-1, Math.min(1, headToGround / 20));
  out[SENSE.ORIENTATION + 3] = Math.max(-1, Math.min(1, (g.h - body.y[SEG.PELVIS]) / g.h));

  // --- опора под конечностями
  const contactPoints = [SEG.L_FOOT, SEG.R_FOOT, SEG.L_HAND, SEG.R_HAND];
  for (let k = 0; k < contactPoints.length; k++) {
    const id = contactPoints[k];
    out[SENSE.CONTACT + k] = supported(g, body.x[id], body.y[id]) ? 1 : 0;
  }

  // --- боль и драйвы
  for (let r = 0; r < REGION_COUNT; r++) out[SENSE.PAIN + r] = p.pain[r];
  out[SENSE.DRIVES + 0] = p.hunger;
  out[SENSE.DRIVES + 1] = p.thirst;
  out[SENSE.DRIVES + 2] = p.fatigue;
  out[SENSE.DRIVES + 3] = p.fear;
  out[SENSE.DRIVES + 4] = p.painLevel;

  // --- внутренние датчики
  out[SENSE.VITALS + 0] = p.blood / 5 - 1;
  out[SENSE.VITALS + 1] = (p.oxygen / 100) * 2 - 1;
  out[SENSE.VITALS + 2] = Math.max(-1, Math.min(1, (p.glucose - 5) / 5));
  out[SENSE.VITALS + 3] = Math.max(-1, Math.min(1, (p.coreTemp - 37) / 5));
  out[SENSE.VITALS + 4] = Math.max(-1, Math.min(1, (p.heartRate - 70) / 100));

  // --- что в руках
  out[SENSE.HANDS + 0] = materialAt(g, body.x[SEG.L_HAND], body.y[SEG.L_HAND]);
  out[SENSE.HANDS + 1] = materialAt(g, body.x[SEG.R_HAND], body.y[SEG.R_HAND]);

  // --- зрение: полоса перед головой в сторону, куда смотрит корпус
  const facing = upX >= 0 ? 1 : -1;
  const hx = Math.round(body.x[SEG.HEAD]);
  const hy = Math.round(body.y[SEG.HEAD]);
  for (let k = 0; k < SIGHT_CELLS; k++) {
    const x = hx + facing * (k + 1);
    out[SENSE.SIGHT + k] = materialAt(g, x, hy);
  }

  // --- температура и свет у головы
  const hi = hy * g.w + hx;
  if (hx >= 0 && hy >= 0 && hx < g.w && hy < g.h) {
    out[SENSE.AMBIENT + 0] = Math.max(-1, Math.min(1, (g.temp[hi] - w.ambient[hi]) / 40));
    out[SENSE.AMBIENT + 1] = (g.light[hi] / 255) * 2 - 1;
  }
}

/** Расстояние до первой твёрдой клетки вниз. */
function groundDistance(g: World['grid'], x: number, y: number): number {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let k = 0; k < 24; k++) {
    const yy = cy + k;
    if (yy >= g.h) return 24;
    if (MAT_STATE[g.mat[yy * g.w + cx]] === ST.SOLID || MAT_STATE[g.mat[yy * g.w + cx]] === ST.POWDER) {
      return k;
    }
  }
  return 24;
}

function supported(g: World['grid'], x: number, y: number): boolean {
  const cx = Math.round(x);
  const cy = Math.round(y) + 1;
  if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return false;
  const m = g.mat[cy * g.w + cx];
  return m !== MAT.AIR && (MAT_STATE[m] === ST.SOLID || MAT_STATE[m] === ST.POWDER);
}

function materialAt(g: World['grid'], x: number, y: number): number {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return 0;
  return classify(g.mat[cy * g.w + cx]);
}

/** Подписи для панели наблюдателя: что именно означает каждое число. */
export function senseLabels(): string[] {
  const labels: string[] = [];
  for (let i = 1; i < SEGMENT_COUNT; i++) labels.push(`сустав ${SEGMENTS[i].name}`);
  for (let i = 0; i < SEGMENT_COUNT; i++) labels.push(`скорость ${SEGMENTS[i].name}`);
  labels.push('наклон корпуса', 'вверх головой', 'высота головы', 'глубина');
  labels.push('опора: л.стопа', 'опора: п.стопа', 'опора: л.кисть', 'опора: п.кисть');
  for (let r = 0; r < REGION_COUNT; r++) labels.push(`боль ${r}`);
  labels.push('голод', 'жажда', 'усталость', 'страх', 'боль');
  labels.push('кровь', 'кислород', 'глюкоза', 'температура', 'пульс');
  labels.push('в левой руке', 'в правой руке');
  for (let k = 0; k < SIGHT_CELLS; k++) labels.push(`взгляд +${k + 1}`);
  labels.push('тепло вокруг', 'свет вокруг');
  return labels;
}
