/**
 * Детерминированный генератор случайных чисел (xorshift128).
 *
 * Требования к нему в этом проекте жёсткие:
 *  - одинаковая последовательность при одинаковом seed на любой машине;
 *  - состояние можно сохранить в снапшот и продолжить ровно с того же места;
 *  - никакого Math.random() в симуляции (см. инвариант И5 в docs/PLAN.md).
 */
export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number) {
    this.seed(seed);
  }

  /** Заполняет состояние через splitmix32, чтобы даже seed=0 давал живой поток. */
  seed(seed: number): void {
    let x = seed >>> 0;
    const next = (): number => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Следующее 32-битное беззнаковое. */
  nextU32(): number {
    let t = this.s0;
    const w = this.s3;
    t = (t ^ (t << 11)) >>> 0;
    this.s0 = this.s1;
    this.s1 = this.s2;
    this.s2 = this.s3;
    this.s3 = (w ^ (w >>> 19) ^ t ^ (t >>> 8)) >>> 0;
    return this.s3;
  }

  /** [0, 1) */
  nextFloat(): number {
    return this.nextU32() / 4294967296;
  }

  /** Целое из [0, n). */
  nextInt(n: number): number {
    return Math.floor(this.nextFloat() * n);
  }

  /** Целое из [lo, hi] включительно. */
  nextRange(lo: number, hi: number): number {
    return lo + Math.floor(this.nextFloat() * (hi - lo + 1));
  }

  /** true с вероятностью p. */
  chance(p: number): boolean {
    return this.nextFloat() < p;
  }

  /** Знак -1 или +1. */
  sign(): number {
    return (this.nextU32() & 1) === 0 ? 1 : -1;
  }

  /** Состояние для снапшота. */
  state(): Uint32Array {
    return Uint32Array.of(this.s0, this.s1, this.s2, this.s3);
  }

  /** Восстановление из снапшота. */
  restore(state: Uint32Array): void {
    this.s0 = state[0] >>> 0;
    this.s1 = state[1] >>> 0;
    this.s2 = state[2] >>> 0;
    this.s3 = state[3] >>> 0;
  }
}

/** Отпечаток позиции: стабильная «текстура» без хранения данных. */
export function hash2d(x: number, y: number): number {
  let h = (Math.imul(x, 0x1f1f1f1f) ^ Math.imul(y, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
