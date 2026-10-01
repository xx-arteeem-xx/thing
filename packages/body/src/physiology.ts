/**
 * Физиология тела.
 *
 * Это чистое состояние без физики: кровь, кислород, глюкоза, вода, тепло,
 * раны, боль и страх. Из него берутся все причины смерти, и оно же будет
 * главным источником драйвов для рефлекторного мозга в Ф2 — голод, жажда,
 * усталость и боль станут мотивацией политики.
 *
 * Модель намеренно грубая: несколько десятков переменных и простые правила.
 * Задача не в биологической точности, а в том, чтобы у существа были
 * понятные, различимые и по-разному опасные способы умереть.
 */

/** Части тела, по которым считается боль и раны. */
export const REGION = {
  HEAD: 0,
  TORSO: 1,
  L_ARM: 2,
  R_ARM: 3,
  L_LEG: 4,
  R_LEG: 5,
} as const;

export const REGION_COUNT = 6;
export const REGION_NAME = ['голова', 'корпус', 'левая рука', 'правая рука', 'левая нога', 'правая нога'];

/** Виды повреждений. */
export type DamageKind = 'blunt' | 'cut' | 'burn' | 'cold' | 'acid' | 'bite';

export interface Wound {
  region: number;
  /** Тяжесть 0..1: сколько тканей потеряно. */
  severity: number;
  /** Кровотечение в литрах в секунду. */
  bleeding: number;
  /** Заряжена ли инфекция 0..1. */
  infection: number;
  age: number;
}

export interface PhysiologyContext {
  /** Температура среды вокруг тела. */
  ambient: number;
  /** Голова под водой. */
  submerged: boolean;
  /** Активность 0..1: бег, борьба, работа. */
  activity: number;
  /** Существо ест прямо сейчас. */
  eating: boolean;
  /** Существо пьёт прямо сейчас. */
  drinking: boolean;
  /** Насколько тело защищено от холода и жара 0..1. */
  insulation: number;
}

export const DEATH_CAUSE = {
  BLOOD_LOSS: 'кровопотеря',
  ASPHYXIA: 'удушье',
  OVERHEAT: 'перегрев',
  HYPOTHERMIA: 'переохлаждение',
  DEHYDRATION: 'обезвоживание',
  STARVATION: 'истощение',
  SEPSIS: 'заражение крови',
  TRAUMA: 'смертельная травма',
} as const;

const BLOOD_NORMAL = 5.0;
const BLOOD_DEATH = 1.6;
const BLOOD_SHOCK = 3.2;

export class Physiology {
  /** Объём крови, литры. */
  blood = BLOOD_NORMAL;
  /** Насыщение кислородом, проценты. */
  oxygen = 98;
  /** Глюкоза крови, ммоль/л. */
  glucose = 5.0;
  /** Запас гликогена, граммы. */
  glycogen = 400;
  /** Вода в теле, 0..1. */
  hydration = 1;
  /** Температура ядра, °C. */
  coreTemp = 37;
  /** Пульс. */
  heartRate = 70;
  /** Гормоны стресса. */
  adrenaline = 0;
  cortisol = 0;
  /** Боль по частям тела 0..1. */
  readonly pain = new Float32Array(REGION_COUNT);
  /** Страх 0..1 — им пользуется политика и языковой контур. */
  fear = 0;
  /** Сознание: при шоке и удушье тело перестаёт слушаться. */
  conscious = true;

  alive = true;
  deathCause: string | null = null;
  /** Когда умер — тик. */
  deathTick = -1;
  /** Чем болело по ходу жизни: для вскрытия. */
  readonly wounds: Wound[] = [];
  /** Сколько всего урона получено за жизнь. */
  totalDamage = 0;
  /** История пиков и провалов: минимум и максимум по каждой величине. */
  readonly extremes = {
    minOxygen: 98,
    maxPain: 0,
    minTemp: 37,
    maxTemp: 37,
    minBlood: BLOOD_NORMAL,
    maxHeartRate: 70,
  };

  /** Сколько времени тело провело без сознания, секунд. */
  unconsciousTime = 0;
  /** Тело исчерпало запасы и разбирает само себя. */
  starving = false;

  /**
   * Шаг физиологии. dt в секундах.
   * Возвращает true, если существо живо.
   */
  step(dt: number, ctx: PhysiologyContext): boolean {
    if (!this.alive) return false;

    this.bleed(dt);
    this.breathe(dt, ctx);
    this.metabolize(dt, ctx);
    this.thermoregulate(dt, ctx);
    this.heal(dt);
    this.updateMind(dt);
    this.checkDeath();
    this.track();
    return this.alive;
  }

  /** Нанести повреждение. */
  applyDamage(region: number, amount: number, kind: DamageKind): void {
    if (!this.alive) return;
    // Сотня единиц урона — это смертельная рана целиком: 45 единиц
    // оставляют тяжёлую, но выживаемую.
    const severity = Math.min(1, amount / 100);
    let bleeding = 0;
    switch (kind) {
      case 'cut':
        bleeding = 0.02 * severity;
        break;
      case 'bite':
        bleeding = 0.015 * severity;
        break;
      case 'blunt':
        bleeding = 0.004 * severity;
        break;
      case 'burn':
        bleeding = 0;
        break;
      case 'cold':
      case 'acid':
        bleeding = 0.006 * severity;
        break;
      default:
        break;
    }

    const existing = this.wounds.find((w) => w.region === region && w.age < 30);
    if (existing) {
      existing.severity = Math.min(1, existing.severity + severity);
      existing.bleeding += bleeding;
      existing.age = 0;
    } else {
      this.wounds.push({ region, severity, bleeding, infection: 0, age: 0 });
    }

    this.pain[region] = Math.min(1, this.pain[region] + severity * (kind === 'burn' ? 1.0 : 0.7));
    this.totalDamage += amount;
    this.adrenaline = Math.min(1, this.adrenaline + severity * 0.8);
    this.fear = Math.min(1, this.fear + severity);
  }

  /** Съесть порцию: восстанавливает глюкозу и гликоген. */
  eat(amount: number): void {
    this.glucose = Math.min(8, this.glucose + amount * 0.4);
    this.glycogen = Math.min(600, this.glycogen + amount * 2);
  }

  drink(amount: number): void {
    this.hydration = Math.min(1, this.hydration + amount * 0.05);
  }

  /** Полное обезболивание — например, при тяжёлой травме. */
  get painLevel(): number {
    let worst = 0;
    let sum = 0;
    for (let i = 0; i < REGION_COUNT; i++) {
      sum += this.pain[i];
      if (this.pain[i] > worst) worst = this.pain[i];
    }
    return Math.min(1, worst * 0.6 + (sum / REGION_COUNT) * 0.4);
  }

  /** Драйвы для мозга: голод, жажда, усталость. */
  get hunger(): number {
    return clamp01(1 - this.glucose / 5);
  }

  get thirst(): number {
    return clamp01(1 - this.hydration);
  }

  get fatigue(): number {
    return clamp01(1 - this.glycogen / 400);
  }

  /** Расшифровка смерти: цепочка причин для вскрытия. */
  explainDeath(): string {
    if (this.alive) return 'жив';
    const parts: string[] = [this.deathCause ?? 'неизвестно'];
    if (this.blood < BLOOD_SHOCK) parts.push(`кровь ${this.blood.toFixed(1)} л`);
    if (this.oxygen < 60) parts.push(`кислород ${this.oxygen.toFixed(0)}%`);
    if (this.coreTemp < 30 || this.coreTemp > 41) parts.push(`температура ${this.coreTemp.toFixed(1)}°`);
    const infected = this.wounds.filter((w) => w.infection > 0.5).length;
    if (infected > 0) parts.push(`заражённых ран: ${infected}`);
    return parts.join(', ');
  }

  // ------------------------------------------------------------- внутреннее

  private bleed(dt: number): void {
    let loss = 0;
    for (const w of this.wounds) {
      w.age += dt;
      loss += w.bleeding;
      // Инфекция развивается в открытой ране.
      if (w.bleeding > 0 && w.severity > 0.2) {
        w.infection = Math.min(1, w.infection + dt * 0.0016 * w.severity);
      }
      // Свёртывание: со временем кровотечение останавливается само, но
      // тяжёлая рана не закрывается за полминуты — иначе от порезов
      // невозможно умереть, а это одна из главных опасностей мира.
      w.bleeding = Math.max(0, w.bleeding - dt * w.bleeding * 0.004);
    }
    this.blood = Math.max(0, this.blood - loss * dt);
  }

  private breathe(dt: number, ctx: PhysiologyContext): void {
    const target = ctx.submerged ? 0 : 98;
    if (ctx.submerged) {
      this.oxygen = Math.max(0, this.oxygen - dt * 9);
    } else {
      this.oxygen += (target - this.oxygen) * dt * (this.oxygen < 80 ? 0.35 : 0.12);
    }
    this.oxygen = clamp(this.oxygen, 0, 100);

    // Пульс тянется к нагрузке, шоку и нехватке кислорода.
    const shock = this.blood < BLOOD_SHOCK ? 1 : 0;
    const want = 60 + ctx.activity * 90 + this.adrenaline * 40 + shock * 40 + (this.oxygen < 85 ? 30 : 0);
    this.heartRate += (want - this.heartRate) * dt * 0.6;
  }

  private metabolize(dt: number, ctx: PhysiologyContext): void {
    // Расход глюкозы: покой дёшев, бег дорог.
    const burn = 0.004 + ctx.activity * 0.05;
    let need = burn * dt * 8;

    if (ctx.eating) this.eat(dt * 3);
    if (ctx.drinking) this.drink(dt * 3);

    if (this.glucose > 0.5) {
      this.glucose = Math.max(0, this.glucose - need);
    } else if (this.glycogen > 0) {
      this.glycogen = Math.max(0, this.glycogen - need * 40);
      need = 0;
    }
    this.starving = this.glucose < 2 && this.glycogen <= 0;
    if (this.starving) {
      // Тело начинает есть само себя. Это именно истощение, а не рана:
      // иначе вскрытие называло бы голодную смерть кровопотерей.
      this.blood = Math.max(0, this.blood - dt * 0.0008);
    }

    // Обезвоживание: постоянная потеря, восполняется питьём.
    this.hydration = Math.max(0, this.hydration - dt * (0.0012 + ctx.activity * 0.0035));
  }

  private thermoregulate(dt: number, ctx: PhysiologyContext): void {
    // Теплообмен со средой: одежда и жир замедляют его.
    const exchange = 0.012 * (1 - ctx.insulation * 0.8);
    this.coreTemp += (ctx.ambient - this.coreTemp) * exchange * dt;

    // Теплокровное тело само держит 37°: но силы на обогрев ограничены,
    // и в сильный мороз или жару их не хватает. Раньше регуляции не было
    // вовсе, и тело просто остывало до температуры воздуха — существо
    // умирало от переохлаждения в обычной комнате.
    const hasStrength = this.glycogen > 0 && this.hydration > 0.05;
    // Базальный обогрев есть всегда, пока тело живо: даже истощённый зверь
    // не остывает до температуры воздуха в тёплой комнате. Ослабевает он
    // ровно настолько, чтобы замёрзнуть в настоящий мороз.
    const strength = hasStrength ? 1 : 0.5;
    const pull = clamp((37 - this.coreTemp) * 2, -0.45, 0.45) * strength;
    this.coreTemp += pull * dt;
    if (hasStrength) {
      // Обогрев и охлаждение стоят сил.
      this.glycogen = Math.max(0, this.glycogen - Math.abs(pull) * dt * 4);
    }

    // Работа сама греет.
    this.coreTemp += ctx.activity * dt * 0.04;
    this.coreTemp = clamp(this.coreTemp, 20, 45);
  }

  private heal(dt: number): void {
    // Заживление: организм тратит на это силы.
    for (let i = this.wounds.length - 1; i >= 0; i--) {
      const w = this.wounds[i];
      if (w.age < 5) continue;
      const healRate = w.infection > 0.6 ? -0.0004 : 0.0012;
      w.severity += healRate * dt;
      if (w.severity <= 0 && w.bleeding <= 0) this.wounds.splice(i, 1);
    }
  }

  private updateMind(dt: number): void {
    this.adrenaline = Math.max(0, this.adrenaline - dt * 0.05);
    this.fear = Math.max(0, this.fear - dt * 0.04);
    for (let i = 0; i < REGION_COUNT; i++) {
      this.pain[i] = Math.max(0, this.pain[i] - dt * 0.03);
    }

    // Сознание теряется при шоке, удушье и сильной боли.
    const wasConscious = this.conscious;
    this.conscious =
      this.blood > BLOOD_SHOCK * 0.85 && this.oxygen > 55 && this.coreTemp > 28.5 && this.painLevel < 0.95;
    if (!this.conscious) this.unconsciousTime += dt;
    if (!wasConscious && this.conscious) this.fear = Math.min(1, this.fear + 0.3);
  }

  private checkDeath(): void {
    let cause: string | null = null;

    if (this.blood <= BLOOD_DEATH) {
      cause = this.starving ? DEATH_CAUSE.STARVATION : DEATH_CAUSE.BLOOD_LOSS;
    }
    else if (this.oxygen <= 5) cause = DEATH_CAUSE.ASPHYXIA;
    else if (this.coreTemp >= 42.5) cause = DEATH_CAUSE.OVERHEAT;
    else if (this.coreTemp <= 26) cause = DEATH_CAUSE.HYPOTHERMIA;
    else if (this.hydration <= 0) cause = DEATH_CAUSE.DEHYDRATION;
    else if (this.glucose <= 0 && this.glycogen <= 0) cause = DEATH_CAUSE.STARVATION;
    else if (this.infectionLevel > 1) cause = DEATH_CAUSE.SEPSIS;
    else if (this.wounds.some((w) => w.region === REGION.HEAD && w.severity >= 1)) {
      cause = DEATH_CAUSE.TRAUMA;
    } else if (this.wounds.some((w) => w.region === REGION.TORSO && w.severity >= 1)) {
      cause = DEATH_CAUSE.TRAUMA;
    }

    if (cause) {
      this.alive = false;
      this.deathCause = cause;
      this.conscious = false;
    }
  }

  get infectionLevel(): number {
    let sum = 0;
    for (const w of this.wounds) sum += w.infection;
    return sum;
  }

  private track(): void {
    const e = this.extremes;
    e.minOxygen = Math.min(e.minOxygen, this.oxygen);
    e.maxPain = Math.max(e.maxPain, this.painLevel);
    e.minTemp = Math.min(e.minTemp, this.coreTemp);
    e.maxTemp = Math.max(e.maxTemp, this.coreTemp);
    e.minBlood = Math.min(e.minBlood, this.blood);
    e.maxHeartRate = Math.max(e.maxHeartRate, this.heartRate);
  }

  /** Кровопотеря в литрах — для вскрытия. */
  get bloodLost(): number {
    return BLOOD_NORMAL - this.blood;
  }

  /** Снимок состояния строкой — для панели наблюдателя. */
  summary(): string {
    return (
      `кровь ${this.blood.toFixed(1)} л, O2 ${this.oxygen.toFixed(0)}%, ` +
      `глюкоза ${this.glucose.toFixed(1)}, вода ${(this.hydration * 100).toFixed(0)}%, ` +
      `темп ${this.coreTemp.toFixed(1)}°, пульс ${this.heartRate.toFixed(0)}, ` +
      `боль ${(this.painLevel * 100).toFixed(0)}%`
    );
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
