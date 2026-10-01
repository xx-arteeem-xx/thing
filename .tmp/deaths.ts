import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SPECIES } from '../packages/world/src/fauna.ts';
import { MAT } from '../packages/world/src/materials.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 8, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });
let prevDied = 0, prevEnv = 0, prevOld = 0, prevEaten = 0;
for (let t = 1; t <= 6000; t++) {
  w.tickOnce();
  if (t % 500 === 0) {
    const f = w.fauna;
    console.log(`тик ${String(t).padStart(5)}: кролик=${f.countOf(SPECIES.RABBIT)} рыба=${f.countOf(SPECIES.FISH)} волк=${f.countOf(SPECIES.WOLF)} | смертей +${f.died-prevDied} (среда +${f.diedEnv-prevEnv}, старость +${f.diedOld-prevOld}, съедено +${f.eaten-prevEaten})`);
    prevDied = f.died; prevEnv = f.diedEnv; prevOld = f.diedOld; prevEaten = f.eaten;
  }
}
// где находятся выжившие кролики и что у них под ногами
let inWater = 0, onLand = 0;
for (let i = 0; i < w.fauna.count; i++) {
  if (w.fauna.species[i] !== SPECIES.RABBIT) continue;
  const cx = Math.round(w.fauna.x[i]), cy = Math.round(w.fauna.y[i]);
  const m = w.grid.mat[cy * w.grid.w + cx];
  if (m === MAT.WATER) inWater++; else onLand++;
}
console.log(`выжившие кролики: на земле ${onLand}, в воде ${inWater}`);
