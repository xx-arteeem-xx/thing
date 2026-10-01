/**
 * Журнал открытий.
 *
 * Первое в истории мира событие — это и есть «новое для себя». Пока это
 * просто летопись для наблюдателя, но ровно на неё будет опираться
 * любопытство в Ф2: сигнал новизны политике даёт именно этот журнал.
 *
 * Хранится двумя способами: в памяти — короткий список для интерфейса,
 * на диске — дописываемый JSONL, чтобы летопись не терялась между жизнями
 * и переживала перезапуск сервера.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Discovery {
  tick: number;
  kind: string;
  key: string;
  /** Человекочитаемое описание для наблюдателя. */
  text: string;
  /** Сколько всего таких событий случилось (для повторных — счётчик). */
  count: number;
}

export type DiscoveryHandler = (d: Discovery) => void;

export class Journal {
  private readonly seen = new Map<string, Discovery>();
  private readonly recentList: Discovery[] = [];
  private readonly limit: number;
  private file: string | null;
  private handler: DiscoveryHandler | null = null;

  constructor(limit = 400, file: string | null = null) {
    this.limit = limit;
    this.file = file;
    if (file) {
      try {
        mkdirSync(dirname(file), { recursive: true });
      } catch {
        this.file = null;
      }
    }
  }

  /** Подписка для живого эфира наблюдателя. */
  onDiscovery(handler: DiscoveryHandler): void {
    this.handler = handler;
  }

  /**
   * Отметить событие. Первое такое событие попадает в летопись целиком,
   * последующие только увеличивают счётчик — иначе журнал превратится
   * в поток одинаковых строк.
   */
  note(tick: number, kind: string, key: string, text: string): Discovery | null {
    const id = `${kind}:${key}`;
    const existing = this.seen.get(id);
    if (existing) {
      existing.count++;
      return null;
    }

    const d: Discovery = { tick, kind, key, text, count: 1 };
    this.seen.set(id, d);
    this.recentList.push(d);
    while (this.recentList.length > this.limit) this.recentList.shift();
    this.persist(d);
    if (this.handler) this.handler(d);
    return d;
  }

  has(kind: string, key: string): boolean {
    return this.seen.has(`${kind}:${key}`);
  }

  get total(): number {
    return this.seen.size;
  }

  recent(count = 60): Discovery[] {
    return this.recentList.slice(-count).reverse();
  }

  /** Вся летопись, свежие сверху. */
  all(): Discovery[] {
    return [...this.seen.values()].sort((a, b) => b.tick - a.tick);
  }

  private persist(d: Discovery): void {
    if (!this.file) return;
    try {
      appendFileSync(this.file, `${JSON.stringify(d)}\n`, 'utf8');
    } catch {
      // Летопись не должна ронять мир: не смогли записать — переживём.
      this.file = null;
    }
  }
}
