/**
 * Сервер симуляции.
 *
 * Это авторитетный процесс: мир живёт здесь, а браузер — только окно
 * (инвариант И1). Сервер можно перезапустить, он поднимется из снапшота
 * и продолжит с того же тика — для существа это сон, а не смерть.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { Clock, RateMeter } from '../../core/src/clock.ts';
import { World } from '../../world/src/world.ts';
import { generateTerrain } from '../../world/src/terrain.ts';
import { MATERIALS } from '../../world/src/materials.ts';
import { loadConfig, ROOT } from './config.ts';
import type { Config } from './config.ts';
import { encodeKeyframe, encodeNoChange, encodePatch } from './frame.ts';
import { ROUTES, activeRoutes, routeKey } from './routes.ts';
import type { HttpMethod } from './routes.ts';

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;

interface FrameRingEntry {
  tick: number;
  chunks: Int32Array;
}

interface Sim {
  world: World;
  /** Буфер под список изменившихся чанков. */
  changedBuf: Int32Array;
  /** История изменений за последние кадры — чтобы отдать патч «с такого-то тика». */
  ring: FrameRingEntry[];
  /** Самый старый тик, доступный в кольце. */
  ringStartTick: number;
  /** Метки уже отправленных чанков (без очистки, через штамп). */
  seen: Int32Array;
  stamp: number;
  paused: boolean;
  pendingSteps: number;
  startedAtMs: number;
}

const cfg: Config = loadConfig();
const clock = new Clock(1000 / cfg.world.tickHz, cfg.server.maxTicksPerFrame);
const meter = new RateMeter(2000);

const sim: Sim = {
  world: new World({
    width: cfg.world.width,
    height: cfg.world.height,
    seed: cfg.world.seed,
    ambient: cfg.world.ambient,
    heatEveryTicks: cfg.world.heatEveryTicks,
    lightEveryTicks: cfg.world.lightEveryTicks,
    dayLengthTicks: cfg.world.dayLengthTicks,
    weather: cfg.world.weather,
  }),
  changedBuf: new Int32Array(0),
  ring: [],
  ringStartTick: 0,
  seen: new Int32Array(0),
  stamp: 0,
  paused: false,
  pendingSteps: 0,
  startedAtMs: Date.now(),
};

function resetScratch(): void {
  const chunks = sim.world.grid.chunkCount;
  sim.changedBuf = new Int32Array(chunks);
  sim.seen = new Int32Array(chunks);
  sim.stamp = 0;
}

generateTerrain(sim.world);
resetScratch();

// ---------------------------------------------------------------- цикл времени

function recordFrame(): void {
  const n = sim.world.grid.takeChanged(sim.changedBuf);
  sim.ring.push({ tick: sim.world.tick, chunks: sim.changedBuf.slice(0, n) });
  while (sim.ring.length > cfg.server.frameRingTicks) {
    sim.ring.shift();
  }
  sim.ringStartTick = sim.ring.length > 0 ? sim.ring[0].tick : sim.world.tick;
}

function advanceTime(): void {
  const now = performance.now();
  let steps = 0;

  if (sim.paused) {
    clock.reset();
    if (sim.pendingSteps > 0) {
      steps = sim.pendingSteps;
      sim.pendingSteps = 0;
    } else {
      return;
    }
  } else {
    steps = clock.pending(now - lastFrameMs);
  }
  lastFrameMs = now;

  for (let k = 0; k < steps; k++) {
    sim.world.tickOnce();
    recordFrame();
    clock.markTick(performance.now());
    meter.push(performance.now());
  }
}

let lastFrameMs = performance.now();
const loop = setInterval(advanceTime, 4);

// ---------------------------------------------------------------- снапшоты

function snapshotDir(): string {
  const dir = resolve(ROOT, cfg.snapshot.dir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function listSnapshots(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('snap-') && f.endsWith('.vvs'))
    .map((f) => join(dir, f))
    .sort();
}

/**
 * Ротация: держим последние 120 снапшотов. Часовые и суточные уровни
 * появятся в Ф4 вместе с переездом на VPS (см. §14 PLAN.md).
 */
function rotateSnapshots(dir: string, keep = 120): void {
  const files = listSnapshots(dir);
  for (let i = 0; i < files.length - keep; i++) {
    try {
      unlinkSync(files[i]);
    } catch {
      // файл мог исчезнуть между листингом и удалением — не повод падать
    }
  }
}

function saveSnapshot(tag = ''): { file: string; bytes: number } {
  const dir = snapshotDir();
  const name = `snap-${String(sim.world.tick).padStart(10, '0')}${tag}.vvs`;
  const file = join(dir, name);
  const buf = sim.world.toSnapshot();
  writeFileSync(file, buf);
  rotateSnapshots(dir);
  return { file, bytes: buf.length };
}

function loadLatestSnapshot(): { file: string; tick: number } | null {
  const files = listSnapshots(snapshotDir());
  if (files.length === 0) return null;
  const file = files[files.length - 1];
  loadSnapshotFile(file);
  return { file, tick: sim.world.tick };
}

function loadSnapshotFile(file: string): void {
  const buf = readFileSync(file);
  sim.world = World.fromSnapshot(buf);
  sim.ring = [];
  sim.ringStartTick = sim.world.tick;
  resetScratch();
}

const autosave = setInterval(() => {
  if (cfg.snapshot.intervalSec <= 0) return;
  try {
    saveSnapshot();
  } catch (err) {
    console.error('[thing] не удалось сохранить снапшот:', (err as Error).message);
  }
}, Math.max(1, cfg.snapshot.intervalSec) * 1000);

// ---------------------------------------------------------------- утилиты HTTP

function send(res: ServerResponse, status: number, type: string, body: Buffer | string): void {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.writeHead(status, {
    'content-type': type,
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 1_000_000) throw new Error('тело запроса слишком большое');
    chunks.push(buf);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function intFrom(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// ---------------------------------------------------------------- обработчики

const handlers = new Map<string, Handler>();

function on(method: HttpMethod, path: string, handler: Handler): void {
  handlers.set(routeKey({ method, path }), handler);
}

on('GET', '/api/meta', (_req, res) => {
  sendJson(res, {
    tick: sim.world.tick,
    width: sim.world.grid.w,
    height: sim.world.grid.h,
    chunk: 16,
    chunkCols: sim.world.grid.cols,
    chunkRows: sim.world.grid.rows,
    paused: sim.paused,
    tickHz: cfg.world.tickHz,
    tps: Number(meter.rate.toFixed(1)),
    droppedTicks: clock.dropped,
    thermalIdle: sim.world.thermalIdle,
    skyLight: sim.world.skyLight,
    timeOfDay: Number(sim.world.timeOfDay.toFixed(4)),
    dayLengthTicks: cfg.world.dayLengthTicks,
    weather: sim.world.weather.kind,
    weatherUntil: sim.world.weather.until,
    debugTools: cfg.debug.tools,
    uptimeSec: Math.floor((Date.now() - sim.startedAtMs) / 1000),
  });
});

on('GET', '/api/materials', (_req, res) => {
  sendJson(res, {
    materials: MATERIALS.map((m) => ({
      id: m.id,
      key: m.key,
      name: m.name,
      color: m.color,
      variance: m.variance,
      state: m.state,
    })),
  });
});

on('GET', '/api/stats', (_req, res) => {
  const s = sim.world.stats();
  const byMaterial: Record<string, number> = {};
  for (const m of MATERIALS) byMaterial[m.key] = s.counts[m.id] ?? 0;
  sendJson(res, {
    tick: s.tick,
    cells: s.cells,
    chunks: s.chunks,
    hotCells: s.hotCells,
    thermalIdle: s.thermalIdle,
    byMaterial,
  });
});

on('GET', '/api/frame', (_req, res, url) => {
  const raw = url.searchParams.get('raw') === '1';
  const sinceParam = url.searchParams.get('since');
  const since = sinceParam === null ? Number.NaN : Number(sinceParam);
  const world = sim.world;
  const chunkCount = world.grid.chunkCount;

  if (!Number.isFinite(since) || sim.ring.length === 0 || since < sim.ringStartTick - 1) {
    send(res, 200, 'application/octet-stream', encodeKeyframe(world, !raw));
    return;
  }

  if (since >= world.tick) {
    send(res, 200, 'application/octet-stream', encodeNoChange(world.tick, world.grid.w, world.grid.h));
    return;
  }

  sim.stamp++;
  const stamp = sim.stamp;
  const list: number[] = [];
  for (const entry of sim.ring) {
    if (entry.tick <= since) continue;
    const chunks = entry.chunks;
    for (let k = 0; k < chunks.length; k++) {
      const c = chunks[k];
      if (sim.seen[c] !== stamp) {
        sim.seen[c] = stamp;
        list.push(c);
      }
    }
  }

  if (list.length === 0) {
    send(res, 200, 'application/octet-stream', encodeNoChange(world.tick, world.grid.w, world.grid.h));
    return;
  }

  // Если изменилось больше половины мира — патч окажется больше кейфрейма.
  if (list.length > chunkCount * 0.5) {
    send(res, 200, 'application/octet-stream', encodeKeyframe(world, !raw));
    return;
  }

  send(res, 200, 'application/octet-stream', encodePatch(world, list, !raw));
});

on('GET', '/api/snapshot.vvs', (_req, res) => {
  const buf = sim.world.toSnapshot();
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': buf.length,
    'content-disposition': `attachment; filename="thing-tick-${sim.world.tick}.vvs"`,
    'cache-control': 'no-store',
  });
  res.end(buf);
});

on('POST', '/api/pause', (_req, res) => {
  sim.paused = true;
  sendJson(res, { ok: true, paused: true, tick: sim.world.tick });
});

on('POST', '/api/resume', (_req, res) => {
  sim.paused = false;
  lastFrameMs = performance.now();
  clock.reset();
  sendJson(res, { ok: true, paused: false, tick: sim.world.tick });
});

on('POST', '/api/step', async (req, res) => {
  const body = await readJson(req);
  const n = Math.max(1, Math.min(600, intFrom(body.n, 1)));
  sim.pendingSteps += n;
  sendJson(res, { ok: true, steps: n, tick: sim.world.tick });
});

on('POST', '/api/snapshot', (_req, res) => {
  const { file, bytes } = saveSnapshot();
  sendJson(res, { ok: true, file, bytes, tick: sim.world.tick });
});

on('POST', '/api/load', async (req, res) => {
  const body = await readJson(req);
  const file = typeof body.file === 'string' ? body.file : null;
  if (file) {
    loadSnapshotFile(file);
    sendJson(res, { ok: true, file, tick: sim.world.tick });
    return;
  }
  const loaded = loadLatestSnapshot();
  if (!loaded) {
    sendJson(res, { ok: false, error: 'снапшотов нет' }, 404);
    return;
  }
  sendJson(res, { ok: true, file: loaded.file, tick: loaded.tick });
});

/** Точки из тела запроса: либо {x,y}, либо {points:[{x,y},…]} одной кистью. */
function pointsFrom(body: Record<string, unknown>): Array<{ x: number; y: number }> {
  if (Array.isArray(body.points)) {
    return body.points.map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return { x: intFrom(o.x, -1), y: intFrom(o.y, -1) };
    });
  }
  return [{ x: intFrom(body.x, -1), y: intFrom(body.y, -1) }];
}

on('POST', '/api/paint', async (req, res) => {
  const body = await readJson(req);
  const r = Math.max(0, Math.min(64, intFrom(body.r, 3)));
  const mat = intFrom(body.mat, 0);
  if (mat < 0 || mat >= MATERIALS.length) {
    sendJson(res, { ok: false, error: 'нет такого вещества' }, 400);
    return;
  }
  let painted = 0;
  for (const p of pointsFrom(body)) painted += sim.world.paint(p.x, p.y, r, mat);
  sendJson(res, { ok: true, painted, tick: sim.world.tick });
});

on('POST', '/api/heat', async (req, res) => {
  const body = await readJson(req);
  const r = Math.max(0, Math.min(64, intFrom(body.r, 4)));
  const delta = Math.max(-2000, Math.min(2000, intFrom(body.delta, 100)));
  let touched = 0;
  for (const p of pointsFrom(body)) touched += sim.world.heat(p.x, p.y, r, delta);
  sendJson(res, { ok: true, touched, tick: sim.world.tick });
});

on('GET', '/health', (_req, res) => {
  sendJson(res, {
    ok: true,
    tick: sim.world.tick,
    tps: Number(meter.rate.toFixed(1)),
    paused: sim.paused,
    uptimeSec: Math.floor((Date.now() - sim.startedAtMs) / 1000),
  });
});

// ------------------------------------------------------- проверка связности

function assertRoutesWired(): void {
  const debug = cfg.debug.tools;
  const active = new Set(activeRoutes(debug).map(routeKey));
  const all = new Set(ROUTES.map(routeKey));

  for (const key of active) {
    if (!handlers.has(key)) throw new Error(`маршрут ${key} объявлен, но обработчика нет`);
  }
  for (const key of handlers.keys()) {
    if (!all.has(key)) throw new Error(`обработчик ${key} не объявлен в реестре маршрутов`);
  }
}

assertRoutesWired();

// ---------------------------------------------------------------- статика

const WEB_DIR = resolve(ROOT, 'packages/web');
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(res: ServerResponse, pathname: string): boolean {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = resolve(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR)) return false;
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
  send(res, 200, type, readFileSync(file));
  return true;
}

// ---------------------------------------------------------------- сервер

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const method = (req.method ?? 'GET').toUpperCase() as HttpMethod;
      const key = routeKey({ method, path: url.pathname });
      const handler = handlers.get(key);

      if (handler) {
        const isActive = activeRoutes(cfg.debug.tools).some((r) => routeKey(r) === key);
        if (!isActive) {
          sendJson(res, { ok: false, error: 'маршрут отключён: debug.tools = false' }, 403);
          return;
        }
        await handler(req, res, url);
        return;
      }

      if (method === 'GET' && serveStatic(res, url.pathname)) return;

      sendJson(res, { ok: false, error: 'не найдено' }, 404);
    } catch (err) {
      console.error('[thing] ошибка обработки запроса:', err);
      if (!res.headersSent) sendJson(res, { ok: false, error: (err as Error).message }, 500);
    }
  })();
});

server.listen(cfg.server.port, cfg.server.host, () => {
  const url = `http://${cfg.server.host}:${cfg.server.port}/`;
  console.log(`[thing] наблюдатель: ${url}`);
  console.log(`[thing] мир ${cfg.world.width}×${cfg.world.height}, seed ${cfg.world.seed}, ${cfg.world.tickHz} Гц`);
  console.log(`[thing] отладочные инструменты: ${cfg.debug.tools ? 'включены' : 'выключены'}`);
  console.log(`[thing] снапшоты: ${snapshotDir()} каждые ${cfg.snapshot.intervalSec} с`);
});

function shutdown(signal: string): void {
  console.log(`[thing] ${signal}: сохраняю снапшот и останавливаюсь`);
  clearInterval(loop);
  clearInterval(autosave);
  try {
    const { file } = saveSnapshot('-stop');
    console.log(`[thing] снапшот: ${file}`);
  } catch (err) {
    console.error('[thing] снапшот не сохранён:', (err as Error).message);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
