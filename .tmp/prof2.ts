import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { stepLight, stepHeat } from '../packages/world/src/sim.ts';
import { MATERIALS } from '../packages/world/src/materials.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 4, dayLengthTicks: 4800, weather: false });
generateTerrain(w, { trees: 26 });

const dirty = () => { let n = 0; for (let c = 0; c < w.grid.chunkCount; c++) if (w.grid.isDirty(c)) n++; return n; };

for (let i = 0; i < 100; i++) w.tickOnce();
console.log('через 100 тиков: грязных чанков', dirty(), 'из', w.grid.chunkCount);

const t0 = performance.now();
for (let i = 0; i < 300; i++) w.tickOnce();
console.log('тик целиком:', ((performance.now() - t0) / 300).toFixed(3), 'мс');

const t1 = performance.now();
for (let i = 0; i < 300; i++) stepLight(w);
console.log('только свет:', ((performance.now() - t1) / 300).toFixed(3), 'мс');

w.thermalIdle = false;
const t2 = performance.now();
for (let i = 0; i < 300; i++) stepHeat(w);
console.log('только тепло:', ((performance.now() - t2) / 300).toFixed(3), 'мс');

// сколько клеток требуют внимания по температуре
let offAmbient = 0, phaseCells = 0;
for (let i = 0; i < w.grid.mat.length; i++) {
  const m = w.grid.mat[i];
  if (w.grid.temp[i] !== w.ambient[i]) {
    offAmbient++;
    const d = MATERIALS[m];
    if (d.meltTemp !== 32767 || d.freezeTemp !== -32768) phaseCells++;
  }
}
console.log('клеток с t != ambient:', offAmbient, 'из них с фазовыми переходами:', phaseCells);
const s = w.stats();
console.log('растений:', s.plants, 'горячих:', s.hotCells);
