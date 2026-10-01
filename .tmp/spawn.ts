import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SPECIES_BY_ID } from '../packages/world/src/fauna.ts';
import { MAT, MATERIALS } from '../packages/world/src/materials.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 8, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });
const g = w.grid;
const at = (x: number, y: number) => (x < 0 || y < 0 || x >= g.w || y >= g.h) ? 'край' : MATERIALS[g.mat[y * g.w + x]].name;

console.log('кто где появился:');
for (let i = 0; i < w.fauna.count; i++) {
  const cx = Math.round(w.fauna.x[i]), cy = Math.round(w.fauna.y[i]);
  const def = SPECIES_BY_ID[w.fauna.species[i]];
  if (def.aquatic) continue;
  console.log(`  ${def.name} (${cx},${cy}) тут=${at(cx,cy)} ниже=${at(cx,cy+1)} слева=${at(cx-1,cy)} справа=${at(cx+1,cy)}`);
}
console.log('--- через 60 тиков:');
for (let t = 0; t < 60; t++) w.tickOnce();
for (let i = 0; i < w.fauna.count; i++) {
  const cx = Math.round(w.fauna.x[i]), cy = Math.round(w.fauna.y[i]);
  const def = SPECIES_BY_ID[w.fauna.species[i]];
  if (def.aquatic) continue;
  console.log(`  ${def.name} (${cx},${cy}) тут=${at(cx,cy)} ниже=${at(cx,cy+1)} hp=${w.fauna.hp[i]}`);
}
