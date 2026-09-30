/**
 * Фиксированный шаг времени с накопителем.
 *
 * Симуляция обязана идти ровно 60 тиков в секунду независимо от того,
 * что происходит со стенными часами и насколько занят процессор.
 * Догоняющие тики ограничены, иначе при просадке процессора мы получим
 * «спираль смерти»: чем больше отстаём, тем больше работы на кадр.
 */
export class Clock {
  readonly stepMs: number;
  readonly maxCatchUp: number;

  /** Сколько тиков реально выполнено. */
  ticks = 0;
  /** Сколько тиков пришлось выбросить из-за нехватки времени. */
  dropped = 0;

  private acc = 0;
  private lastTickMs = 0;
  private nowMs = 0;

  constructor(stepMs = 1000 / 60, maxCatchUp = 3) {
    this.stepMs = stepMs;
    this.maxCatchUp = maxCatchUp;
  }

  /** Сколько тиков нужно выполнить за прошедшие dtMs миллисекунд. */
  pending(dtMs: number): number {
    if (dtMs > 0) this.acc += dtMs;
    let n = 0;
    while (this.acc >= this.stepMs && n < this.maxCatchUp) {
      this.acc -= this.stepMs;
      n++;
    }
    // Если отстали сильнее, чем на maxCatchUp шагов — долг прощаем,
    // время в симуляции «идёт медленнее», но она не захлёбывается.
    if (this.acc > this.stepMs * this.maxCatchUp) {
      const excess = this.acc - this.stepMs * this.maxCatchUp;
      this.dropped += Math.floor(excess / this.stepMs);
      this.acc = this.acc % this.stepMs;
    }
    return n;
  }

  /** Отметка о выполнении тика (для замера реального tps). */
  markTick(nowMs: number): void {
    this.nowMs = nowMs;
    this.ticks++;
    this.lastTickMs = nowMs;
  }

  get lastTickAtMs(): number {
    return this.lastTickMs;
  }

  get now(): number {
    return this.nowMs;
  }

  /** Дробная часть накопителя — для интерполяции отрисовки. */
  get alpha(): number {
    return this.acc / this.stepMs;
  }

  reset(): void {
    this.acc = 0;
  }
}

/** Простой счётчик темпа: сколько тиков в секунду происходит на самом деле. */
export class RateMeter {
  private stamps: number[] = [];
  private readonly windowMs: number;

  constructor(windowMs = 2000) {
    this.windowMs = windowMs;
  }

  push(nowMs: number): void {
    this.stamps.push(nowMs);
    const cutoff = nowMs - this.windowMs;
    while (this.stamps.length > 0 && this.stamps[0] < cutoff) this.stamps.shift();
  }

  get rate(): number {
    if (this.stamps.length < 2) return 0;
    const span = this.stamps[this.stamps.length - 1] - this.stamps[0];
    if (span <= 0) return 0;
    return ((this.stamps.length - 1) * 1000) / span;
  }
}
