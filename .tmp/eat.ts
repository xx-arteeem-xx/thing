import { World } from '../packages/world/src/world.ts';
import { MAT } from '../packages/world/src/materials.ts';
import { SPECIES, ACT_NAME } from '../packages/world/src/fauna.ts';

const w = new World({ width: 32, height: 24, seed: 1, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 8, dayLengthTicks: 4800, weather: false });
for (let x = 0; x < 32; x++) { w.grid.set(x, 23, MAT.STONE); w.grid.set(x, 22, MAT.DIRT); w.grid.set(x, 21, MAT.GRASS); }
const i = w.fauna.spawn(SPECIES.RABBIT, 16, 20, 80);
const grass = () => { let n = 0; for (const c of w.grid.mat) if (c === MAT.GRASS) n++; return n; };
console.log('старт: трава', grass(), 'энергия', w.fauna.energy[i], 'позиция', w.fauna.x[i].toFixed(1), w.fauna.y[i].toFixed(1));
for (let t = 0; t < 12; t++) {
  for (let k = 0; k < 50; k++) w.tickOnce();
  console.log(`тик ${(t+1)*50}: трава ${grass()}, энергия ${w.fauna.energy[i]}, действие ${ACT_NAME[w.fauna.act[i]]}, y=${w.fauna.y[i].toFixed(2)}, таймер ${w.fauna.timer[i]}`);
}
