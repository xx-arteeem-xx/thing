import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { MAT } from '../packages/world/src/materials.ts';
import { MATERIALS } from '../packages/world/src/materials.ts';
const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: true, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 26 });
const g = w.grid;
function report(label: string) {
  const h = new Int32Array(g.w).fill(-1);
  for (let x = 0; x < g.w; x++) for (let y = 0; y < g.h; y++) { const m = g.mat[y*g.w+x]; if (m !== MAT.AIR && m !== MAT.WATER) { h[x] = y; break; } }
  let sea = 0, cave = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (g.mat[y*g.w+x] !== MAT.WATER) continue;
    if (h[x] < 0 || y < h[x]) sea++; else cave++;
  }
  console.log(`${label}: вода над землёй ${sea}, вода под землёй ${cave}`);
}
report('после генерации      ');
for (const t of [3000, 10000, 25000]) { while (w.tick < t) w.tickOnce(); report(`тик ${String(t).padStart(5)}          `); }
