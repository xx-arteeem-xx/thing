import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { MAT } from '../packages/world/src/materials.ts';
import { strikeLightning } from '../packages/world/src/sim.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: true, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 26 });
// сначала подожжём дерево вручную — пусть в летопись попадёт огонь
const g = w.grid;
for (let x = 100; x < 300; x++) for (let y = 40; y < 120; y++) {
  if (g.mat[y*g.w+x] === MAT.WOOD) { strikeLightning(w, x); x = 999; break; }
}
for (let i = 0; i < 20000; i++) w.tickOnce();
console.log('всего открытий:', w.journal.total);
for (const d of w.journal.all().slice(0, 18)) {
  console.log(`  [тик ${String(d.tick).padStart(6)}] ${d.kind}: ${d.text}`);
}
