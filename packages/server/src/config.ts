/**
 * Конфигурация.
 *
 * Инвариант И8: локально и на VPS работает один и тот же код, различия —
 * только в конфиге. Поэтому здесь нет ничего, что зависело бы от площадки,
 * а переменные окружения позволяют переопределить бюджет без правки файлов.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  world: {
    width: number;
    height: number;
    seed: number;
    ambient: number;
    heatEveryTicks: number;
    lightEveryTicks: number;
    dayLengthTicks: number;
    weather: boolean;
    maxWaterCells: number;
    tickHz: number;
  };
  server: {
    host: string;
    port: number;
    frameRingTicks: number;
    maxTicksPerFrame: number;
  };
  debug: {
    tools: boolean;
  };
  snapshot: {
    dir: string;
    intervalSec: number;
  };
  journal: {
    file: string;
  };
}

/** Корень репозитория. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function loadConfig(path = resolve(ROOT, 'config/default.json')): Config {
  const raw = readFileSync(path, 'utf8');
  const cfg = JSON.parse(raw) as Config;
  applyEnv(cfg);
  return cfg;
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function applyEnv(cfg: Config): void {
  const env = process.env;
  cfg.world.width = num(env.THING_WIDTH, cfg.world.width);
  cfg.world.height = num(env.THING_HEIGHT, cfg.world.height);
  cfg.world.seed = num(env.THING_SEED, cfg.world.seed);
  cfg.world.tickHz = num(env.THING_TICK_HZ, cfg.world.tickHz);
  cfg.world.dayLengthTicks = num(env.THING_DAY_TICKS, cfg.world.dayLengthTicks);
  if (env.THING_WEATHER !== undefined) cfg.world.weather = env.THING_WEATHER !== '0';
  cfg.server.host = env.THING_HOST ?? cfg.server.host;
  cfg.server.port = num(env.THING_PORT, cfg.server.port);
  if (env.THING_DEBUG !== undefined) cfg.debug.tools = env.THING_DEBUG === '1' || env.THING_DEBUG === 'true';
  if (env.THING_SNAPSHOT_SEC !== undefined) cfg.snapshot.intervalSec = num(env.THING_SNAPSHOT_SEC, cfg.snapshot.intervalSec);
}
