import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { MAT, MATERIALS } from '../packages/world/src/materials.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 8, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });
w.fauna.count = 0;

const prev = new Uint8Array(w.grid.mat);
const causes = new Map<string, number>();
const aboveCount = new Map<string, number>();
let lost = 0, gained = 0;

for (let t = 0; t < 6000; t++) {
  w.tickOnce();
  w.fauna.count = 0;
  const mat = w.grid.mat;
  for (let i = 0; i < mat.length; i++) {
    if (prev[i] === MAT.GRASS && mat[i] !== MAT.GRASS) {
      lost++;
      const to = MATERIALS[mat[i]].name;
      causes.set(to, (causes.get(to) ?? 0) + 1);
      const y = (i / w.grid.w) | 0;
      const x = i % w.grid.w;
      if (y > 0) {
        const ab = MATERIALS[mat[i - w.grid.w]].name;
        aboveCount.set(ab, (aboveCount.get(ab) ?? 0) + 1);
      }
    } else if (prev[i] !== MAT.GRASS && mat[i] === MAT.GRASS) gained++;
  }
  prev.set(mat);
}
console.log('трава потеряна:', lost, '| выросла:', gained);
console.log('во что превращалась:', [...causes.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${k}=${v}`).join(', '));
console.log('что было сверху:', [...aboveCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${k}=${v}`).join(', '));
