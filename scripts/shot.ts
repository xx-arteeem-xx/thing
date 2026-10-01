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
import { drawBody, drawFauna, renderRGBA } from '../packages/world/src/render.ts';
import { Body, SEGMENTS } from '../packages/body/src/body.ts';
import { WEATHER_NAME } from '../packages/world/src/sim.ts';
import { MAT, MATERIALS } from '../packages/world/src/materials.ts';
import { SPECIES_BY_ID, SPECIES_LIST } from '../packages/world/src/fauna.ts';
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
  maxWaterCells: cfg.world.maxWaterCells ?? 4500,
  journalFile: null,
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
  // Свет неба берём текущий: иначе прямоугольники замороженного света.
  skyLight: world.skyLight,
});
drawFauna(rgba, width, height, world.fauna, speciesColor, speciesSize);

// Тело существа: ставим на луг и даём упасть, чтобы видеть работу физики.
if (arg('body', '1') !== '0') {
  const g = world.grid;
  let spot: { x: number; y: number } | null = null;
  for (let x = 60; x < width - 60 && !spot; x++) {
    for (let y = 10; y < height - 6; y++) {
      const i = y * width + x;
      if (g.mat[i] === MAT.GRASS && g.mat[i - width] === MAT.AIR) {
        spot = { x, y: y - 4 };
        break;
      }
    }
  }
  if (spot) {
    const body = new Body(spot.x, spot.y);
    for (let k = 0; k < 200; k++) body.step(world, 1 / 60);
    drawBody(rgba, width, height, body, SEGMENTS.length, SEGMENTS, [236, 214, 190]);
    console.log(`[shot] тело поставлено у (${spot.x}, ${spot.y}), центр (${body.center().x.toFixed(1)}, ${body.center().y.toFixed(1)}), на опоре: ${body.onGround(world)}`);
  }
}
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
console.log(
  `[shot] живность: ${SPECIES_LIST.map((sp) => `${sp.name} ${world.fauna.countOf(sp.id)}`).join(', ')}` +
    ` | рождений ${world.fauna.born}, смертей ${world.fauna.died}`,
);

function speciesColor(id: number): [number, number, number] {
  return SPECIES_BY_ID[id]?.color ?? [255, 0, 255];
}

function speciesSize(id: number): number {
  return SPECIES_BY_ID[id]?.size ?? 2;
}
console.log(`[shot] состав: ${composition}`);
console.log(`[shot] файл: ${out}`);
