import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SPECIES, SPECIES_BY_ID } from '../packages/world/src/fauna.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 8, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });

for (const t of [1, 3000, 9000, 18000]) {
  while (w.tick < t) w.tickOnce();
  for (const sp of [SPECIES.RABBIT, SPECIES.WOLF, SPECIES.FISH]) {
    const def = SPECIES_BY_ID[sp];
    let n = 0, adults = 0, fed = 0, sumE = 0, maxAge = 0;
    for (let i = 0; i < w.fauna.count; i++) {
      if (w.fauna.species[i] !== sp) continue;
      n++;
      sumE += w.fauna.energy[i];
      if (w.fauna.age[i] >= def.maturity) adults++;
      if (w.fauna.energy[i] >= def.breedEnergy) fed++;
      if (w.fauna.age[i] > maxAge) maxAge = w.fauna.age[i];
    }
    if (n === 0) { console.log(`тик ${t}: ${def.name} — вымер`); continue; }
    console.log(`тик ${t}: ${def.name} n=${n} взрослых=${adults} сытых=${fed} средняя энергия=${(sumE/n).toFixed(0)} макс.возраст=${maxAge} (зрелость ${def.maturity})`);
  }
}
