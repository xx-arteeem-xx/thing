/**
 * Кадры для наблюдателя.
 *
 * Ключевая идея §11.3 плана: не гнать сырые 512×256 каждый кадр. Сервер
 * следит, какие чанки изменились, и отдаёт либо кейфрейм целиком (при
 * подключении или если изменений слишком много), либо патч из чанков.
 *
 * Формат кадра:
 *   u32 magic | u8 version | u8 type | u8 compression | u8 reserved
 *   u32 tick | u16 width | u16 height | u32 payloadLen | payload
 *
 * payload кейфрейма: mat (w*h байт) | temp (w*h*2 байт, i16 LE)
 * payload патча:    u32 chunkCount | [ u16 cx | u16 cy | 256 байт mat | 512 байт temp ] *
 */
import { deflateSync } from 'node:zlib';
import { CHUNK } from '../../world/src/grid.ts';
import type { World } from '../../world/src/world.ts';

export const FRAME_MAGIC = 0x31524656; // 'VFR1'
export const FRAME_VERSION = 1;
export const FRAME_HEADER_BYTES = 20;

export const FT = {
  KEYFRAME: 0,
  PATCH: 1,
  NOCHANGE: 2,
} as const;

export const COMP = {
  RAW: 0,
  ZLIB: 1,
} as const;

const CHUNK_CELLS = CHUNK * CHUNK;
const CHUNK_BYTES = CHUNK_CELLS + CHUNK_CELLS * 2;

function header(
  type: number,
  compression: number,
  tick: number,
  width: number,
  height: number,
  payloadLen: number,
): Buffer {
  const b = Buffer.alloc(FRAME_HEADER_BYTES);
  b.writeUInt32LE(FRAME_MAGIC, 0);
  b.writeUInt8(FRAME_VERSION, 4);
  b.writeUInt8(type, 5);
  b.writeUInt8(compression, 6);
  b.writeUInt8(0, 7);
  b.writeUInt32LE(tick >>> 0, 8);
  b.writeUInt16LE(width, 12);
  b.writeUInt16LE(height, 14);
  b.writeUInt32LE(payloadLen, 16);
  return b;
}

function wrap(
  type: number,
  tick: number,
  width: number,
  height: number,
  payload: Buffer,
  compress: boolean,
): Buffer {
  if (compress) {
    const packed = deflateSync(payload, { level: 3 });
    return Buffer.concat([header(type, COMP.ZLIB, tick, width, height, packed.length), packed]);
  }
  return Buffer.concat([header(type, COMP.RAW, tick, width, height, payload.length), payload]);
}

/** «Ничего не изменилось» — самый частый ответ в спокойном мире. */
export function encodeNoChange(tick: number, width: number, height: number): Buffer {
  return header(FT.NOCHANGE, COMP.RAW, tick, width, height, 0);
}

export function encodeKeyframe(w: World, compress = true): Buffer {
  const g = w.grid;
  const cells = g.w * g.h;
  const payload = Buffer.alloc(cells + cells * 2);

  payload.set(g.mat, 0);

  let o = cells;
  for (let i = 0; i < cells; i++) {
    payload.writeInt16LE(g.temp[i], o);
    o += 2;
  }

  return wrap(FT.KEYFRAME, w.tick, g.w, g.h, payload, compress);
}

export function encodePatch(w: World, chunks: readonly number[], compress = true): Buffer {
  const g = w.grid;
  const count = chunks.length;
  const payload = Buffer.alloc(4 + count * (4 + CHUNK_BYTES));

  payload.writeUInt32LE(count, 0);
  let o = 4;

  for (let k = 0; k < count; k++) {
    const c = chunks[k];
    const cx = c % g.cols;
    const cy = (c / g.cols) | 0;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;

    payload.writeUInt16LE(cx, o);
    payload.writeUInt16LE(cy, o + 2);
    o += 4;

    for (let ly = 0; ly < CHUNK; ly++) {
      const y = y0 + ly;
      if (y >= g.h) {
        o += CHUNK;
        continue;
      }
      const rowBase = y * g.w;
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx;
        payload[o++] = x < g.w ? g.mat[rowBase + x] : 0;
      }
    }

    for (let ly = 0; ly < CHUNK; ly++) {
      const y = y0 + ly;
      if (y >= g.h) {
        o += CHUNK * 2;
        continue;
      }
      const rowBase = y * g.w;
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx;
        payload.writeInt16LE(x < g.w ? g.temp[rowBase + x] : 0, o);
        o += 2;
      }
    }
  }

  return wrap(FT.PATCH, w.tick, g.w, g.h, payload, compress);
}
