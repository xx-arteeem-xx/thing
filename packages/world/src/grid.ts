/**
 * Сетка мира: плоские типизированные массивы + отслеживание грязных чанков.
 *
 * Две разные «грязности», их важно не путать:
 *   dirty  — чанк нужно пересчитать на следующем тике (симуляция);
 *   changed — в чанке что-то визуально изменилось с прошлой отдачи кадра (наблюдатель).
 *
 * Спящий чанк не пересчитывается вообще. Именно это даёт 3–10× экономии
 * на статичном мире и позволяет держать 512×256 на слабом процессоре.
 *
 * Двойная буферизация dirty (dirty/dirtyNext) нужна потому, что во время
 * обхода мы и пишем отметки для следующего тика, и читаем отметки текущего.
 */
export const CHUNK = 16;

/**
 * Бит-паритет «уже двигалась»: чётные тики используют MOVE_A, нечётные MOVE_B.
 * Так не нужно чистить флаги у 131 072 клеток каждый тик — достаточно
 * смотреть на другой бит.
 */
export const FLAG = {
  MOVE_A: 1 << 0,
  MOVE_B: 1 << 1,
  /** Горит (зарезервировано для Ф0+). */
  BURNING: 1 << 2,
  /** Мокрая (зарезервировано: тушение, растворение). */
  WET: 1 << 3,
} as const;

/** Биты, которые переживают смену вещества в клетке. */
export const MOVE_MASK = FLAG.MOVE_A | FLAG.MOVE_B;

export class Grid {
  readonly w: number;
  readonly h: number;
  readonly cols: number;
  readonly rows: number;
  readonly chunkCount: number;

  readonly mat: Uint8Array;
  readonly flags: Uint8Array;
  readonly temp: Int16Array;
  readonly aux: Uint16Array;
  /** Освещённость 0..255: небесный свет и огонь. */
  readonly light: Uint8Array;

  private dirty: Uint8Array;
  private dirtyNext: Uint8Array;
  private changed: Uint8Array;

  /** Сколько чанков изменилось с момента последнего takeChanged(). */
  changedCount = 0;

  constructor(width: number, height: number, ambient = 20) {
    this.w = width;
    this.h = height;
    this.cols = Math.ceil(width / CHUNK);
    this.rows = Math.ceil(height / CHUNK);
    this.chunkCount = this.cols * this.rows;

    const n = width * height;
    this.mat = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    this.temp = new Int16Array(n);
    this.aux = new Uint16Array(n);
    this.light = new Uint8Array(n);
    this.temp.fill(ambient);

    this.dirty = new Uint8Array(this.chunkCount);
    this.dirtyNext = new Uint8Array(this.chunkCount);
    this.changed = new Uint8Array(this.chunkCount);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  chunkIndex(x: number, y: number): number {
    return (y >> 4) * this.cols + (x >> 4);
  }

  /**
   * Отметить изменение клетки.
   * Для симуляции помечаем ещё и соседний чанк, если клетка на границе:
   * иначе жидкость не сможет перетечь через шов между чанками.
   * Для отрисовки помечаем только свой чанк — соседний визуально не изменился.
   */
  touch(x: number, y: number): void {
    const cx = x >> 4;
    const cy = y >> 4;
    const c = cy * this.cols + cx;
    this.dirtyNext[c] = 1;
    this.changed[c] = 1;

    const lx = x & 15;
    const ly = y & 15;
    if (lx === 0 && cx > 0) this.dirtyNext[c - 1] = 1;
    if (lx === 15 && cx + 1 < this.cols) this.dirtyNext[c + 1] = 1;
    if (ly === 0 && cy > 0) this.dirtyNext[c - this.cols] = 1;
    if (ly === 15 && cy + 1 < this.rows) this.dirtyNext[c + this.cols] = 1;
  }

  /** Пометить всё (после генерации мира или загрузки снапшота). */
  touchAll(): void {
    this.dirtyNext.fill(1);
    this.changed.fill(1);
    this.changedCount = this.chunkCount;
  }

  /** Начало тика: текущие отметки становятся рабочими, буфер под новые чистится. */
  beginTick(): void {
    const tmp = this.dirty;
    this.dirty = this.dirtyNext;
    this.dirtyNext = tmp;
    this.dirtyNext.fill(0);
  }

  isDirty(chunk: number): boolean {
    return this.dirty[chunk] === 1;
  }

  /**
   * Продлить бодрствование чанка на следующий тик.
   *
   * Нужно для клеток с временными правилами: горящий огонь, тающий лёд,
   * нагревающееся дерево. Такая клетка может тик за тиком ничего не менять,
   * и без этой отметки её чанк уснул бы — а вместе с ним навсегда замерли бы
   * и время жизни пламени, и воспламенение.
   */
  keepAwake(chunk: number): void {
    this.dirtyNext[chunk] = 1;
  }

  /**
   * Отметки «что пересчитать на следующем тике» — часть состояния симуляции,
   * а не деталь реализации. Без них восстановленный мир пошёл бы другим
   * путём: обход чистых чанков не тратит случайные числа, значит от набора
   * грязных чанков зависит вся дальнейшая история.
   */
  dirtyNextBytes(): Uint8Array {
    return this.dirtyNext;
  }

  restoreDirtyNext(bytes: Uint8Array): void {
    this.dirtyNext.set(bytes.subarray(0, this.chunkCount));
    this.dirty.fill(0);
  }

  /** Забрать список изменившихся чанков (для отдачи кадра наблюдателю). */
  takeChanged(out: Int32Array): number {
    let n = 0;
    for (let c = 0; c < this.chunkCount; c++) {
      if (this.changed[c] === 1) {
        if (n < out.length) out[n++] = c;
        this.changed[c] = 0;
      }
    }
    this.changedCount = 0;
    return n;
  }

  /** Поставить вещество. Температуру не трогаем — тепло живёт своей жизнью. */
  set(x: number, y: number, m: number): void {
    const i = y * this.w + x;
    this.mat[i] = m;
    this.aux[i] = 0;
    // Биты «двигалась» сбрасываем: у нового вещества своя судьба в этом тике.
    this.flags[i] = 0;
    this.touch(x, y);
  }

  get(x: number, y: number): number {
    return this.mat[y * this.w + x];
  }
}
