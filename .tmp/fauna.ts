import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SPECIES_LIST, SPECIES_BY_ID } from '../packages/world/src/fauna.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 8, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });
const census = () => SPECIES_LIST.map(s => `${s.name}=${w.fauna.countOf(s.id)}`).join(' ');
console.log('старт:      ', census(), '| всего', w.fauna.count);
const t0 = performance.now();
for (const t of [3000, 9000, 18000, 36000]) {
  while (w.tick < t) w.tickOnce();
  console.log(`тик ${String(t).padStart(6)}:`, census(), `| рождений ${w.fauna.born}, смертей ${w.fauna.died}, съедено ${w.fauna.eaten}`);
}
console.log(`время: ${(performance.now() - t0).toFixed(0)} мс на 36000 тиков = ${((performance.now() - t0) / 36000).toFixed(3)} мс/тик`);
let meat = 0, algae = 0, grass = 0;
for (const c of w.grid.mat) { if (c === 31) meat++; if (c === 30) algae++; if (c === 10) grass++; }
console.log(`в мире: водорослей ${algae}, травы ${grass}, падали ${meat}`);
