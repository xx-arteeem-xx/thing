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
import { stepWorld } from './sim.ts';

export interface WorldConfig {
  width: number;
  height: number;
  seed: number;
  ambient: number;
  heatEveryTicks: number;
}

export interface WorldStats {
  tick: number;
  cells: number;
  chunks: number;
  /** Сколько клеток занято каждым веществом. */
  counts: number[];
  /** Клеток с температурой, отличной от ambient. */
  hotCells: number;
  thermalIdle: boolean;
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

  private changedBuf: Int32Array;

  constructor(cfg: WorldConfig) {
    this.cfg = cfg;
    this.grid = new Grid(cfg.width, cfg.height, cfg.ambient);
    this.rng = new Rng(cfg.seed);
    this.changedBuf = new Int32Array(this.grid.chunkCount);
    this.ambient = new Int16Array(cfg.width * cfg.height);
    this.ambient.fill(cfg.ambient);
  }

  /** Температура среды в клетке. */
  ambientAt(x: number, y: number): number {
    return this.ambient[y * this.grid.w + x];
  }

  tickOnce(): void {
    stepWorld(this);
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
        } else if (mat === MAT.ICE) {
          g.temp[i] = Math.min(g.temp[i], this.ambient[i] - 8);
          this.thermalIdle = false;
        } else if (mat === MAT.STONE) {
          // камень из кисти приходит температурой среды
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
    const ambient = this.cfg.ambient;
    for (let i = 0; i < g.mat.length; i++) {
      counts[g.mat[i]]++;
      const t = g.temp[i];
      if (t > ambient + 1 || t < ambient - 1) hot++;
    }
    return {
      tick: this.tick,
      cells: g.mat.length,
      chunks: g.chunkCount,
      counts,
      hotCells: hot,
      thermalIdle: this.thermalIdle,
    };
  }

  /** Отпечаток состояния — для проверок детерминизма и «бит в бит». */
  stateHash(): string {
    const g = this.grid;
    const mat = new Uint8Array(g.mat.buffer, g.mat.byteOffset, g.mat.byteLength);
    const flags = new Uint8Array(g.flags.buffer, g.flags.byteOffset, g.flags.byteLength);
    const temp = i16Bytes(g.temp);
    const aux = u16Bytes(g.aux);
    const joined = new Uint8Array(mat.length + flags.length + temp.length + aux.length);
    let o = 0;
    joined.set(mat, o);
    o += mat.length;
    joined.set(flags, o);
    o += flags.length;
    joined.set(temp, o);
    o += temp.length;
    joined.set(aux, o);
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
        version: 1,
        ambient: this.cfg.ambient,
        heatEveryTicks: this.cfg.heatEveryTicks,
        thermalIdle: this.thermalIdle,
        materialCount: MATERIAL_COUNT,
      },
      sections: [
        { id: SEC.MAT, data: new Uint8Array(g.mat.buffer, g.mat.byteOffset, g.mat.byteLength) },
        { id: SEC.FLAGS, data: new Uint8Array(g.flags.buffer, g.flags.byteOffset, g.flags.byteLength) },
        { id: SEC.TEMP, data: i16Bytes(g.temp) },
        { id: SEC.AUX, data: u16Bytes(g.aux) },
        { id: SEC.RNG, data: u32Bytes(this.rng.state()) },
        { id: SEC.DIRTY, data: g.dirtyNextBytes() },
      ],
    });
  }

  static fromSnapshot(buf: Buffer): World {
    const snap = readSnapshot(buf);
    const cfg: WorldConfig = {
      width: snap.width,
      height: snap.height,
      seed: snap.seed,
      ambient: typeof snap.meta.ambient === 'number' ? snap.meta.ambient : 20,
      heatEveryTicks: typeof snap.meta.heatEveryTicks === 'number' ? snap.meta.heatEveryTicks : 4,
    };
    const w = new World(cfg);
    w.tick = snap.tick;
    w.thermalIdle = snap.meta.thermalIdle === true;

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

export { CHUNK };
