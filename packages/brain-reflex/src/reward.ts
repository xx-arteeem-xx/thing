/**
 * Внутренняя награда.
 *
 * Единственный источник мотивации. Внешней награды у существа нет и не
 * будет: никто не говорит ему «молодец». Значит, сигнал должен родиться
 * внутри — из новизны, из облегчения и из боли.
 *
 * Из чего складывается:
 *   новизна          — попадание в состояние, где он ещё не был;
 *   снижение драйвов — стало меньше голодно, больно, страшно;
 *   открытие         — первое в истории мира событие (журнал);
 *   выживание        — небольшая плата за каждый прожитый отрезок;
 *   боль, усталость, повтор — штрафы.
 *
 * Два способа провала, от которых здесь стоят защиты:
 *   «сел в угол»    — штраф за повтор и растущая скука;
 *   самостимуляция  — новизна затухает по посещениям, поэтому крутиться
 *                     на месте бессмысленно.
 */
import type { Creature } from '../../body/src/creature.ts';

export interface RewardParts {
  novelty: number;
  drives: number;
  discovery: number;
  survival: number;
  pain: number;
  fatigue: number;
  repetition: number;
  total: number;
}

export interface RewardConfig {
  wNovelty: number;
  wDrives: number;
  wDiscovery: number;
  wSurvival: number;
  wPain: number;
  wFatigue: number;
  wRepeat: number;
}

export const DEFAULT_REWARD: RewardConfig = {
  wNovelty: 1.0,
  wDrives: 3.0,
  wDiscovery: 2.0,
  wSurvival: 0.02,
  wPain: 2.5,
  wFatigue: 0.5,
  wRepeat: 0.4,
};

/** Сколько чисел описывают состояние: для распознавания «я тут уже был». */
const STATE_BUCKETS = 64;

/**
 * Программа взросления.
 *
 * Сначала существо учится не умирать: боль, голод и усталость весят много,
 * новизна — почти ничего. Иначе оно гибнет от любопытства раньше, чем
 * успевает понять, что огонь жжётся. Когда выживание становится уверенным,
 * вес смещается к новизне — и оно начинает исследовать.
 *
 * Это не выбор «покой или новизна», а порядок: сначала одно, потом другое,
 * как учатся живые существа.
 */
export interface Curriculum {
  /** Сколько тиков длится взросление. */
  maturityTicks: number;
  /** Доля веса новизны в начале и в конце. */
  noveltyAtBirth: number;
  noveltyAtMaturity: number;
}

export const DEFAULT_CURRICULUM: Curriculum = {
  maturityTicks: 36000,
  noveltyAtBirth: 0.15,
  noveltyAtMaturity: 1.0,
};

export class Reward {
  cfg: RewardConfig;
  curriculum: Curriculum;
  /** Во сколько раз сейчас усилена новизна относительно врождённой. */
  noveltyScale = 1;
  /** Во сколько раз сейчас усилена забота о себе. */
  safetyScale = 1;
  /** Сколько раз существо бывало в каждом грубом состоянии. */
  private readonly visits = new Map<number, number>();
  /** Прошлые драйвы — чтобы считать улучшение, а не абсолютное значение. */
  private prevHunger = 0;
  private prevThirst = 0;
  private prevFatigue = 0;
  private prevPain = 0;
  private prevFear = 0;
  /** Прошлое действие: за повтор — штраф. */
  private prevAction = 0;
  private repeatRun = 0;
  /** Накопленная сумма за жизнь. */
  total = 0;
  /** Последние составляющие — для наблюдателя. */
  readonly last: RewardParts = {
    novelty: 0,
    drives: 0,
    discovery: 0,
    survival: 0,
    pain: 0,
    fatigue: 0,
    repetition: 0,
    total: 0,
  };
  /** Сколько новых состояний найдено за жизнь. */
  discoveries = 0;

  constructor(cfg: RewardConfig = DEFAULT_REWARD, curriculum: Curriculum = DEFAULT_CURRICULUM) {
    this.cfg = cfg;
    this.curriculum = curriculum;
    this.noveltyScale = curriculum.noveltyAtBirth;
    this.safetyScale = 2 - curriculum.noveltyAtBirth;
  }

  /**
   * Обновить веса по возрасту существа: чем дольше живёт, тем больше
   * ему позволено рисковать ради нового.
   */
  setAge(ageTicks: number): void {
    const t = Math.max(0, Math.min(1, ageTicks / Math.max(1, this.curriculum.maturityTicks)));
    // Плавно, а не ступенькой: резкая смена правил ломает обучение.
    const smooth = t * t * (3 - 2 * t);
    this.noveltyScale = this.curriculum.noveltyAtBirth +
      (this.curriculum.noveltyAtMaturity - this.curriculum.noveltyAtBirth) * smooth;
    this.safetyScale = 2 - this.noveltyScale;
  }

  /** Посчитать награду за текущий шаг. */
  step(
    c: Creature,
    sensors: Float32Array,
    action: number,
    journalTotal: number,
    dt: number,
  ): RewardParts {
    const p = c.physiology;

    // --- новизна: насколько часто он бывал в таком состоянии
    const key = stateKey(sensors);
    const seen = this.visits.get(key) ?? 0;
    this.visits.set(key, seen + 1);
    if (seen === 0) this.discoveries++;
    const novelty = 1 / (1 + seen);

    // --- снижение драйвов: стало легче — хорошо
    const driveDelta =
      (this.prevHunger - p.hunger) +
      (this.prevThirst - p.thirst) +
      (this.prevFatigue - p.fatigue) +
      (this.prevPain - p.painLevel) +
      (this.prevFear - p.fear);
    this.prevHunger = p.hunger;
    this.prevThirst = p.thirst;
    this.prevFatigue = p.fatigue;
    this.prevPain = p.painLevel;
    this.prevFear = p.fear;

    // --- открытие: журнал мира вырос — это новое для себя
    const discovery = Math.max(0, journalTotal - this.lastDiscoveryTotal);
    if (discovery > 0) this.lastDiscoveryTotal = journalTotal;

    // --- повтор: топтание на месте невыгодно
    if (action === this.prevAction) this.repeatRun++;
    else this.repeatRun = 0;
    this.prevAction = action;
    const repetition = Math.min(1, this.repeatRun / 60);

    const parts: RewardParts = {
      novelty: this.cfg.wNovelty * novelty * this.noveltyScale,
      drives: this.cfg.wDrives * driveDelta * this.safetyScale,
      discovery: this.cfg.wDiscovery * Math.min(1, discovery) * this.noveltyScale,
      survival: this.cfg.wSurvival * dt,
      pain: -this.cfg.wPain * p.painLevel * this.safetyScale,
      fatigue: -this.cfg.wFatigue * p.fatigue * this.safetyScale,
      repetition: -this.cfg.wRepeat * repetition,
      total: 0,
    };
    parts.total =
      parts.novelty + parts.drives + parts.discovery + parts.survival +
      parts.pain + parts.fatigue + parts.repetition;

    Object.assign(this.last, parts);
    this.total += parts.total;
    return parts;
  }

  private lastDiscoveryTotal = 0;

  /** Сбросить память о посещениях: например, при новой жизни. */
  resetVisits(): void {
    this.visits.clear();
  }

  /** Сколько разных состояний существо повидало. */
  get visitedStates(): number {
    return this.visits.size;
  }
}

/** Грубый ключ состояния: 64 корзины по пяти важнейшим величинам. */
function stateKey(s: Float32Array): number {
  let h = 2166136261;
  const take = (i: number, buckets: number): void => {
    const v = Math.round((Math.max(-1, Math.min(1, s[i])) * 0.5 + 0.5) * (buckets - 1));
    h = Math.imul(h ^ v, 16777619);
  };
  // Драйвы, боль и то, что под ногами — самое важное для «где я и как мне».
  take(45, 8);
  take(46, 8);
  take(47, 8);
  take(49, 8);
  take(35, 2);
  take(36, 2);
  take(31, 4);
  take(39, 4);
  return (h >>> 0) % (STATE_BUCKETS * STATE_BUCKETS);
}
