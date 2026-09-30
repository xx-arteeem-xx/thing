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
import { WEATHER_NAME } from '../packages/world/src/sim.ts';
import { MATERIALS } from '../packages/world/src/materials.ts';
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
const trees = Number(arg('trees', '26'));
const weather = arg('weather', cfg.world.weather ? '1' : '0') !== '0';

const world = new World({
  width,
  height,
  seed,
  ambient: cfg.world.ambient,
  heatEveryTicks: cfg.world.heatEveryTicks,
  lightEveryTicks: cfg.world.lightEveryTicks,
  dayLengthTicks: cfg.world.dayLengthTicks,
  weather,
});

const t0 = performance.now();
generateTerrain(world, { trees });
const genMs = performance.now() - t0;

const t1 = performance.now();
for (let i = 0; i < ticks; i++) world.tickOnce();
const simMs = performance.now() - t1;

const rgba = renderRGBA(world.grid, new Uint8Array(width * height * 4), {
  ambient: world.ambient,
  thermal: true,
});
writeFileSync(out, encodePng(rgba, width, height));

const stats = world.stats();
const perTick = simMs / Math.max(1, ticks);
const composition = stats.counts
  .map((n, id) => ({ n, id }))
  .filter((e) => e.n > 0)
  .sort((a, b) => b.n - a.n)
  .slice(0, 8)
  .map((e) => `${MATERIALS[e.id].name} ${e.n}`)
  .join(', ');

console.log(`[shot] мир ${width}×${height}, seed ${seed}, деревьев ${trees}`);
console.log(`[shot] генерация ${genMs.toFixed(1)} мс, ${ticks} тиков за ${simMs.toFixed(1)} мс`);
console.log(`[shot] это ${perTick.toFixed(3)} мс на тик → потолок ${(1000 / Math.max(0.001, perTick)).toFixed(0)} тиков/с`);
console.log(`[shot] время суток ${(world.timeOfDay * 24).toFixed(1)} ч, небесный свет ${world.skyLight}, погода: ${WEATHER_NAME[world.weather.kind]}`);
console.log(`[shot] растений ${stats.plants}, горячих клеток ${stats.hotCells}`);
console.log(`[shot] состав: ${composition}`);
console.log(`[shot] файл: ${out}`);
