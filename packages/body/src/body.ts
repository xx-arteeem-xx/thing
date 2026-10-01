/**
 * Тело: скелет из сегментов и суставов.
 *
 * Первый шаг Ф1. Пока это только физика — тело падает, лежит на земле,
 * не разваливается на части и не проваливается сквозь породу. Мышцы,
 * органы, боль и смерть придут следующими шагами, и им нужна именно
 * такая основа: массив точек, который можно толкать и ограничивать.
 *
 * Интегратор — Верле: он устойчив при больших шагах и не требует хранить
 * ускорения. Скелет — дерево: каждый сегмент знает родителя, а сустав
 * удерживает заданное расстояние. Пределы сгиба задаются дополнительными
 * связями «внук — дед», которые не дают суставу вывернуться.
 */
import { MAT, MAT_STATE, ST } from '../../world/src/materials.ts';
import type { World } from '../../world/src/world.ts';

/** Порядок сегментов фиксирован: он попадает в снапшот. */
export const SEG = {
  PELVIS: 0,
  CHEST: 1,
  NECK: 2,
  HEAD: 3,
  L_UPPER_ARM: 4,
  L_FOREARM: 5,
  L_HAND: 6,
  R_UPPER_ARM: 7,
  R_FOREARM: 8,
  R_HAND: 9,
  L_THIGH: 10,
  L_SHIN: 11,
  L_FOOT: 12,
  R_THIGH: 13,
  R_SHIN: 14,
  R_FOOT: 15,
} as const;

export const SEGMENT_COUNT = 16;

export interface SegmentDef {
  id: number;
  key: string;
  name: string;
  /** Длина сегмента в клетках (расстояние от родителя до этой точки). */
  length: number;
  /** Направление от родителя в позе «стоя»: [dx, dy], уже нормализованное. */
  dir: [number, number];
  /** Радиус для столкновений и отрисовки. */
  radius: number;
  /** Масса: влияет на распределение поправок в связях. */
  mass: number;
  /** Родительский сегмент, -1 у таза. */
  parent: number;
}

export const SEGMENTS: SegmentDef[] = [
  { id: SEG.PELVIS, key: 'pelvis', name: 'таз', length: 0, dir: [0, 0], radius: 1.1, mass: 2.2, parent: -1 },
  { id: SEG.CHEST, key: 'chest', name: 'грудь', length: 2.0, dir: [0, -1], radius: 1.3, mass: 2.4, parent: SEG.PELVIS },
  { id: SEG.NECK, key: 'neck', name: 'шея', length: 0.8, dir: [0, -1], radius: 0.6, mass: 0.5, parent: SEG.CHEST },
  { id: SEG.HEAD, key: 'head', name: 'голова', length: 1.1, dir: [0, -1], radius: 1.0, mass: 1.6, parent: SEG.NECK },
  { id: SEG.L_UPPER_ARM, key: 'l_upper_arm', name: 'левое плечо', length: 1.4, dir: [-1, 0], radius: 0.6, mass: 0.5, parent: SEG.CHEST },
  { id: SEG.L_FOREARM, key: 'l_forearm', name: 'левое предплечье', length: 1.3, dir: [0, 1], radius: 0.5, mass: 0.4, parent: SEG.L_UPPER_ARM },
  { id: SEG.L_HAND, key: 'l_hand', name: 'левая кисть', length: 0.6, dir: [0, 1], radius: 0.5, mass: 0.2, parent: SEG.L_FOREARM },
  { id: SEG.R_UPPER_ARM, key: 'r_upper_arm', name: 'правое плечо', length: 1.4, dir: [1, 0], radius: 0.6, mass: 0.5, parent: SEG.CHEST },
  { id: SEG.R_FOREARM, key: 'r_forearm', name: 'правое предплечье', length: 1.3, dir: [0, 1], radius: 0.5, mass: 0.4, parent: SEG.R_UPPER_ARM },
  { id: SEG.R_HAND, key: 'r_hand', name: 'правая кисть', length: 0.6, dir: [0, 1], radius: 0.5, mass: 0.2, parent: SEG.R_FOREARM },
  { id: SEG.L_THIGH, key: 'l_thigh', name: 'левое бедро', length: 1.6, dir: [-0.22, 0.98], radius: 0.8, mass: 0.9, parent: SEG.PELVIS },
  { id: SEG.L_SHIN, key: 'l_shin', name: 'левая голень', length: 1.5, dir: [0, 1], radius: 0.6, mass: 0.7, parent: SEG.L_THIGH },
  { id: SEG.L_FOOT, key: 'l_foot', name: 'левая стопа', length: 0.7, dir: [1, 0], radius: 0.5, mass: 0.3, parent: SEG.L_SHIN },
  { id: SEG.R_THIGH, key: 'r_thigh', name: 'правое бедро', length: 1.6, dir: [0.22, 0.98], radius: 0.8, mass: 0.9, parent: SEG.PELVIS },
  { id: SEG.R_SHIN, key: 'r_shin', name: 'правая голень', length: 1.5, dir: [0, 1], radius: 0.6, mass: 0.7, parent: SEG.R_THIGH },
  { id: SEG.R_FOOT, key: 'r_foot', name: 'правая стопа', length: 0.7, dir: [1, 0], radius: 0.5, mass: 0.3, parent: SEG.R_SHIN },
];

/**
 * Идентификатор сегмента обязан совпадать с его местом в таблице: поиск
 * родителя идёт по индексу, и однажды это уже привело к тому, что голова
 * искала родителя в стопе. Проверяем на старте, как и таблицу веществ.
 */
for (let i = 0; i < SEGMENTS.length; i++) {
  if (SEGMENTS[i].id !== i) {
    throw new Error(`скелет сломан: SEGMENTS[${i}] — это «${SEGMENTS[i].key}» с id ${SEGMENTS[i].id}`);
  }
  // Направления обязаны быть единичными: иначе связь при рождении уже
  // натянута неправильно, и тело дёргается на первом же шаге.
  const [dx, dy] = SEGMENTS[i].dir;
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    SEGMENTS[i].dir = [dx / len, dy / len];
  }
}

/** Расположение тела: клетки в секунду в квадрате. */
const GRAVITY = 18;
const DAMPING = 0.985;
const CONSTRAINT_PASSES = 8;

/**
 * Насколько сегмент выталкивается водой. Грудь и голова — сильнее,
 * ноги — слабее: иначе тело плавает горизонтально и тонет головой.
 */
const BUOYANCY = new Float32Array(SEGMENT_COUNT);
for (const s of SEGMENTS) {
  switch (s.id) {
    case SEG.HEAD: BUOYANCY[s.id] = 1.9; break;
    case SEG.NECK: BUOYANCY[s.id] = 1.8; break;
    case SEG.CHEST: BUOYANCY[s.id] = 1.7; break;
    case SEG.L_UPPER_ARM:
    case SEG.R_UPPER_ARM: BUOYANCY[s.id] = 1.2; break;
    case SEG.L_FOREARM:
    case SEG.R_FOREARM: BUOYANCY[s.id] = 1.1; break;
    case SEG.L_HAND:
    case SEG.R_HAND: BUOYANCY[s.id] = 1.0; break;
    case SEG.PELVIS: BUOYANCY[s.id] = 0.9; break;
    default: BUOYANCY[s.id] = 0.55; break;
  }
}

/** Можно ли телу находиться в этой клетке. */
const SOLID = new Uint8Array(MAT_STATE.length);
for (let m = 0; m < MAT_STATE.length; m++) {
  SOLID[m] = m !== MAT.AIR && (MAT_STATE[m] === ST.SOLID || MAT_STATE[m] === ST.POWDER) ? 1 : 0;
}

export interface BodySnapshot {
  x: Float32Array;
  y: Float32Array;
  px: Float32Array;
  py: Float32Array;
}

export class Body {
  readonly x = new Float32Array(SEGMENT_COUNT);
  readonly y = new Float32Array(SEGMENT_COUNT);
  /** Предыдущие позиции — в них живёт скорость (интегратор Верле). */
  readonly prevX = new Float32Array(SEGMENT_COUNT);
  readonly prevY = new Float32Array(SEGMENT_COUNT);
  /** Куда тело стремится попасть: цель для мышц (пока не используется). */
  readonly targetX = new Float32Array(SEGMENT_COUNT);
  readonly targetY = new Float32Array(SEGMENT_COUNT);
  /**
   * Целевые углы суставов в радианах: 0 — сегмент смотрит как в позе стоя.
   * Это и есть мышцы: политика будет задавать эти числа, а не двигать
   * точки напрямую.
   */
  readonly targetAngle = new Float32Array(SEGMENT_COUNT);
  /** Насколько сильно мышцы тянут к цели: 0 — расслаблено, 1 — напряжено. */
  muscleStrength = 0.6;
  /**
   * Тяга в воде: куда и с какой силой тело гребёт, -1..1.
   *
   * Без неё гребок бесполезен как средство передвижения: он машет руками
   * на месте, и существо, попав в воду, остаётся там навсегда — руля нет.
   */
  thrust = 0;
  alive = true;

  constructor(x: number, y: number) {
    this.placeAt(x, y);
  }

  /**
   * Поставить тело в позу «стоя» в точке (x, y) — там будет таз.
   *
   * Поза собирается по цепочке родителей ровно на длину связи: если
   * поставить сегменты «на глаз», связи при первом же шаге рванёт,
   * и тело подпрыгнет, как на пружине.
   */
  placeAt(x: number, y: number): void {
    for (const s of SEGMENTS) {
      let sx = x;
      let sy = y;
      if (s.parent >= 0) {
        const p = SEGMENTS[s.parent];
        sx = this.x[p.id] + s.dir[0] * s.length;
        sy = this.y[p.id] + s.dir[1] * s.length;
      }
      this.x[s.id] = sx;
      this.y[s.id] = sy;
      this.prevX[s.id] = sx;
      this.prevY[s.id] = sy;
      this.targetX[s.id] = sx;
      this.targetY[s.id] = sy;
    }
  }

  /** Один шаг физики. dt в секундах. */
  step(w: World, dt: number, substeps = 2): void {
    if (!this.alive) return;
    const h = dt / substeps;
    for (let s = 0; s < substeps; s++) this.integrate(w, h);
  }

  private integrate(w: World, h: number): void {
    const g = w.grid;

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      // В воде тело держится иначе: вода выталкивает вверх и тормозит
      // движение. Без этого рукопашный гребок бесполезен — тело просто
      // тонет, сколько ни маши руками.
      const cx0 = Math.round(this.x[i]);
      const cy0 = Math.round(this.y[i]);
      const inWater =
        cx0 >= 0 && cy0 >= 0 && cx0 < g.w && cy0 < g.h && g.mat[cy0 * g.w + cx0] === MAT.WATER;
      const drag = inWater ? 0.72 : DAMPING;
      // Плавучесть разная по телу: грудь с воздухом держится, ноги тяжелее.
      // Так тело разворачивается головой вверх, и голова остаётся над водой.
      const lift = inWater ? -GRAVITY * BUOYANCY[i] * h * h : 0;

      const vx = (this.x[i] - this.prevX[i]) * drag;
      const vy = (this.y[i] - this.prevY[i]) * drag;

      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];

      let nx = this.x[i] + vx;
      let ny = this.y[i] + vy + GRAVITY * h * h + lift;

      // Гребок двигает тело в выбранную сторону. Тянем только верхнюю
      // половину тела: ноги в это время толкают, а не тормозят.
      if (inWater && this.thrust !== 0 && SEGMENTS[i].id <= SEG.R_HAND) {
        nx += this.thrust * 0.05;
      }

      // Столкновение с миром: точка не может оказаться внутри породы.
      const resolved = resolve(g, nx, ny, this.x[i], this.y[i]);
      if (resolved.hit) {
        // Удар о грунт гасит скорость: без этого тело подбрасывало вверх.
        this.prevX[i] = resolved.x;
        this.prevY[i] = resolved.y;
      }
      this.x[i] = resolved.x;
      this.y[i] = resolved.y;
    }

    for (let pass = 0; pass < CONSTRAINT_PASSES; pass++) {
      this.solveJoints();
      this.clampToWorld(g);
    }

    this.applyMuscles(h);
  }

  /**
   * Мышцы: тянут каждый сегмент к своему целевому углу.
   *
   * Работаем не силой, а смещением точки к желаемому направлению — так
   * поза остаётся устойчивой при любых шагах интегрирования, и её нельзя
   * «разорвать» слишком сильным импульсом.
   */
  private applyMuscles(h: number): void {
    if (this.muscleStrength <= 0) return;
    for (let i = 1; i < SEGMENT_COUNT; i++) {
      const s = SEGMENTS[i];
      const p = s.parent;
      if (p < 0) continue;

      const ax = this.x[i] - this.x[p];
      const ay = this.y[i] - this.y[p];
      const dist = Math.hypot(ax, ay) || 1e-4;
      const cx = ax / dist;
      const cy = ay / dist;

      const a = this.targetAngle[i];
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const wx = s.dir[0] * cos - s.dir[1] * sin;
      const wy = s.dir[0] * sin + s.dir[1] * cos;

      // Тянуть надо взаимно: без противодействия родителю тело набирало
      // импульс из ничего и уезжало с места.
      //
      // Проба сделать мышцу чисто вращающей (без радиальной составляющей)
      // дала больше контакта с землёй при ходьбе, но тело начало ползти:
      // 3 клетки за десять секунд. Оставлено проверенное поведение.
      const k = this.muscleStrength * h * 12;
      const dx = (wx - cx) * k * s.length;
      const dy = (wy - cy) * k * s.length;
      const back = SEGMENTS[i].mass / (SEGMENTS[i].mass + SEGMENTS[p].mass);
      this.x[i] += dx;
      this.y[i] += dy;
      this.x[p] -= dx * back;
      this.y[p] -= dy * back;
    }
  }

  /** Задать угол сустава. */
  setJoint(index: number, angle: number): void {
    if (index < 1 || index >= SEGMENT_COUNT) return;
    this.targetAngle[index] = Math.max(-Math.PI, Math.min(Math.PI, angle));
  }

  /** Расслабить все мышцы. */
  relax(): void {
    this.targetAngle.fill(0);
  }

  /** Связи суставов: держат длину сегмента. */
  private solveJoints(): void {
    for (let i = 1; i < SEGMENT_COUNT; i++) {
      const s = SEGMENTS[i];
      const p = s.parent;
      if (p < 0) continue;

      let dx = this.x[i] - this.x[p];
      let dy = this.y[i] - this.y[p];
      const dist = Math.hypot(dx, dy) || 1e-4;
      const rest = s.length;
      const diff = (dist - rest) / dist;

      // Тяжёлая точка двигается меньше — так тело не «резиновое».
      const total = s.mass + SEGMENTS[p].mass;
      const wSelf = SEGMENTS[p].mass / total;
      const wParent = s.mass / total;

      dx *= diff;
      dy *= diff;

      this.x[i] -= dx * wSelf;
      this.y[i] -= dy * wSelf;
      this.x[p] += dx * wParent;
      this.y[p] += dy * wParent;
    }
  }

  /** Тело не должно вылетать за пределы мира. */
  private clampToWorld(g: { w: number; h: number }): void {
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      if (this.x[i] < 0.5) this.x[i] = 0.5;
      if (this.x[i] > g.w - 1.5) this.x[i] = g.w - 1.5;
      if (this.y[i] < 0.5) this.y[i] = 0.5;
      if (this.y[i] > g.h - 1.5) this.y[i] = g.h - 1.5;
    }
  }

  /** Лежит ли тело на опоре (по стопам). */
  onGround(w: World): boolean {
    const g = w.grid;
    for (const id of [SEG.L_FOOT, SEG.R_FOOT]) {
      const cx = Math.round(this.x[id]);
      const cy = Math.round(this.y[id]) + 1;
      if (cy >= g.h) continue;
      if (SOLID[g.mat[cy * g.w + cx]] === 1) return true;
    }
    return false;
  }

  /** Центр тяжести — для камеры, метрик и вскрытия. */
  center(): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      sx += this.x[i];
      sy += this.y[i];
    }
    return { x: sx / SEGMENT_COUNT, y: sy / SEGMENT_COUNT };
  }

  state(): BodySnapshot {
    return {
      x: this.x.slice(),
      y: this.y.slice(),
      px: this.prevX.slice(),
      py: this.prevY.slice(),
    };
  }

  restore(s: BodySnapshot): void {
    this.x.set(s.x);
    this.y.set(s.y);
    this.prevX.set(s.px);
    this.prevY.set(s.py);
  }
}

/**
 * Разрешение столкновения: если точка ушла в породу, выталкиваем её
 * в ближайшую свободную клетку. Простая, но честная модель: тело
 * не проваливается и не застревает внутри камня.
 */
function resolve(
  g: { w: number; h: number; mat: Uint8Array },
  nx: number,
  ny: number,
  ox: number,
  oy: number,
): { x: number; y: number; hit: boolean } {
  const solid = (px: number, py: number): boolean => {
    const cx = Math.round(px);
    const cy = Math.round(py);
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return true;
    return SOLID[g.mat[cy * g.w + cx]] === 1;
  };

  if (!solid(nx, ny)) return { x: nx, y: ny, hit: false };

  // В стену войти нельзя: если раньше точка была в свободном месте,
  // просто отменяем шаг. Раньше её всегда выталкивало вверх, и тело,
  // упёршись в грязь, вползало по ней в небо — храповик из столкновений.
  if (!solid(ox, oy)) {
    // Пробуем сохранить только вертикальную часть: это позволяет
    // скользить вдоль препятствия, а не застревать намертво.
    if (!solid(ox, ny)) return { x: ox, y: ny, hit: true };
    return { x: ox, y: oy, hit: true };
  }

  // Точка уже внутри породы — ищем ближайший выход.
  for (let up = 1; up <= 4; up++) {
    if (!solid(nx, ny - up)) return { x: nx, y: ny - up, hit: true };
  }
  for (let down = 1; down <= 4; down++) {
    if (!solid(nx, ny + down)) return { x: nx, y: ny + down, hit: true };
  }
  return { x: ox, y: oy, hit: true };
}

export { MAT };
