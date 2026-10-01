import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { MAT } from '../packages/world/src/materials.ts';
const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: true, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 26 });
const g = w.grid;
// высота поверхности по столбцам
const h = new Int32Array(g.w);
for (let x = 0; x < g.w; x++) { for (let y = 0; y < g.h; y++) { const m = g.mat[y*g.w+x]; if (m !== MAT.AIR && m !== MAT.WATER) { h[x] = y; break; } } }
let total = 0, deep = 0, shallow = 0;
const hist = new Map<number, number>();
for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
  if (g.mat[y*g.w+x] !== MAT.WATER) continue;
  total++;
  const d = y - h[x];
  hist.set(d, (hist.get(d) ?? 0) + 1);
  if (d > 10) deep++; else shallow++;
}
console.log(`воды всего: ${total} | глубже 10 от поверхности: ${deep} | выше: ${shallow}`);
const keys = [...hist.keys()].sort((a,b)=>a-b).slice(0, 8);
console.log('распределение по глубине:', keys.map(k=>`${k}:${hist.get(k)}`).join(' '));
