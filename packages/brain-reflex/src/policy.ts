/**
 * Рефлекторный контур: то, что управляет телом каждую секунду.
 *
 * Два слоя. Первый — врождённые рефлексы: отдёрнуть обожжённую конечность,
 * напрячься при падении, замереть от боли. Они работают всегда, их не надо
 * учить, и без них существо не выжило бы и минуты. Второй — крошечная сеть,
 * которая складывает рефлексы с тем, что видно и чувствуется, и выдаёт
 * целевые углы суставов. Её и будет учить Ф2.
 *
 * Языковая модель сюда не заглядывает никогда: 60 Гц и вызов LLM
 * несовместимы (инвариант И3).
 */
import { SEG, SEGMENT_COUNT } from '../../body/src/body.ts';
import type { Body } from '../../body/src/body.ts';
import { SENSE, SENSE_COUNT, readSensors } from '../../body/src/sensors.ts';
import type { Creature } from '../../body/src/creature.ts';
import { REGION } from '../../body/src/physiology.ts';
import { MAT } from '../../world/src/materials.ts';
import type { World } from '../../world/src/world.ts';

/** Размер скрытого слоя: сеть должна оставаться крошечной. */
export const HIDDEN = 24;

/** Сколько чисел на входе и выходе. */
export const INPUTS = SENSE_COUNT;
export const OUTPUTS = SEGMENT_COUNT;

export interface PolicyWeights {
  /** Веса входа в скрытый слой: HIDDEN × INPUTS. */
  w1: Float32Array;
  b1: Float32Array;
  /** Веса скрытого слоя в суставы: OUTPUTS × HIDDEN. */
  w2: Float32Array;
  b2: Float32Array;
}

/** Случайная сеть: с неё начинается обучение. */
export function randomWeights(seed = 1): PolicyWeights {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
  const w1 = new Float32Array(HIDDEN * INPUTS);
  const b1 = new Float32Array(HIDDEN);
  const w2 = new Float32Array(OUTPUTS * HIDDEN);
  const b2 = new Float32Array(OUTPUTS);
  for (let i = 0; i < w1.length; i++) w1[i] = next() * 0.3;
  for (let i = 0; i < w2.length; i++) w2[i] = next() * 0.3;
  return { w1, b1, w2, b2 };
}

export class ReflexPolicy {
  readonly sensors = new Float32Array(INPUTS);
  readonly hidden = new Float32Array(HIDDEN);
  readonly outputs = new Float32Array(OUTPUTS);
  weights: PolicyWeights;
  /** Сколько шагов политика отработала: для наблюдателя и для обучения. */
  steps = 0;
  /** Последнее сработавшее врождённое решение — попадает в летопись мыслей. */
  lastReflex = '';
  /**
   * Сколько власти у сети против рефлексов: 0 — всем правит врождённая
   * походка, 1 — сеть задаёт позу сама, а рефлексы только вмешиваются
   * в беде.
   *
   * Это ключевая ручка всего обучения. Пока сеть не имела власти, её веса
   * менялись, но поведение определяла походка — учиться было не на чем,
   * и награда только падала.
   */
  networkAuthority = 0.35;
  /** Рефлексы, которые обязаны работать всегда, независимо от власти сети. */
  emergencyOnly = false;

  constructor(weights: PolicyWeights = randomWeights()) {
    this.weights = weights;
  }

  /** Один шаг: почувствовать, сложить рефлексы, задать мышцы. */
  act(w: World, c: Creature, phase = 0): void {
    if (!c.canAct) return;
    readSensors(w, c, this.sensors);
    this.forward();
    this.applyReflexes(c, phase);
    this.steps++;
  }

  /** Прямой проход крошечной сети. */
  private forward(): void {
    const { w1, b1, w2, b2 } = this.weights;
    const inp = this.sensors;

    for (let h = 0; h < HIDDEN; h++) {
      let sum = b1[h];
      const base = h * INPUTS;
      for (let i = 0; i < INPUTS; i++) sum += w1[base + i] * inp[i];
      // tanh: выход в -1..1, как и целевые углы.
      this.hidden[h] = Math.tanh(sum);
    }

    for (let o = 0; o < OUTPUTS; o++) {
      let sum = b2[o];
      const base = o * HIDDEN;
      for (let h = 0; h < HIDDEN; h++) sum += w2[base + h] * this.hidden[h];
      this.outputs[o] = Math.tanh(sum);
    }
  }

  /**
   * Врождённые рефлексы. Они складываются с выходом сети, а не заменяют
   * его: сеть может научиться их перевешивать, но не может их отключить.
   */
  private applyReflexes(c: Creature, phase: number): void {
    const body = c.body;
    const p = c.physiology;
    const s = this.sensors;
    let reflex = '';

    // 1. Отдёргивание: обожжённая или порезанная конечность поджимается.
    const painL = p.pain[REGION.L_ARM] + p.pain[REGION.L_LEG];
    const painR = p.pain[REGION.R_ARM] + p.pain[REGION.R_LEG];
    if (painL > 0.15) {
      this.outputs[SEG.L_UPPER_ARM] -= painL * 1.2;
      this.outputs[SEG.L_THIGH] -= painL * 0.8;
      reflex = 'поджимаю левую';
    }
    if (painR > 0.15) {
      this.outputs[SEG.R_UPPER_ARM] -= painR * 1.2;
      this.outputs[SEG.R_THIGH] -= painR * 0.8;
      reflex = 'поджимаю правую';
    }

    // 2. Потеря опоры: тело напрягается и ищет землю ногами.
    const feet = s[SENSE.CONTACT + 0] + s[SENSE.CONTACT + 1];
    if (feet < 1) {
      this.outputs[SEG.L_THIGH] += 0.5;
      this.outputs[SEG.R_THIGH] -= 0.5;
      this.outputs[SEG.CHEST] += 0.2;
      if (!reflex) reflex = 'ищу опору';
    }

    // 3. Удушье: тянемся вверх, к воздуху. Врождённый рефлекс читает
    //    тело напрямую, а не через датчики: он не должен зависеть от того,
    //    правильно ли собрана картина мира.
    if (p.oxygen < 75) {
      this.outputs[SEG.CHEST] -= 0.8;
      this.outputs[SEG.L_UPPER_ARM] -= 1.0;
      this.outputs[SEG.R_UPPER_ARM] -= 1.0;
      reflex = 'тянусь к воздуху';
    }
    void s;

    // 4. Походка: пока политика не научилась ходить сама, ноги двигаются
    //    попеременно, если есть опора и силы. Как только сеть набирает
    //    власть, походка уступает ей место — иначе учиться не на чем.
    const gaitWeight = this.emergencyOnly ? 0 : 1 - this.networkAuthority;
    if (feet >= 1 && p.fatigue < 0.9 && p.painLevel < 0.6 && gaitWeight > 0.01) {
      const swing = Math.sin(phase) * 0.45 * gaitWeight;
      this.outputs[SEG.L_THIGH] += swing;
      this.outputs[SEG.R_THIGH] -= swing;
      this.outputs[SEG.L_SHIN] += Math.max(0, -swing) * 0.6;
      this.outputs[SEG.R_SHIN] += Math.max(0, swing) * 0.6;
      if (!reflex) reflex = 'иду';
    }

    // 5. Страх: прижимается к земле.
    if (p.fear > 0.5) {
      this.outputs[SEG.CHEST] += 0.4;
      if (!reflex) reflex = 'пригибаюсь';
    }

    // Применяем: угол каждого сустава — это выход сети плюс рефлексы.
    for (let i = 1; i < SEGMENT_COUNT; i++) {
      body.setJoint(i, clampAngle(this.outputs[i]));
    }
    this.lastReflex = reflex;
  }

  /**
   * Жизненные действия: куда идти и что делать прямо сейчас.
   *
   * Это не обучение, а врождённое знание, без которого существо умирает
   * от жажды за пятнадцать минут, сколько его ни учи. Врождённые рефлексы
   * имеют право читать мир напрямую — как и рефлекс удушья.
   */
  survival(w: World, c: Creature): { dir: number; drinking: boolean; eating: boolean } {
    const g = w.grid;
    const p = c.physiology;
    const body = c.body;
    const cx = Math.round(body.x[SEG.PELVIS]);
    const cy = Math.round(body.y[SEG.PELVIS]);

    // 0. Опасность важнее всего: лава и огонь убивают быстро, и никакая
    //    еда этого не стоит. Уходим от ближайшего очага.
    const danger = this.nearestDanger(g, cx, cy, 10);
    if (danger !== null) {
      return { dir: danger, drinking: false, eating: false };
    }

    // Пить хочется сильнее, чем есть: без воды смерть быстрее.
    const wantsDrink = p.thirst > 0.12;
    const wantsEat = p.hunger > 0.35;
    // Если очень голоден, а жажда терпима — сначала еда. Иначе существо
    // остаётся у воды навсегда: пьёт, напиться не может и умирает
    // голодным в двух шагах от травы.
    const hungerFirst = p.hunger > 0.7 && p.thirst < 0.6;

    if (!wantsDrink && !wantsEat) return { dir: 0, drinking: false, eating: false };

    const food: number[] = [MAT.GRASS, MAT.LEAVES, MAT.BUSH, MAT.FRUIT, MAT.MUSHROOM, MAT.MEAT];
    const feet = [SEG.L_FOOT, SEG.R_FOOT, SEG.PELVIS];

    // 1. Ближняя зона: своя клетка и то, что прямо под ногами. Еда лежит
    //    на земле, а не на уровне таза, и расстояние от таза её не находит.
    for (const id of feet) {
      const fx = Math.round(body.x[id]);
      const fy = Math.round(body.y[id]);
      for (let dy = -1; dy <= 2; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = fx + dx;
          const y = fy + dy;
          if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
          const m = g.mat[y * g.w + x];
          if (wantsDrink && !hungerFirst && m === MAT.WATER) {
            return { dir: 0, drinking: true, eating: false };
          }
          // Есть можно и когда хочется пить: трава под ногами никуда не
          // денется, а голод убивает быстрее жажды. Раньше при жажде выше
          // 12% существо переставало замечать еду вовсе — и уходило
          // искать воду, которой рядом не было, пока не умирало голодным
          // на лугу, стоя на траве.
          if (wantsEat && food.includes(m)) {
            return { dir: 0, drinking: false, eating: true };
          }
        }
      }
    }

    // 2. Дальняя зона: куда идти за водой или едой.
    let bestDist = Infinity;
    let bestDir = 0;
    const radius = 26;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -4; dy <= 8; dy++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
        const m = g.mat[y * g.w + x];
        const hit = wantsDrink && !hungerFirst ? m === MAT.WATER : food.includes(m);
        if (!hit) continue;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist < bestDist) {
          bestDist = dist;
          bestDir = dx === 0 ? 0 : dx > 0 ? 1 : -1;
        }
      }
    }

    const dir = bestDir !== 0 ? bestDir : this.lastSearchDir;
    if (bestDir !== 0) this.lastSearchDir = bestDir;

    return { dir, drinking: false, eating: false };
  }

  /** Куда шло в прошлый раз: чтобы не метаться, когда еды не видно. */
  private lastSearchDir = 1;

  /**
   * Ближайшая смертельная опасность: лава или огонь.
   * Возвращает направление, в котором от неё уходить, или null.
   */
  private nearestDanger(g: World['grid'], cx: number, cy: number, radius: number): number | null {
    let bestDist = Infinity;
    let bestDx = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -6; dy <= 6; dy++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
        const m = g.mat[y * g.w + x];
        if (m !== MAT.LAVA && m !== MAT.FIRE) continue;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist < bestDist) {
          bestDist = dist;
          bestDx = dx;
        }
      }
    }
    if (bestDist > radius) return null;
    // Уходим в сторону, противоположную опасности.
    if (bestDx === 0) return this.lastSearchDir;
    return bestDx > 0 ? -1 : 1;
  }

  /** Размер сети в параметрах — для отчёта и снапшота. */
  static parameterCount(): number {
    return HIDDEN * INPUTS + HIDDEN + OUTPUTS * HIDDEN + OUTPUTS;
  }

  toBytes(): Uint8Array {
    const w = this.weights;
    const out = new Float32Array(w.w1.length + w.b1.length + w.w2.length + w.b2.length);
    let o = 0;
    out.set(w.w1, o);
    o += w.w1.length;
    out.set(w.b1, o);
    o += w.b1.length;
    out.set(w.w2, o);
    o += w.w2.length;
    out.set(w.b2, o);
    return new Uint8Array(out.buffer.slice(0));
  }

  static fromBytes(bytes: Uint8Array): ReflexPolicy {
    const all = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    let o = 0;
    const w1 = all.slice(o, o + HIDDEN * INPUTS);
    o += HIDDEN * INPUTS;
    const b1 = all.slice(o, o + HIDDEN);
    o += HIDDEN;
    const w2 = all.slice(o, o + OUTPUTS * HIDDEN);
    o += OUTPUTS * HIDDEN;
    const b2 = all.slice(o, o + OUTPUTS);
    return new ReflexPolicy({ w1, b1, w2, b2 });
  }
}

function clampAngle(a: number): number {
  const max = 1.6;
  return a < -max ? -max : a > max ? max : a;
}

export { SEG, SEGMENT_COUNT, REGION };
export type { Body };
