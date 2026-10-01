/**
 * Защита от деградации.
 *
 * Обучение онлайн опасно тем, что политика может тихо испортиться:
 * средняя награда падает, навыки затираются, и заметить это можно
 * только по логам, которых никто не читает. Здесь стоит сторож:
 * он помнит лучшее состояние весов и откатывает к нему, если стало
 * устойчиво хуже.
 *
 * Это инфраструктура, а не настройка: она нужна независимо от того,
 * каким будет сигнал награды.
 */
import type { ReflexPolicy, PolicyWeights } from './policy.ts';

export interface GuardConfig {
  /** Сколько обновлений подряд должно быть хуже, чтобы откатиться. */
  patience: number;
  /** Насколько хуже должно стать, чтобы это считалось деградацией. */
  tolerance: number;
}

export const DEFAULT_GUARD: GuardConfig = { patience: 6, tolerance: 0.05 };

export class WeightGuard {
  cfg: GuardConfig;
  private best: PolicyWeights | null = null;
  private bestScore = -Infinity;
  private worseRun = 0;
  /** Сколько откатов сделано за жизнь. */
  rollbacks = 0;
  /** Лучшая средняя награда, какую политика показывала. */
  bestReward = -Infinity;

  constructor(cfg: GuardConfig = DEFAULT_GUARD) {
    this.cfg = cfg;
  }

  /**
   * Сообщить среднюю награду за последний эпизод.
   * Возвращает true, если веса были откатаны к лучшему состоянию.
   */
  observe(policy: ReflexPolicy, meanReward: number): boolean {
    if (!Number.isFinite(meanReward)) return false;

    if (meanReward > this.bestScore + this.cfg.tolerance || this.best === null) {
      // Стало лучше — запоминаем это состояние как эталон.
      this.bestScore = meanReward;
      this.bestReward = meanReward;
      this.best = cloneWeights(policy.weights);
      this.worseRun = 0;
      return false;
    }

    if (meanReward < this.bestScore - this.cfg.tolerance) {
      this.worseRun++;
    } else {
      this.worseRun = 0;
    }

    if (this.worseRun >= this.cfg.patience && this.best !== null) {
      policy.weights = cloneWeights(this.best);
      this.worseRun = 0;
      this.rollbacks++;
      return true;
    }
    return false;
  }

  /** Забыть эталон: например, при новой жизни. */
  reset(): void {
    this.best = null;
    this.bestScore = -Infinity;
    this.worseRun = 0;
  }
}

function cloneWeights(w: PolicyWeights): PolicyWeights {
  return {
    w1: w.w1.slice(),
    b1: w.b1.slice(),
    w2: w.w2.slice(),
    b2: w.b2.slice(),
  };
}
