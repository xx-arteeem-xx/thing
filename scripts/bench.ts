/**
 * Замер стоимости тика.
 *
 * Бюджет из плана: мир 512×256 должен стоить считанные миллисекунды на
 * слабом процессоре, иначе «жизнь 24/7 параллельно с работой» не получится.
 *
 *   node scripts/bench.ts --ticks 3000
 */
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { loadConfig } from '../packages/server/src/config.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const cfg = loadConfig();
const ticks = Number(arg('ticks', '2000'));
const width = Number(arg('width', String(cfg.world.width)));
const height = Number(arg('height', String(cfg.world.height)));
const seed = Number(arg('seed', String(cfg.world.seed)));

const world = new World({
  width,
  height,
  seed,
  ambient: cfg.world.ambient,
  heatEveryTicks: cfg.world.heatEveryTicks,
  lightEveryTicks: cfg.world.lightEveryTicks,
  dayLengthTicks: cfg.world.dayLengthTicks,
  weather: cfg.world.weather,
});
generateTerrain(world, { trees: 26 });

// Прогрев: первый тик всегда дороже (джемы, прогрев JIT).
for (let i = 0; i < 120; i++) world.tickOnce();

const samples: number[] = [];
for (let i = 0; i < ticks; i++) {
  const t = performance.now();
  world.tickOnce();
  samples.push(performance.now() - t);
}

samples.sort((a, b) => a - b);
const sum = samples.reduce((a, b) => a + b, 0);
const mean = sum / samples.length;
const p50 = samples[Math.floor(samples.length * 0.5)];
const p95 = samples[Math.floor(samples.length * 0.95)];
const p99 = samples[Math.floor(samples.length * 0.99)];
const max = samples[samples.length - 1];

console.log(`[bench] мир ${width}×${height} (${width * height} клеток), ${ticks} тиков`);
console.log(`[bench] среднее ${mean.toFixed(3)} мс | p50 ${p50.toFixed(3)} | p95 ${p95.toFixed(3)} | p99 ${p99.toFixed(3)} | max ${max.toFixed(3)}`);
console.log(`[bench] при 60 Гц это ${((mean / (1000 / 60)) * 100).toFixed(1)}% одного ядра`);
console.log(`[bench] потолок по среднему: ${(1000 / mean).toFixed(0)} тиков/с`);
console.log(`[bench] thermalIdle=${world.thermalIdle}, tick=${world.tick}`);
