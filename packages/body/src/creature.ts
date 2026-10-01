/**
 * Существо: тело, физиология и смерть в одном.
 *
 * Здесь сходятся два предыдущих шага — скелет и органы. Существо получает
 * повреждения от того, что вокруг него в мире: огонь жжёт, вода топит,
 * мороз и жар калечат, падение ломает.
 *
 * Функции возрождения здесь НЕТ и не будет. Это не стилистическое решение,
 * а инвариант И7: воскрешение — единственная сила наблюдателя, и она живёт
 * в сервере, за пределами мира. Тест проверяет, что из симуляции к ней
 * нет пути.
 */
import { MAT } from '../../world/src/materials.ts';
import type { World } from '../../world/src/world.ts';
import { Body, SEG, SEGMENTS } from './body.ts';
import { Physiology, REGION, type DamageKind } from './physiology.ts';
import type { PhysiologyContext } from './physiology.ts';

/** Сколько урона за тик даёт та или иная напасть. */
const FIRE_DAMAGE = 6;
const HEAT_DAMAGE = 1.2;
const COLD_DAMAGE = 0.8;
const DROWN_RATE = 1;

export interface AutopsyLine {
  tick: number;
  text: string;
}

export interface Autopsy {
  /** Причина смерти словами. */
  cause: string;
  /** Цепочка: что именно привело к смерти. */
  chain: string[];
  /** Сколько существо прожило, в тиках. */
  ageTicks: number;
  /** Поколение: сколько раз жизнь начиналась заново. */
  generation: number;
  /** Все раны, какие были. */
  wounds: Array<{ region: string; severity: number; infection: number }>;
  /** Пределы, до которых доходило тело. */
  extremes: Physiology['extremes'];
  /** Последние мгновения: хронология. */
  timeline: AutopsyLine[];
}

export class Creature {
  body: Body;
  physiology: Physiology;
  /** Номер жизни. Существо об этом не знает — это знает только наблюдатель. */
  generation: number;
  /** Тик рождения. */
  bornTick: number;
  /** Тик смерти, -1 пока живо. */
  deathTick = -1;
  /** Что с ним случилось за жизнь — для вскрытия. */
  readonly timeline: AutopsyLine[] = [];
  /** Насколько существо уже привыкло к среде: закалка от повторов. */
  acclimatization = 0;
  /**
   * Веса рефлекторного мозга. Сюда их кладёт сервер перед сохранением:
   * мозг принадлежит существу, и он обязан переживать сон вместе с телом.
   * Иначе каждый перезапуск стирал бы всё, чему оно научилось.
   */
  brain: Uint8Array | null = null;
  /** Прямо сейчас пьёт: подносит воду ко рту. */
  drinking = false;
  /** Прямо сейчас ест. */
  eating = false;

  constructor(x: number, y: number, generation = 1, bornTick = 0) {
    this.body = new Body(x, y);
    this.physiology = new Physiology();
    this.generation = generation;
    this.bornTick = bornTick;
  }

  get alive(): boolean {
    return this.physiology.alive;
  }

  /** Один шаг существа: среда, физика, физиология. */
  step(w: World, dt: number, activity: number): void {
    if (!this.alive) return;

    const ctx = this.sense(w, activity);
    this.body.step(w, dt);
    this.physiology.step(dt, ctx);

    if (!this.physiology.alive) {
      this.die(w);
    }
  }

  /**
   * Что делает с телом окружающий мир.
   * Возвращает контекст для физиологии и попутно наносит повреждения.
   */
  private sense(w: World, activity: number): PhysiologyContext {
    const g = w.grid;
    let ambient = 0;
    let sampled = 0;
    let submerged = false;
    let hottest = -999;
    let coldest = 999;

    for (let i = 0; i < SEGMENTS.length; i++) {
      const cx = Math.round(this.body.x[i]);
      const cy = Math.round(this.body.y[i]);
      if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) continue;
      const j = cy * g.w + cx;
      const m = g.mat[j];
      const t = g.temp[j];
      const a = w.ambient[j];

      // Температура среды для тела — это температура клеток вокруг него,
      // а не климат местности: иначе огонь не грел бы, а жара не убивала.
      ambient += t;
      sampled++;
      if (t > hottest) hottest = t;
      if (t < coldest) coldest = t;

      // Голова под водой — это удушье, а не «немного мокро».
      if (i === SEG.HEAD && m === MAT.WATER) submerged = true;

      const region = regionOf(i, cx, this.body.x[SEG.PELVIS]);

      if (m === MAT.FIRE) {
        this.hurt(region, FIRE_DAMAGE * 0.016, 'burn');
      } else if (m === MAT.LAVA) {
        this.hurt(region, FIRE_DAMAGE * 0.05, 'burn');
      }
      if (t > a + 120) this.hurt(region, HEAT_DAMAGE * 0.016, 'burn');
      if (t < a - 45) this.hurt(region, COLD_DAMAGE * 0.016, 'cold');
    }

    // Кислород в воде расходуется быстро, поэтому урон от удушья идёт
    // через физиологию (submerged), а не напрямую.
    void DROWN_RATE;
    void hottest;
    void coldest;
    if (sampled > 0) ambient /= sampled;
    else ambient = w.cfg.ambient;

    return {
      ambient,
      submerged,
      activity,
      eating: this.eating,
      drinking: this.drinking,
      insulation: this.acclimatization * 0.3,
    };
  }

  /** Нанести урон с записью в летопись жизни. */
  hurt(region: number, amount: number, kind: DamageKind): void {
    const before = this.physiology.totalDamage;
    this.physiology.applyDamage(region, amount, kind);
    if (this.physiology.totalDamage > before && this.timeline.length < 400) {
      const text =
        kind === 'burn'
          ? `ожог: ${regionName(region)}`
          : kind === 'cold'
            ? `обморожение: ${regionName(region)}`
            : kind === 'cut'
              ? `порез: ${regionName(region)}`
              : kind === 'bite'
                ? `укус: ${regionName(region)}`
                : `удар: ${regionName(region)}`;
      this.timeline.push({ tick: -1, text });
    }
  }

  /**
   * Походка: попеременный шаг двумя ногами.
   *
   * Это ещё не обученная политика, а отладочный привод: он нужен, чтобы
   * убедиться, что мышцы и суставы действительно слушаются, и чтобы
   * было чем проверять тело до появления мозга.
   */
  /**
   * Определить, как тело должно двигаться в этой точке мира.
   *
   * Без этого существо бессильно: обмякшее тело сползает по склону в воду,
   * и выбраться из неё походкой по ровному месту невозможно.
   */
  locomotionMode(w: World): 'walk' | 'climb' | 'swim' | 'turn' {
    const g = w.grid;
    const cx = Math.round(this.body.x[SEG.PELVIS]);
    const cy = Math.round(this.body.y[SEG.PELVIS]);
    if (cx < 1 || cy < 0 || cx >= g.w - 1 || cy >= g.h) return 'walk';

    // В воде — гребём. Но если рядом берег, который выше воды, надо
    // не плыть, а выбираться: гребок не поднимает на сушу.
    const chest = Math.round(this.body.y[SEG.CHEST]);
    const inWater = g.mat[cy * g.w + cx] === MAT.WATER || g.mat[chest * g.w + cx] === MAT.WATER;
    if (inWater) {
      const dir0 = this.walkDirection;
      for (let k = 1; k <= 3; k++) {
        const x = cx + dir0 * k;
        if (x < 1 || x >= g.w - 1) break;
        const level = groundLevel(g, x);
        // Берег рядом и не выше двух клеток над водой — вылезаем.
        if (level >= 0 && level <= chest + 2 && level >= cy - 2) return 'climb';
      }
      return 'swim';
    }

    // Смотрим, что впереди по ходу движения: если земля выше на клетку
    // или две, это подъём, и шагать надо шире.
    const dir = this.walkDirection;
    const here = groundLevel(g, cx);
    for (let k = 1; k <= 3; k++) {
      const x = cx + dir * k;
      if (x < 1 || x >= g.w - 1) break;
      const there = groundLevel(g, x);
      if (there < 0 || here < 0) continue;

      // Уступ: земля впереди ниже на одну-три клетки. Это спуск, а не
      // пропасть — шагаем, физика сама опустит тело.
      if (there - here >= 4) {
        // Но если впереди вода, это не пропасть, а берег. В воду входить
        // можно: тело держится на плаву, а гребок умеет грести. Раньше
        // берег считался обрывом, существо разворачивалось и металась
        // у кромки, не входя в воду и не уходя к еде.
        if (waterBelow(g, x, there)) return 'walk';
        return 'turn';
      }
      if (there - here >= 1) return 'walk';

      if (here - there >= 1) return 'climb';
    }

    return 'walk';
  }

  /** Куда тело идёт: ±1. Задаётся снаружи, чтобы походка знала направление. */
  walkDirection = 1;
  /** Задержка перед следующим разворотом: чтобы не дёргаться туда-сюда. */
  private turnCooldown = 0;

  /**
   * Моторные примитивы. Один и тот же скелет, три разных движения:
   * шаг по ровному, подъём в гору и гребок в воде.
   */
  walk(phase: number, w?: World): void {
    const mode = w ? this.locomotionMode(w) : 'walk';
    // На суше тяга не нужна: там двигают ноги.
    this.body.thrust = 0;

    // Перед пропастью разворачиваемся и идём в обход. Раньше существо
    // просто замирало и стояло до смерти: защита от падения превратилась
    // в запрет двигаться, и оно не могло дойти до воды.
    if (mode === 'turn') {
      if (this.turnCooldown <= 0) {
        this.walkDirection = -this.walkDirection;
        this.turnCooldown = 90;
      }
      this.body.setJoint(SEG.CHEST, -0.1);
      return;
    }
    if (this.turnCooldown > 0) this.turnCooldown--;

    if (mode === 'swim') {
      this.swim(phase);
      return;
    }

    const cycle = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const rightSwing = cycle < Math.PI;
    const lift = mode === 'climb' ? 1.1 : 0.7;

    const swingAngle = Math.sin(cycle) * (mode === 'climb' ? 0.75 : 0.5);
    const liftAngle = Math.max(0, Math.sin(cycle)) * lift;

    if (rightSwing) {
      this.body.setJoint(SEG.L_THIGH, 0);
      this.body.setJoint(SEG.L_SHIN, 0);
      this.body.setJoint(SEG.R_THIGH, swingAngle);
      this.body.setJoint(SEG.R_SHIN, -liftAngle);
    } else {
      this.body.setJoint(SEG.R_THIGH, 0);
      this.body.setJoint(SEG.R_SHIN, 0);
      this.body.setJoint(SEG.L_THIGH, -swingAngle);
      this.body.setJoint(SEG.L_SHIN, -liftAngle);
    }

    this.body.setJoint(SEG.L_UPPER_ARM, -swingAngle * 0.4);
    this.body.setJoint(SEG.R_UPPER_ARM, swingAngle * 0.4);
    // На подъёме корпус наклоняется сильнее — иначе не залезть.
    this.body.setJoint(SEG.CHEST, mode === 'climb' ? -0.35 : -0.1);
  }

  /** Гребок: руки разводятся и сводятся, ноги толкают. */
  private swim(phase: number): void {
    const c = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const stroke = Math.sin(c);
    const kick = Math.sin(c * 2);

    // Руль: гребём в ту сторону, куда идём.
    this.body.thrust = this.walkDirection * 0.7;

    this.body.setJoint(SEG.L_UPPER_ARM, -0.9 - stroke * 0.5);
    this.body.setJoint(SEG.R_UPPER_ARM, 0.9 + stroke * 0.5);
    this.body.setJoint(SEG.L_FOREARM, -0.4);
    this.body.setJoint(SEG.R_FOREARM, 0.4);
    this.body.setJoint(SEG.L_THIGH, kick * 0.3);
    this.body.setJoint(SEG.R_THIGH, -kick * 0.3);
    // Тело вытягивается вдоль воды.
    this.body.setJoint(SEG.CHEST, -0.25);
  }

  /** Стоять смирно: все мышцы в покое. */
  stand(): void {
    this.body.relax();
  }

  /** Есть ли у существа силы действовать. */
  get canAct(): boolean {
    return this.alive && this.physiology.conscious;
  }

  private die(w: World): void {
    this.deathTick = w.tick;
    this.body.alive = false;
    this.timeline.push({ tick: w.tick, text: `смерть: ${this.physiology.explainDeath()}` });
  }

  /**
   * Вскрытие: то, что видит наблюдатель и не видит само существо.
   * Собирается из физиологии, ран и хронологии.
   */
  autopsy(): Autopsy {
    const p = this.physiology;
    const chain: string[] = [];

    if (p.bloodLost > 0.3) chain.push(`потеряно крови: ${p.bloodLost.toFixed(2)} л`);
    if (p.extremes.minOxygen < 70) chain.push(`кислород падал до ${p.extremes.minOxygen.toFixed(0)}%`);
    if (p.extremes.minTemp < 34) chain.push(`тело остывало до ${p.extremes.minTemp.toFixed(1)}°`);
    if (p.extremes.maxTemp > 39.5) chain.push(`тело нагревалось до ${p.extremes.maxTemp.toFixed(1)}°`);
    if (p.unconsciousTime > 0) chain.push(`без сознания: ${(p.unconsciousTime / 60).toFixed(1)} мин`);
    if (p.extremes.maxPain > 0.5) chain.push(`сильнейшая боль: ${(p.extremes.maxPain * 100).toFixed(0)}%`);
    const infections = p.wounds.filter((x) => x.infection > 0.4).length;
    if (infections > 0) chain.push(`заражённых ран: ${infections}`);
    if (p.totalDamage > 0) chain.push(`всего повреждений: ${p.totalDamage.toFixed(0)}`);

    return {
      cause: p.alive ? 'жив' : (p.deathCause ?? 'неизвестно'),
      chain,
      ageTicks: (this.deathTick >= 0 ? this.deathTick : 0) - this.bornTick,
      generation: this.generation,
      wounds: p.wounds.map((x) => ({
        region: regionName(x.region),
        severity: x.severity,
        infection: x.infection,
      })),
      extremes: p.extremes,
      timeline: this.timeline.slice(-40),
    };
  }

  /**
   * Состояние для снапшота.
   *
   * Без этого перезапуск сервера означал бы новую жизнь: тело рождалось бы
   * заново, а всё пережитое исчезало. Существо — часть мира, и оно обязано
   * переживать сон так же, как сам мир.
   */
  toBytes(): Uint8Array {
    const data = {
      generation: this.generation,
      bornTick: this.bornTick,
      deathTick: this.deathTick,
      acclimatization: this.acclimatization,
      x: Array.from(this.body.x),
      y: Array.from(this.body.y),
      px: Array.from(this.body.prevX),
      py: Array.from(this.body.prevY),
      alive: this.physiology.alive,
      ph: {
        blood: this.physiology.blood,
        oxygen: this.physiology.oxygen,
        glucose: this.physiology.glucose,
        glycogen: this.physiology.glycogen,
        hydration: this.physiology.hydration,
        coreTemp: this.physiology.coreTemp,
        heartRate: this.physiology.heartRate,
        adrenaline: this.physiology.adrenaline,
        fear: this.physiology.fear,
        conscious: this.physiology.conscious,
        starving: this.physiology.starving,
        deathCause: this.physiology.deathCause,
        unconsciousTime: this.physiology.unconsciousTime,
        totalDamage: this.physiology.totalDamage,
        pains: Array.from(this.physiology.pain),
        extremes: this.physiology.extremes,
        wounds: this.physiology.wounds,
      },
      timeline: this.timeline.slice(-60),
      brain: this.brain === null ? null : Array.from(this.brain),
    };
    return new TextEncoder().encode(JSON.stringify(data));
  }

  static fromBytes(bytes: Uint8Array): Creature {
    const d = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, never>;
    const c = new Creature(0, 0, d.generation as number, d.bornTick as number);
    c.body.x.set(d.x as unknown as number[]);
    c.body.y.set(d.y as unknown as number[]);
    c.body.prevX.set(d.px as unknown as number[]);
    c.body.prevY.set(d.py as unknown as number[]);
    c.deathTick = d.deathTick as number;
    c.acclimatization = d.acclimatization as number;

    const ph = d.ph as unknown as Record<string, never>;
    const p = c.physiology;
    p.blood = ph.blood as number;
    p.oxygen = ph.oxygen as number;
    p.glucose = ph.glucose as number;
    p.glycogen = ph.glycogen as number;
    p.hydration = ph.hydration as number;
    p.coreTemp = ph.coreTemp as number;
    p.heartRate = ph.heartRate as number;
    p.adrenaline = ph.adrenaline as number;
    p.fear = ph.fear as number;
    p.conscious = ph.conscious as boolean;
    p.starving = ph.starving as boolean;
    p.deathCause = ph.deathCause as string | null;
    p.unconsciousTime = ph.unconsciousTime as number;
    p.totalDamage = ph.totalDamage as number;
    p.pain.set(ph.pains as unknown as number[]);
    Object.assign(p.extremes, ph.extremes);
    p.wounds.length = 0;
    for (const wnd of ph.wounds as unknown as Array<Record<string, number>>) {
      p.wounds.push({
        region: wnd.region,
        severity: wnd.severity,
        bleeding: wnd.bleeding,
        infection: wnd.infection,
        age: wnd.age,
      });
    }
    p.alive = d.alive as boolean;
    c.timeline.length = 0;
    for (const line of d.timeline as unknown as AutopsyLine[]) c.timeline.push(line);
    c.body.alive = p.alive;
    const brain = d.brain as unknown as number[] | null;
    c.brain = brain === null || brain === undefined ? null : Uint8Array.from(brain);
    return c;
  }

  /** Компактное состояние для кадра наблюдателя. */
  frameState(): { x: number; y: number; alive: boolean; hp: number } {
    const c = this.body.center();
    return {
      x: c.x,
      y: c.y,
      alive: this.alive,
      hp: Math.max(0, Math.min(1, this.physiology.blood / 5)),
    };
  }
}

/** Какая часть тела находится в этой точке скелета. */
function regionOf(segment: number, x: number, pelvisX: number): number {
  switch (segment) {
    case SEG.HEAD:
    case SEG.NECK:
      return REGION.HEAD;
    case SEG.CHEST:
    case SEG.PELVIS:
      return REGION.TORSO;
    case SEG.L_UPPER_ARM:
    case SEG.L_FOREARM:
    case SEG.L_HAND:
      return REGION.L_ARM;
    case SEG.R_UPPER_ARM:
    case SEG.R_FOREARM:
    case SEG.R_HAND:
      return REGION.R_ARM;
    case SEG.L_THIGH:
    case SEG.L_SHIN:
    case SEG.L_FOOT:
      return x < pelvisX ? REGION.L_LEG : REGION.L_LEG;
    default:
      return REGION.R_LEG;
  }
}

function regionName(region: number): string {
  return ['голова', 'корпус', 'левая рука', 'правая рука', 'левая нога', 'правая нога'][region] ?? 'тело';
}

/** Есть ли вода в столбце ниже указанного уровня. */
function waterBelow(g: { w: number; h: number; mat: Uint8Array }, x: number, fromY: number): boolean {
  for (let y = Math.max(0, fromY); y < Math.min(g.h, fromY + 6); y++) {
    if (g.mat[y * g.w + x] === MAT.WATER) return true;
  }
  return false;
}

/** Уровень земли в столбце: первая твёрдая клетка сверху, или -1. */
function groundLevel(g: { w: number; h: number; mat: Uint8Array }, x: number): number {
  for (let y = 0; y < g.h; y++) {
    const m = g.mat[y * g.w + x];
    if (m !== MAT.AIR && m !== MAT.WATER) return y;
  }
  return -1;
}
