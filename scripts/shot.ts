/**
 * Headless-снимок мира в PNG.
 *
 * Проверяет главный инвариант (И1): мир обязан работать без браузера.
 * Заодно это единственный способ посмотреть на симуляцию глазами в тестах
 * и в CI.
 *
 *   node scripts/shot.ts --ticks 900 --out /tmp/world.png
 */
import { writeFileSync } from 'node:fs';
import { encodePng } from '../packages/core/src/png.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { renderRGBA } from '../packages/world/src/render.ts';
import { loadConfig } from '../packages/server/src/config.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const cfg = loadConfig();
const ticks = Number(arg('ticks', '600'));
const out = arg('out', '/tmp/thing-world.png');
const seed = Number(arg('seed', String(cfg.world.seed)));
const width = Number(arg('width', String(cfg.world.width)));
const height = Number(arg('height', String(cfg.world.height)));

const world = new World({
  width,
  height,
  seed,
  ambient: cfg.world.ambient,
  heatEveryTicks: cfg.world.heatEveryTicks,
});

const t0 = performance.now();
generateTerrain(world);
const genMs = performance.now() - t0;

const t1 = performance.now();
for (let i = 0; i < ticks; i++) world.tickOnce();
const simMs = performance.now() - t1;

const rgba = renderRGBA(world.grid, new Uint8Array(width * height * 4), {
  ambient: cfg.world.ambient,
  thermal: true,
});
writeFileSync(out, encodePng(rgba, width, height));

const stats = world.stats();
console.log(`[shot] мир ${width}×${height}, seed ${seed}`);
console.log(`[shot] генерация ${genMs.toFixed(1)} мс, ${ticks} тиков за ${simMs.toFixed(1)} мс`);
console.log(`[shot] это ${(simMs / Math.max(1, ticks)).toFixed(3)} мс на тик → потолок ${(1000 / Math.max(0.001, simMs / Math.max(1, ticks))).toFixed(0)} тиков/с`);
console.log(`[shot] горячих клеток ${stats.hotCells}, thermalIdle=${stats.thermalIdle}`);
console.log(`[shot] файл: ${out}`);
