import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { MAT } from '../packages/world/src/materials.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 8, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });
w.fauna.count = 0; // мир без зверей: смотрим, как растёт трава сама
const count = (m: number) => { let n = 0; for (const c of w.grid.mat) if (c === m) n++; return n; };
console.log('старт: трава', count(MAT.GRASS), 'земля', count(MAT.DIRT), 'грязь', count(MAT.MUD), 'куст', count(MAT.BUSH), 'водоросли', count(MAT.ALGAE));
for (const t of [600, 3000, 9000, 20000]) {
  while (w.tick < t) w.tickOnce();
  w.fauna.count = 0;
  console.log(`тик ${String(t).padStart(6)}: трава ${count(MAT.GRASS)}, земля ${count(MAT.DIRT)}, грязь ${count(MAT.MUD)}, куст ${count(MAT.BUSH)}, водоросли ${count(MAT.ALGAE)}, листва ${count(MAT.LEAVES)}`);
}
