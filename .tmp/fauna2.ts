import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SPECIES_LIST } from '../packages/world/src/fauna.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 8, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });
const census = () => SPECIES_LIST.map(s => `${s.name}=${w.fauna.countOf(s.id)}`).join(' ');
const count = (m: number) => { let n = 0; for (const c of w.grid.mat) if (c === m) n++; return n; };
console.log('старт:      ', census());
for (const t of [6000, 18000, 36000, 72000, 144000]) {
  while (w.tick < t) w.tickOnce();
  console.log(`тик ${String(t).padStart(6)}:`, census(), `| трава ${count(10)} водоросли ${count(30)} падаль ${count(31)} | рожд ${w.fauna.born} смерть ${w.fauna.died} (съедено ${w.fauna.eaten}, старость ${w.fauna.diedOld}, среда ${w.fauna.diedEnv} (утоплено ${w.fauna.drowned}, сгорело ${w.fauna.diedFire}))`);
}
