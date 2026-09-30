import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { stepLight, debugStats } from '../packages/world/src/sim.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 4, dayLengthTicks: 4800, weather: false });
generateTerrain(w, { trees: 26 });
for (let i = 0; i < 1500; i++) w.tickOnce();

console.log(`чанков за тик: ${debugStats.chunks} из ${w.grid.chunkCount}, клеток: ${debugStats.cells}`);

const t0 = performance.now();
for (let i = 0; i < 400; i++) w.tickOnce();
const total = (performance.now() - t0) / 400;
console.log(`тик целиком: ${total.toFixed(3)} мс (чанков ${debugStats.chunks}, клеток ${debugStats.cells})`);

const t1 = performance.now();
for (let i = 0; i < 400; i++) stepLight(w);
const light = (performance.now() - t1) / 400;
console.log(`свет (раз в 4 тика): ${light.toFixed(3)} мс → ${(light / 4).toFixed(3)} мс/тик`);
console.log(`значит на материалы+прочее: ${(total - light / 4).toFixed(3)} мс/тик`);
