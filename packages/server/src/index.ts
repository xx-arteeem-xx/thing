/**
 * Сервер симуляции.
 *
 * Это авторитетный процесс: мир живёт здесь, а браузер — только окно
 * (инвариант И1). Сервер можно перезапустить, он поднимется из снапшота
 * и продолжит с того же тика — для существа это сон, а не смерть.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { Clock, RateMeter } from '../../core/src/clock.ts';
import { World } from '../../world/src/world.ts';
import { generateTerrain } from '../../world/src/terrain.ts';
import { MATERIALS } from '../../world/src/materials.ts';
import { SPECIES_LIST } from '../../world/src/fauna.ts';
import { WEATHER, WEATHER_NAME } from '../../world/src/sim.ts';
import { Creature } from '../../body/src/creature.ts';
import { ReflexPolicy } from '../../brain-reflex/src/policy.ts';
import { Reward } from '../../brain-reflex/src/reward.ts';
import { Learner } from '../../brain-reflex/src/learn.ts';
import { WeightGuard } from '../../brain-reflex/src/guard.ts';
import { describe, sense, think } from '../../brain-language/src/interoception.ts';
import { SEGMENTS } from '../../body/src/body.ts';
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

/** Собрать мир по конфигу: тем же составом, что и при запуске. */
function makeWorld(): World {
  return new World({
    width: cfg.world.width,
    height: cfg.world.height,
    seed: cfg.world.seed,
    ambient: cfg.world.ambient,
    heatEveryTicks: cfg.world.heatEveryTicks,
    lightEveryTicks: cfg.world.lightEveryTicks,
    dayLengthTicks: cfg.world.dayLengthTicks,
    weather: cfg.world.weather,
    maxWaterCells: cfg.world.maxWaterCells,
    journalFile: resolve(ROOT, cfg.journal.file),
  });
}

const sim: Sim = {
  world: makeWorld(),
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

/**
 * Просыпаться, а не рождаться заново.
 *
 * Если в папке снапшотов что-то есть, мир продолжается с последнего
 * сохранения. Для существа перезапуск сервера — это сон, а не смерть
 * (см. §14 плана). Переменная THING_FRESH=1 заставляет начать заново.
 */
let policy = new ReflexPolicy();
let reward = new Reward();
let learner = new Learner();
let guard = new WeightGuard();
const freshRequested = process.env.THING_FRESH === '1';
let resumedFrom: string | null = null;

if (!freshRequested) {
  try {
    const loaded = loadLatestSnapshot();
    if (loaded !== null) resumedFrom = loaded.file;
  } catch (err) {
    console.error('[thing] снапшот не прочитан, начинаю новый мир:', (err as Error).message);
  }
}

if (resumedFrom === null) {
  generateTerrain(sim.world);
  // Рождаем там, где есть и еда, и вода: иначе первая же жизнь кончается
  // жаждой, и учиться ему не на чем.
  const spot = sim.world.findSurfaceSpot(undefined, { nearWater: 40 });
  sim.world.creature = new Creature(spot.x, spot.y, 1, 0);
}
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
    // Отладочный привод: пока мозга нет, существом можно поуправлять руками.
    const c = sim.world.creature;
    if (c !== null && c.canAct) {
      // Жизненные действия: пить, есть, искать. Они задают направление
      // шага, а позу ведёт рефлекторный контур.
      const want = policy.survival(sim.world, c);
      c.drinking = want.drinking;
      c.eating = want.eating;
      if (want.dir !== 0) {
        gaitPhase += 0.16 * want.dir;
        c.walk(gaitPhase);
      } else {
        gaitPhase += 0.16;
        c.walk(gaitPhase);
      }
      if (walking !== 0) {
        gaitPhase += 0.16 * walking;
        c.walk(gaitPhase);
      } else {
        // Рефлекторный контур: датчики → врождённые рефлексы и сеть → мышцы.
        policy.act(sim.world, c, sim.world.tick * 0.16);
        if (sim.world.tick % 30 === 0) recordThought(sim.world, c);
        // Награда считается здесь же и тут же идёт в обучение: никакого
        // отдельного «сеанса тренировки» — существо учится, пока живёт.
        reward.setAge(sim.world.tick - c.bornTick);
        const parts = reward.step(c, policy.sensors, 0, sim.world.journal.total, 1 / 60);
        if (learner.observe(policy, parts.total)) {
          guard.observe(policy, learner.lastMeanReward);
        }
      }
    }
    sim.world.tickOnce();
    recordFrame();
    clock.markTick(performance.now());
    meter.push(performance.now());
  }
}

/** Направление отладочной ходьбы: -1 влево, 0 стоять, 1 вправо. */
let walking = 0;
let gaitPhase = 0;

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
  // Мозг кладём в тело перед сохранением: он часть существа.
  const alive = sim.world.creature;
  if (alive !== null) alive.brain = policy.toBytes();
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
  // Подхватываем мозг, если он был сохранён вместе с телом.
  const brain = sim.world.creature?.brain ?? null;
  if (brain !== null) policy = ReflexPolicy.fromBytes(brain);
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
    creatureAlive: sim.world.creature?.alive ?? false,
    creatureGeneration: sim.world.creature?.generation ?? 0,
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

on('POST', '/api/muscle', async (req, res) => {
  const c = sim.world.creature;
  if (c === null || !c.canAct) {
    sendJson(res, { ok: false, error: 'существо не может двигаться' }, 409);
    return;
  }
  const body = await readJson(req);
  const strength = intFrom(body.strength, -1);
  if (strength >= 0) c.body.muscleStrength = Math.min(1, strength / 100);
  const joints = Array.isArray(body.joints) ? body.joints : [];
  for (const j of joints) {
    const o = (j ?? {}) as Record<string, unknown>;
    c.body.setJoint(intFrom(o.index, -1), Number(o.angle ?? 0));
  }
  sendJson(res, { ok: true, angles: Array.from(c.body.targetAngle) });
});

on('POST', '/api/walk', (req, res, url) => {
  const c = sim.world.creature;
  if (c === null || !c.canAct) {
    sendJson(res, { ok: false, error: 'существо не может двигаться' }, 409);
    return;
  }
  const dir = url.searchParams.get('dir');
  walking = dir === 'stop' ? 0 : dir === '-1' ? -1 : 1;
  sendJson(res, { ok: true, walking });
});

on('GET', '/api/creature', (_req, res) => {
  const c = sim.world.creature;
  if (c === null) {
    sendJson(res, { ok: false, error: 'существа нет' }, 404);
    return;
  }
  sendJson(res, {
    ok: true,
    alive: c.alive,
    generation: c.generation,
    bornTick: c.bornTick,
    deathTick: c.deathTick,
    ageTicks: (c.alive ? sim.world.tick : c.deathTick) - c.bornTick,
    physiology: {
      blood: c.physiology.blood,
      oxygen: c.physiology.oxygen,
      glucose: c.physiology.glucose,
      hydration: c.physiology.hydration,
      coreTemp: c.physiology.coreTemp,
      heartRate: c.physiology.heartRate,
      pain: c.physiology.painLevel,
      fear: c.physiology.fear,
      conscious: c.physiology.conscious,
      hunger: c.physiology.hunger,
      thirst: c.physiology.thirst,
      fatigue: c.physiology.fatigue,
      summary: c.physiology.summary(),
    },
    body: c.frameState(),
    // Сегменты нужны интерфейсу, чтобы нарисовать существо целиком.
    segments: SEGMENTS.map((seg) => ({
      x: Number(c.body.x[seg.id].toFixed(2)),
      y: Number(c.body.y[seg.id].toFixed(2)),
      name: seg.key,
    })),
    // Мысль существа по-английски: то, ради чего всё затевалось.
    thought: think(sense(sim.world, c)),
    innerState: describe(sense(sim.world, c)),
    muscles: Array.from(c.body.targetAngle).map((a) => Number(a.toFixed(3))),
    walking,
    reflex: policy.lastReflex,
    policySteps: policy.steps,
    brain: {
      parameters: ReflexPolicy.parameterCount(),
      updates: learner.updates,
      baseline: Number(learner.baselineValue.toFixed(3)),
      lastMeanReward: Number(learner.lastMeanReward.toFixed(3)),
      rewardStd: Number(learner.lastStd.toFixed(3)),
      visitedStates: reward.visitedStates,
      totalReward: Number(reward.total.toFixed(1)),
      discoveries: reward.discoveries,
      rollbacks: guard.rollbacks,
      noveltyScale: Number(reward.noveltyScale.toFixed(3)),
      safetyScale: Number(reward.safetyScale.toFixed(3)),
      bestReward: Number.isFinite(guard.bestReward) ? Number(guard.bestReward.toFixed(3)) : null,
    },
    autopsy: c.alive ? null : c.autopsy(),
  });
});

/**
 * Воскрешение.
 *
 * Единственная игровая сила наблюдателя и единственное место во всём
 * проекте, где существо возвращается к жизни. Живёт в сервере, за
 * пределами мира: из симуляции к этой функции пути нет (инвариант И7).
 */
on('POST', '/api/revive', (_req, res) => {
  const previous = sim.world.creature;
  const autopsy = previous !== null && !previous.alive ? previous.autopsy() : null;
  const generation = previous === null ? 1 : previous.generation + (previous.alive ? 0 : 1);
  const spot = sim.world.findSurfaceSpot(undefined, { nearWater: 40 });
  sim.world.creature = new Creature(spot.x, spot.y, generation, sim.world.tick);
  // Знание переходит в новую жизнь, память о ней — нет: веса остаются,
  // а накопленное за эпизод забывается.
  learner.reset();
  sim.ring.length = 0;
  sim.ringStartTick = sim.world.tick;
  sendJson(res, {
    ok: true,
    generation,
    spot,
    previousLife: autopsy,
    tick: sim.world.tick,
  });
});

/**
 * Дневник: каждая новая мысль существа с тиком и состоянием тела.
 *
 * Это одновременно и «история жизни» для наблюдателя, и заготовка
 * датасета для языкового контура из Ф3: чтобы существо научилось
 * говорить о себе, нужны тысячи строк «состояние → слова».
 */
const thoughtsFile = join(snapshotDir(), '..', 'thoughts.jsonl');
let lastThought = '';
let thoughtCount = 0;

function recordThought(world: World, c: Creature): void {
  const s = sense(world, c);
  const text = think(s);
  if (text === lastThought) return;
  lastThought = text;
  thoughtCount++;
  const line = JSON.stringify({
    tick: world.tick,
    generation: c.generation,
    alive: c.alive,
    thought: text,
    state: describe(s),
    facts: s,
    drives: {
      hunger: Number(c.physiology.hunger.toFixed(3)),
      thirst: Number(c.physiology.thirst.toFixed(3)),
      fatigue: Number(c.physiology.fatigue.toFixed(3)),
      pain: Number(c.physiology.painLevel.toFixed(3)),
      fear: Number(c.physiology.fear.toFixed(3)),
    },
  });
  try {
    appendFileSync(thoughtsFile, line + '\n');
  } catch {
    /* дневник не критичен для жизни мира */
  }
  if (world.journal.total > 0) return;
}

on('GET', '/api/thoughts', (req, res, url) => {
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 60)));
  if (!existsSync(thoughtsFile)) {
    sendJson(res, { ok: true, total: thoughtCount, lines: [] });
    return;
  }
  const all = readFileSync(thoughtsFile, 'utf8').split('\n').filter((l: string) => l.trim().length > 0);
  const lines = all.slice(-limit).map((l: string) => {
    try {
      return JSON.parse(l) as Record<string, unknown>;
    } catch {
      return { raw: l };
    }
  });
  sendJson(res, { ok: true, total: all.length, lines });
});

/**
 * Силы наблюдателя.
 *
 * Их ровно четыре, и все — про жизнь, а не про карту: создать существо
 * взамен погибшего, вернуть мир к исходному состоянию, создать живых
 * организмов и сменить погоду. Редактировать рельеф и вещества нельзя:
 * мир должен жить сам.
 */

// Вернуть мир к исходному состоянию: тот же seed, тот же рельеф.
on('POST', '/api/world/reset', (_req, res) => {
  sim.world = makeWorld();
  generateTerrain(sim.world);
  const spot = sim.world.findSurfaceSpot(undefined, { nearWater: 40 });
  sim.world.creature = new Creature(spot.x, spot.y, 1, 0);
  policy = new ReflexPolicy();
  reward = new Reward();
  learner = new Learner();
  guard = new WeightGuard();
  lastThought = '';
  sim.ring.length = 0;
  sim.ringStartTick = 0;
  try {
    writeFileSync(thoughtsFile, '');
  } catch {
    /* дневник можно начать заново и позже */
  }
  sendJson(res, { ok: true, tick: 0, spot });
});

// Создать живых организмов: только тех, что уже есть в мире.
on('POST', '/api/fauna/spawn', async (req, res) => {
  const body = await readJson(req);
  const key = String(body.species ?? 'rabbit');
  const def = SPECIES_LIST.find((sp) => sp.key === key);
  if (!def) {
    sendJson(res, { ok: false, error: `неизвестный вид: ${key}` }, 400);
    return;
  }
  const count = Math.max(1, Math.min(20, Number(body.count ?? 1)));
  const spot = sim.world.findSurfaceSpot(undefined, def.aquatic ? { nearWater: 60 } : {});
  let made = 0;
  for (let k = 0; k < count; k++) {
    // Расселяем вокруг выбранного места, чтобы они не слиплись в точку.
    const x = Math.max(1, Math.min(sim.world.grid.w - 2, spot.x + Math.round((k - count / 2) * 2)));
    const y = spot.y + (def.aquatic ? 3 : 4);
    if (sim.world.fauna.spawn(def.id, x, y, 160) >= 0) made++;
  }
  sendJson(res, { ok: true, species: def.key, name: def.name, spawned: made, at: spot });
});

// Сменить погоду. Время выбирает мир, наблюдатель задаёт только вид.
on('POST', '/api/weather', async (req, res) => {
  const body = await readJson(req);
  const key = String(body.kind ?? 'clear');
  const kinds: Record<string, number> = { clear: WEATHER.CLEAR, rain: WEATHER.RAIN, snow: WEATHER.SNOW, storm: WEATHER.STORM };
  const kind = kinds[key];
  if (kind === undefined) {
    sendJson(res, { ok: false, error: `неизвестная погода: ${key}` }, 400);
    return;
  }
  const weather = sim.world.weather;
  weather.kind = kind;
  weather.until = sim.world.tick + Math.max(600, Number(body.ticks ?? 2400));
  sendJson(res, { ok: true, kind, name: WEATHER_NAME[kind], until: weather.until });
});

on('GET', '/api/species', (_req, res) => {
  sendJson(res, {
    species: SPECIES_LIST.map((s) => ({
      id: s.id,
      key: s.key,
      name: s.name,
      color: s.color,
      size: s.size,
      aquatic: s.aquatic,
      aggression: s.aggression,
      diet: s.diet,
      maxCount: s.maxCount,
    })),
    alive: SPECIES_LIST.map((s) => ({
      id: s.id,
      key: s.key,
      count: sim.world.fauna.countOf(s.id),
    })),
  });
});

on('GET', '/api/journal', (_req, res) => {
  sendJson(res, {
    total: sim.world.journal.total,
    discoveries: sim.world.journal.recent(80),
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
    plants: s.plants,
    thermalIdle: s.thermalIdle,
    skyLight: s.skyLight,
    weather: s.weather,
    fauna: s.fauna,
    discoveries: sim.world.journal.total,
    byMaterial,
    bySpecies: (() => {
      const out: Record<string, number> = {};
      for (const sp of SPECIES_LIST) out[sp.key] = sim.world.fauna.countOf(sp.id);
      return out;
    })(),
    faunaEvents: {
      born: sim.world.fauna.born,
      died: sim.world.fauna.died,
      eaten: sim.world.fauna.eaten,
      drowned: sim.world.fauna.drowned,
      burned: sim.world.fauna.diedFire,
      old: sim.world.fauna.diedOld,
    },
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
    send(res, 200, 'application/octet-stream', encodeNoChange(world));
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
    send(res, 200, 'application/octet-stream', encodeNoChange(world));
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
