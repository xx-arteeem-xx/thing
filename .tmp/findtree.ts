import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { MAT } from '../packages/world/src/materials.ts';
const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });
const g = w.grid;
// ищем ствол: клетка WOOD, у которой снизу тоже WOOD или земля, а рядом есть листва
for (let x = 2; x < g.w - 2; x++) {
  for (let y = 2; y < g.h - 2; y++) {
    if (g.mat[y * g.w + x] !== MAT.WOOD) continue;
    if (g.mat[(y - 1) * g.w + x] !== MAT.WOOD) continue;
    if (g.mat[(y + 1) * g.w + x] !== MAT.WOOD) continue;
    // низ ствола
    let base = y;
    while (base + 1 < g.h && g.mat[(base + 1) * g.w + x] === MAT.WOOD) base++;
    const left = g.mat[(base) * g.w + x - 1];
    console.log(`ствол x=${x} от y=${y} до низа y=${base}; слева от низа материал ${left}`);
    process.exit(0);
  }
}
console.log('дерево не найдено');
