/**
 * Мир целиком: сетка + RNG + конфиг + снапшоты + инструменты наблюдателя.
 *
 * World — единственный авторитетный владелец состояния. Всё, что меняет мир,
 * проходит через его методы, и каждый метод помечает изменённые чанки,
 * чтобы наблюдатель получил ровно то, что изменилось.
 */
import { Rng } from '../../core/src/rng.ts';
import {
  SEC,
  i16Bytes,
  i16FromBytes,
  readSnapshot,
  u16Bytes,
  u16FromBytes,
  u32Bytes,
  u32FromBytes,
  writeSnapshot,
  hashBytes,
} from '../../core/src/snapshot.ts';
import { CHUNK, Grid } from './grid.ts';
import { MAT, MATERIALS, MATERIAL_COUNT } from './materials.ts';
import { WEATHER, computeSkyLight, stepWorld } from './sim.ts';

export interface WorldConfig {
  width: number;
  height: number;
  seed: number;
  ambient: number;
  heatEveryTicks: number;
  lightEveryTicks: number;
  /** Длина суток в тиках. 4800 тиков — это 80 секунд при 60 Гц. */
  dayLengthTicks: number;
  weather: boolean;
}

export interface WorldStats {
  tick: number;
  cells: number;
  chunks: number;
  /** Сколько клеток занято каждым веществом. */
  counts: number[];
  /** Клеток, заметно нагретых или охлаждённых относительно среды. */
  hotCells: number;
  /** Живых растений. */
  plants: number;
  thermalIdle: boolean;
  skyLight: number;
  weather: number;
}

const TEMP_MIN = -273;
const TEMP_MAX = 3000;

export class World {
  readonly cfg: WorldConfig;
  readonly grid: Grid;
  readonly rng: Rng;
  /**
   * Локальная температура среды по клеткам: слева холодная кромка, справа
   * тёплая. Без этого поля весь мир быстро сходится к одной температуре,
   * лёд тает навсегда, и мир становится однородным.
   */
  readonly ambient: Int16Array;

  tick = 0;
  /** Всё остыло до своей температуры среды — тепловой проход можно не считать. */
  thermalIdle = true;
  /** Текущий небесный свет, 0..255. */
  skyLight = 255;
  weather: { kind: number; until: number } = { kind: WEATHER.CLEAR, until: 0 };

  /**
   * Чанки, в которых есть отклонение от температуры среды. Тепловой проход
   * считает только их (и соседей), а не весь мир: в спокойном мире это
   * разница между 5 мс и 0.1 мс на проход.
   */
  hotChunks: Uint8Array;
  hotChunksNext: Uint8Array;

  private changedBuf: Int32Array;

  constructor(cfg: WorldConfig) {
    this.cfg = cfg;
    this.grid = new Grid(cfg.width, cfg.height, cfg.ambient);
    this.rng = new Rng(cfg.seed);
    this.changedBuf = new Int32Array(this.grid.chunkCount);
    this.ambient = new Int16Array(cfg.width * cfg.height);
    this.ambient.fill(cfg.ambient);
    this.hotChunks = new Uint8Array(this.grid.chunkCount);
    this.hotChunksNext = new Uint8Array(this.grid.chunkCount);
    this.skyLight = computeSkyLight(0, cfg.dayLengthTicks);
  }

  /** Отметить, что в клетке (или рядом) есть тепло, требующее пересчёта. */
  markHot(x: number, y: number): void {
    this.hotChunks[this.grid.chunkIndex(x, y)] = 1;
  }

  swapHotChunks(): void {
    const tmp = this.hotChunks;
    this.hotChunks = this.hotChunksNext;
    this.hotChunksNext = tmp;
  }

  /** Температура среды в клетке. */
  ambientAt(x: number, y: number): number {
    return this.ambient[y * this.grid.w + x];
  }

  tickOnce(): void {
    this.skyLight = computeSkyLight(this.tick, this.cfg.dayLengthTicks);
    stepWorld(this);
  }

  /** Доля суток: 0 — полночь, 0.5 — полдень. */
  get timeOfDay(): number {
    return (this.tick % this.cfg.dayLengthTicks) / this.cfg.dayLengthTicks;
  }

  /** Круговой инструмент наблюдателя: поставить вещество. */
  paint(cx: number, cy: number, radius: number, mat: number): number {
    const g = this.grid;
    const r = Math.max(0, radius | 0);
    let painted = 0;

    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= g.h) continue;
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= g.w) continue;
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const i = y * g.w + x;
        if (mat === MAT.FIRE) {
          g.temp[i] = 700;
          this.thermalIdle = false;
          this.markHot(x, y);
        } else if (mat === MAT.ICE || mat === MAT.SNOW) {
          g.temp[i] = Math.min(g.temp[i], this.ambient[i] - 8);
          this.thermalIdle = false;
          this.markHot(x, y);
        } else if (mat === MAT.STONE || mat === MAT.DIRT || mat === MAT.SAND) {
          g.temp[i] = this.ambient[i];
        }
        g.set(x, y, mat);
        painted++;
      }
    }
    return painted;
  }

  /** Круговой нагрев/охлаждение. */
  heat(cx: number, cy: number, radius: number, delta: number): number {
    const g = this.grid;
    const r = Math.max(0, radius | 0);
    let touched = 0;

    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= g.h) continue;
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= g.w) continue;
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const i = y * g.w + x;
        const t = Math.max(TEMP_MIN, Math.min(TEMP_MAX, g.temp[i] + delta));
        g.temp[i] = t;
        g.touch(x, y);
        this.markHot(x, y);
        touched++;
      }
    }
    if (touched > 0) this.thermalIdle = false;
    return touched;
  }

  /** Изменившиеся с прошлого вызова чанки. Возвращает срез буфера. */
  takeChanged(): Int32Array {
    const n = this.grid.takeChanged(this.changedBuf);
    return this.changedBuf.subarray(0, n);
  }

  stats(): WorldStats {
    const g = this.grid;
    const counts = new Array<number>(MATERIAL_COUNT).fill(0);
    let hot = 0;
    let plants = 0;
    for (let i = 0; i < g.mat.length; i++) {
      const m = g.mat[i];
      counts[m]++;
      const t = g.temp[i];
      const a = this.ambient[i];
      // «Горячие» — это действительно нагретое (огонь, остывающие угли),
      // а не клетки, чуть отклонившиеся от среды на границе биомов.
      if (t > a + 15 || t < a - 15) hot++;
      if (
        m === MAT.GRASS ||
        m === MAT.LEAVES ||
        m === MAT.SAPLING ||
        m === MAT.SEED ||
        m === MAT.BUSH ||
        m === MAT.FLOWER ||
        m === MAT.MUSHROOM
      ) {
        plants++;
      }
    }
    return {
      tick: this.tick,
      cells: g.mat.length,
      chunks: g.chunkCount,
      counts,
      hotCells: hot,
      plants,
      thermalIdle: this.thermalIdle,
      skyLight: this.skyLight,
      weather: this.weather.kind,
    };
  }

  /** Отпечаток состояния — для проверок детерминизма и «бит в бит». */
  stateHash(): string {
    const g = this.grid;
    const parts = [
      new Uint8Array(g.mat.buffer, g.mat.byteOffset, g.mat.byteLength),
      new Uint8Array(g.flags.buffer, g.flags.byteOffset, g.flags.byteLength),
      i16Bytes(g.temp),
      u16Bytes(g.aux),
      new Uint8Array(g.light.buffer, g.light.byteOffset, g.light.byteLength),
      i16Bytes(this.ambient),
    ];
    let total = 0;
    for (const p of parts) total += p.length;
    const joined = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      joined.set(p, o);
      o += p.length;
    }
    return hashBytes(joined);
  }

  toSnapshot(): Buffer {
    const g = this.grid;
    return writeSnapshot({
      tick: this.tick,
      seed: this.cfg.seed,
      width: this.cfg.width,
      height: this.cfg.height,
      meta: {
        version: 2,
        ambient: this.cfg.ambient,
        heatEveryTicks: this.cfg.heatEveryTicks,
        lightEveryTicks: this.cfg.lightEveryTicks,
        dayLengthTicks: this.cfg.dayLengthTicks,
        weather: this.cfg.weather,
        weatherKind: this.weather.kind,
        weatherUntil: this.weather.until,
        thermalIdle: this.thermalIdle,
        skyLight: this.skyLight,
        materialCount: MATERIAL_COUNT,
      },
      sections: [
        { id: SEC.MAT, data: new Uint8Array(g.mat.buffer, g.mat.byteOffset, g.mat.byteLength) },
        { id: SEC.FLAGS, data: new Uint8Array(g.flags.buffer, g.flags.byteOffset, g.flags.byteLength) },
        { id: SEC.TEMP, data: i16Bytes(g.temp) },
        { id: SEC.AUX, data: u16Bytes(g.aux) },
        { id: SEC.LIGHT, data: new Uint8Array(g.light.buffer, g.light.byteOffset, g.light.byteLength) },
        { id: SEC.AMBIENT, data: i16Bytes(this.ambient) },
        { id: SEC.RNG, data: u32Bytes(this.rng.state()) },
        { id: SEC.DIRTY, data: g.dirtyNextBytes() },
      ],
    });
  }

  static fromSnapshot(buf: Buffer): World {
    const snap = readSnapshot(buf);
    const storedCount = snap.meta.materialCount;
    if (typeof storedCount === 'number' && storedCount !== MATERIAL_COUNT) {
      throw new Error(
        `снапшот сделан для ${storedCount} веществ, а в мире их ${MATERIAL_COUNT} — загружать нельзя`,
      );
    }

    const cfg: WorldConfig = {
      width: snap.width,
      height: snap.height,
      seed: snap.seed,
      ambient: numMeta(snap.meta.ambient, 20),
      heatEveryTicks: numMeta(snap.meta.heatEveryTicks, 4),
      lightEveryTicks: numMeta(snap.meta.lightEveryTicks, 4),
      dayLengthTicks: numMeta(snap.meta.dayLengthTicks, 4800),
      weather: snap.meta.weather === true,
    };
    const w = new World(cfg);
    w.tick = snap.tick;
    w.thermalIdle = snap.meta.thermalIdle === true;
    w.skyLight = numMeta(snap.meta.skyLight, 255);
    w.weather = {
      kind: numMeta(snap.meta.weatherKind, WEATHER.CLEAR),
      until: numMeta(snap.meta.weatherUntil, 0),
    };

    const g = w.grid;
    for (const section of snap.sections) {
      switch (section.id) {
        case SEC.MAT:
          g.mat.set(section.data.subarray(0, g.mat.length));
          break;
        case SEC.FLAGS:
          g.flags.set(section.data.subarray(0, g.flags.length));
          break;
        case SEC.TEMP:
          g.temp.set(i16FromBytes(section.data).subarray(0, g.temp.length));
          break;
        case SEC.AUX:
          g.aux.set(u16FromBytes(section.data).subarray(0, g.aux.length));
          break;
        case SEC.LIGHT:
          g.light.set(section.data.subarray(0, g.light.length));
          break;
        case SEC.AMBIENT:
          w.ambient.set(i16FromBytes(section.data).subarray(0, w.ambient.length));
          break;
        case SEC.RNG:
          w.rng.restore(u32FromBytes(section.data));
          break;
        case SEC.DIRTY:
          g.restoreDirtyNext(section.data);
          break;
        default:
          break;
      }
    }

    // После загрузки неизвестно, какие чанки были горячими: если мир не
    // в тепловом покое, честнее один раз пересчитать всё.
    if (!w.thermalIdle) w.hotChunks.fill(1);

    // Намеренно НЕ помечаем весь мир грязным: набор грязных чанков — часть
    // состояния (см. Grid.dirtyNextBytes), иначе продолжение после загрузки
    // разошлось бы с непрерывным прогоном.
    return w;
  }

  /** Справочник для интерфейса наблюдателя. */
  static materialList(): Array<{ id: number; key: string; name: string; color: [number, number, number] }> {
    return MATERIALS.map((m) => ({ id: m.id, key: m.key, name: m.name, color: m.color }));
  }
}

function numMeta(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export { CHUNK };
