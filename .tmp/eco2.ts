import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SPECIES } from '../packages/world/src/fauna.ts';
const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });
const grass = () => { let n = 0; for (const c of w.grid.mat) if (c === 10) n++; return n; };
let pe = 0, pst = 0, pold = 0;
for (let t = 1; t <= 36000; t++) {
  w.tickOnce();
  if (t % 3000 === 0) {
    const f = w.fauna;
    let sumE = 0, n = 0, hungry = 0;
    for (let i = 0; i < f.count; i++) if (f.species[i] === SPECIES.RABBIT) { n++; sumE += f.energy[i]; if (f.energy[i] < 100) hungry++; }
    console.log(`тик ${String(t).padStart(5)}: кроликов ${n} (голодных ${hungry}, средняя энергия ${n?(sumE/n).toFixed(0):'-'}) трава ${grass()} | смертей среда +${f.diedEnv-pe} голод +${f.diedStarved-pst} старость +${f.diedOld-pold}`);
    pe=f.diedEnv; pst=f.diedStarved; pold=f.diedOld;
  }
}
