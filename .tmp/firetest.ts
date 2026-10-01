import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { MAT } from '../packages/world/src/materials.ts';
import { WEATHER_NAME } from '../packages/world/src/sim.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: false });
generateTerrain(w, { trees: 26 });
for (let i = 0; i < 3000; i++) w.tickOnce();
const c = (m: number) => { let n = 0; for (const v of w.grid.mat) if (v === m) n++; return n; };
console.log(`перед поджогом: дерево ${c(MAT.WOOD)} листва ${c(MAT.LEAVES)} трава ${c(MAT.GRASS)} `);
console.log('материал у ствола: (119,78)=', w.grid.get(119,78), '(121,78)=', w.grid.get(121,78), '(120,78)=', w.grid.get(120,78), '(120,77)=', w.grid.get(120,77));
const painted = w.paint(119, 78, 1, MAT.FIRE) + w.paint(121, 78, 1, MAT.FIRE);
console.log('подпалено клеток:', painted);
for (let t = 1; t <= 10; t++) {
  for (let k = 0; k < 150; k++) w.tickOnce();
  console.log(`через ${t * 2.5} с (тик ${w.tick}): огонь ${c(MAT.FIRE)} дым ${c(MAT.SMOKE)} пепел ${c(MAT.ASH)} дерево ${c(MAT.WOOD)} листва ${c(MAT.LEAVES)} `);
}
