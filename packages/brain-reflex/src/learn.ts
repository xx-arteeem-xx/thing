/**
 * Обучение онлайн.
 *
 * Первая ступень: градиент по политике с базовой линией. Сеть крошечная
 * (2112 параметров), поэтому её можно обновлять прямо в процессе, на том же
 * процессоре, где идёт мир — никакого Colab для этого не нужно.
 *
 * Схема простая и честная:
 *   1. политика действует, мы запоминаем состояние, действие и награду;
 *   2. когда набирается эпизод, считаем, насколько каждая награда лучше
 *      или хуже привычного уровня (базовая линия);
 *   3. сдвигаем веса так, чтобы действия, после которых стало лучше
 *      среднего, становились вероятнее, а хуже — реже.
 *
 * Ступень вторая (клипованная цель PPO, чтобы шаг не был слишком резким)
 * появится, когда будет видно, что обучение вообще идёт и не расходится.
 */
import { HIDDEN, INPUTS, OUTPUTS } from './policy.ts';
import type { ReflexPolicy } from './policy.ts';

export interface Transition {
  sensors: Float32Array;
  hidden: Float32Array;
  outputs: Float32Array;
  reward: number;
}

export interface LearnConfig {
  /** Скорость обучения. */
  lr: number;
  /** Сколько переходов копить перед обновлением. */
  batch: number;
  /** Насколько сильно ограничивать шаг (норма градиента). */
  clip: number;
  /** Забывание базовой линии: 0 — помнить всё, 1 — только последнее. */
  baselineMomentum: number;
}

export const DEFAULT_LEARN: LearnConfig = {
  lr: 0.02,
  batch: 512,
  clip: 1.0,
  baselineMomentum: 0.98,
};

export class Learner {
  cfg: LearnConfig;
  private readonly batch: Transition[] = [];
  /** Средний уровень награды: с ним сравниваем, чтобы понять «лучше или хуже». */
  private baseline = 0;
  /** Сколько обновлений сделано за жизнь. */
  updates = 0;
  /** Средняя награда по последним обновлениям — для наблюдателя. */
  lastMeanReward = 0;
  /** Разброс награды в последнем эпизоде. */
  lastStd = 0;
  private rewardSum = 0;
  private rewardSquareSum = 0;
  private rewardCount = 0;
  /**
   * Разброс награды. Без него преимущество измеряется в абсолютных
   * единицах, и постоянные штрафы за боль и усталость топят полезный
   * сигнал: политика видит сплошной минус и не понимает, что лучше.
   */
  private rewardStd = 1;

  constructor(cfg: LearnConfig = DEFAULT_LEARN) {
    this.cfg = cfg;
  }

  /**
   * Запомнить шаг. Когда набирается достаточно — обновить веса.
   * Возвращает true, если веса были обновлены.
   */
  observe(policy: ReflexPolicy, reward: number): boolean {
    this.batch.push({
      sensors: policy.sensors.slice(),
      hidden: policy.hidden.slice(),
      outputs: policy.outputs.slice(),
      reward,
    });
    this.rewardSum += reward;
    this.rewardSquareSum += reward * reward;
    this.rewardCount++;

    if (this.batch.length >= this.cfg.batch) {
      this.update(policy);
      return true;
    }
    return false;
  }

  /** Одно обновление весов по накопленному эпизоду. */
  update(policy: ReflexPolicy): void {
    if (this.batch.length === 0) return;
    const { lr, clip, baselineMomentum } = this.cfg;

    // Базовая линия — сглаженная средняя награда.
    const n = Math.max(1, this.rewardCount);
    const mean = this.rewardSum / n;
    const variance = Math.max(1e-6, this.rewardSquareSum / n - mean * mean);
    const std = Math.sqrt(variance);

    this.baseline = this.baseline * baselineMomentum + mean * (1 - baselineMomentum);
    // Разброс тоже сглаживаем: он не должен прыгать от одного эпизода.
    this.rewardStd = this.rewardStd * 0.9 + std * 0.1;
    this.lastMeanReward = mean;
    this.lastStd = std;
    this.rewardSum = 0;
    this.rewardSquareSum = 0;
    this.rewardCount = 0;

    const { w1, b1, w2, b2 } = policy.weights;
    const scale = 1 / this.batch.length;

    for (const tr of this.batch) {
      // Преимущество в единицах разброса: «лучше обычного на сколько-то
      // сигм». Именно это делает обучение устойчивым при любых штрафах.
      const raw = (tr.reward - this.baseline) / Math.max(1e-3, this.rewardStd);
      const advantage = raw < -3 ? -3 : raw > 3 ? 3 : raw;
      if (Math.abs(advantage) < 0.05) continue;

      // Градиент для выхода: для гауссовой политики вокруг выхода сети
      // это (действие − среднее) × преимущество. Действие здесь — сам
      // выход, а «шум» мы считаем единичным, поэтому остаётся преимущество.
      const dOut = new Float32Array(OUTPUTS);
      for (let o = 0; o < OUTPUTS; o++) {
        dOut[o] = advantage * (1 - tr.outputs[o] * tr.outputs[o]);
      }

      // Накапливаем градиенты в локальные дельты и применяем сразу:
      // буферов на всю сеть не держим, чтобы не мусорить.
      for (let o = 0; o < OUTPUTS; o++) {
        const grad = dOut[o] * scale;
        if (grad === 0) continue;
        const base = o * HIDDEN;
        for (let h = 0; h < HIDDEN; h++) {
          w2[base + h] += lr * clamp(grad * tr.hidden[h], -clip, clip);
        }
        b2[o] += lr * clamp(grad, -clip, clip);
      }

      // Скрытый слой: ошибка проходит назад через веса второго слоя.
      for (let h = 0; h < HIDDEN; h++) {
        let sum = 0;
        for (let o = 0; o < OUTPUTS; o++) sum += dOut[o] * w2[o * HIDDEN + h];
        const dh = sum * (1 - tr.hidden[h] * tr.hidden[h]) * scale;
        if (dh === 0) continue;
        for (let i = 0; i < INPUTS; i++) {
          w1[h * INPUTS + i] += lr * clamp(dh * tr.sensors[i], -clip, clip);
        }
        b1[h] += lr * clamp(dh, -clip, clip);
      }
    }

    this.batch.length = 0;
    this.updates++;
  }

  get pending(): number {
    return this.batch.length;
  }

  /** Текущий уровень, с которым сравнивается награда. */
  get baselineValue(): number {
    return this.baseline;
  }

  /** Сбросить накопленное — например, при новой жизни. */
  reset(): void {
    this.batch.length = 0;
    this.rewardSum = 0;
    this.rewardSquareSum = 0;
    this.rewardCount = 0;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
