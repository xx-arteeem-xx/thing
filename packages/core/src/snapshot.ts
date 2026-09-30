/**
 * Контейнер снапшота VVS1.
 *
 * Задача: сохранить состояние мира так, чтобы после восстановления
 * симуляция продолжилась ровно с того же места — бит в бит.
 * Поэтому секции хранятся как сырые байты массивов (с необязательным
 * сжатием), а не как JSON с потерями.
 *
 * Раскладка файла:
 *   u32 magic 'VVS1' | u16 version | u16 flags
 *   u32 tick | u32 seed | u16 width | u16 height
 *   u32 metaLen | meta (utf8 JSON)
 *   u32 sectionCount
 *   [ u16 id | u8 encoding | u32 rawLen | u32 storedLen | bytes ] *
 *
 * encoding: 0 — как есть, 1 — deflate.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const SNAP_MAGIC = 0x31535656; // 'VVS1' в little-endian
export const SNAP_VERSION = 1;

export const ENC_RAW = 0;
export const ENC_DEFLATE = 1;

export interface SnapshotSection {
  id: number;
  data: Uint8Array;
}

export interface Snapshot {
  tick: number;
  seed: number;
  width: number;
  height: number;
  meta: Record<string, unknown>;
  sections: SnapshotSection[];
}

/** Идентификаторы секций. */
export const SEC = {
  META: 1,
  MAT: 2,
  FLAGS: 3,
  TEMP: 4,
  AUX: 5,
  RNG: 6,
  BODY: 7,
  PHYSIO: 8,
  POLICY: 9,
  EVENTS: 10,
  DIRTY: 11,
  LIGHT: 12,
  AMBIENT: 13,
  FAUNA: 14,
} as const;

function i16Bytes(values: Int16Array): Uint8Array {
  // Копия через буфер: порядок байт фиксируем little-endian вручную,
  // чтобы снапшот не зависел от архитектуры.
  const out = new Uint8Array(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    const v = values[i] & 0xffff;
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = (v >>> 8) & 0xff;
  }
  return out;
}

function i16FromBytes(bytes: Uint8Array): Int16Array {
  const n = bytes.length >> 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
    out[i] = (v << 16) >> 16;
  }
  return out;
}

export { i16Bytes, i16FromBytes };

export function u16Bytes(values: Uint16Array): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    out[i * 2] = values[i] & 0xff;
    out[i * 2 + 1] = (values[i] >>> 8) & 0xff;
  }
  return out;
}

export function u16FromBytes(bytes: Uint8Array): Uint16Array {
  const n = bytes.length >> 1;
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) out[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
  return out;
}

export function u32Bytes(values: Uint32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) view.setUint32(i * 4, values[i], true);
  return out;
}

export function u32FromBytes(bytes: Uint8Array): Uint32Array {
  const n = bytes.length >> 2;
  const out = new Uint32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}

/** Записать снапшот в буфер. Крупные секции сжимаются, если это выгодно. */
export function writeSnapshot(snap: Snapshot): Buffer {
  const metaBytes = Buffer.from(JSON.stringify(snap.meta ?? {}), 'utf8');
  const parts: Buffer[] = [];

  const header = Buffer.alloc(4 + 2 + 2 + 4 + 4 + 2 + 2 + 4);
  let o = 0;
  header.writeUInt32LE(SNAP_MAGIC, o); o += 4;
  header.writeUInt16LE(SNAP_VERSION, o); o += 2;
  header.writeUInt16LE(0, o); o += 2;
  header.writeUInt32LE(snap.tick >>> 0, o); o += 4;
  header.writeUInt32LE(snap.seed >>> 0, o); o += 4;
  header.writeUInt16LE(snap.width, o); o += 2;
  header.writeUInt16LE(snap.height, o); o += 2;
  header.writeUInt32LE(metaBytes.length, o); o += 4;
  parts.push(header, metaBytes);

  const count = Buffer.alloc(4);
  count.writeUInt32LE(snap.sections.length, 0);
  parts.push(count);

  for (const section of snap.sections) {
    const raw = Buffer.from(section.data.buffer, section.data.byteOffset, section.data.byteLength);
    const packed = deflateSync(raw, { level: 6 });
    const useDeflate = packed.length < raw.length;
    const stored = useDeflate ? packed : raw;

    const sh = Buffer.alloc(2 + 1 + 4 + 4);
    sh.writeUInt16LE(section.id, 0);
    sh.writeUInt8(useDeflate ? ENC_DEFLATE : ENC_RAW, 2);
    sh.writeUInt32LE(raw.length, 3);
    sh.writeUInt32LE(stored.length, 7);
    parts.push(sh, stored);
  }

  return Buffer.concat(parts);
}

/** Прочитать снапшот. */
export function readSnapshot(buf: Buffer): Snapshot {
  if (buf.length < 24) throw new Error('снапшот слишком короткий');
  const magic = buf.readUInt32LE(0);
  if (magic !== SNAP_MAGIC) throw new Error(`не тот формат снапшота: 0x${magic.toString(16)}`);
  const version = buf.readUInt16LE(4);
  if (version !== SNAP_VERSION) throw new Error(`версия снапшота ${version} не поддерживается`);

  let o = 6 + 2;
  const tick = buf.readUInt32LE(o); o += 4;
  const seed = buf.readUInt32LE(o); o += 4;
  const width = buf.readUInt16LE(o); o += 2;
  const height = buf.readUInt16LE(o); o += 2;
  const metaLen = buf.readUInt32LE(o); o += 4;
  const meta = JSON.parse(buf.subarray(o, o + metaLen).toString('utf8')) as Record<string, unknown>;
  o += metaLen;

  const count = buf.readUInt32LE(o); o += 4;
  const sections: SnapshotSection[] = [];
  for (let i = 0; i < count; i++) {
    const id = buf.readUInt16LE(o); o += 2;
    const enc = buf.readUInt8(o); o += 1;
    const rawLen = buf.readUInt32LE(o); o += 4;
    const storedLen = buf.readUInt32LE(o); o += 4;
    const stored = buf.subarray(o, o + storedLen);
    o += storedLen;
    let data: Uint8Array;
    if (enc === ENC_DEFLATE) {
      const out = inflateSync(stored);
      if (out.length !== rawLen) throw new Error(`секция ${id}: ожидалось ${rawLen} байт, получено ${out.length}`);
      data = new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    } else {
      data = new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength);
    }
    sections.push({ id, data });
  }

  return { tick, seed, width, height, meta, sections };
}

/** Отпечаток секции — для проверок «восстановилось бит в бит» и версионирования весов. */
export function hashBytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
