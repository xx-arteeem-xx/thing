import { Creature } from '../packages/body/src/creature.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SEG } from '../packages/body/src/body.ts';
import { MATERIALS } from '../packages/world/src/materials.ts';
const w = new World({ width: 256, height: 128, seed: 7, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 8 });
const g = w.grid;
const spot = w.findSurfaceSpot();
const c = new Creature(spot.x, spot.y, 1, 0);
c.body.muscleStrength = 0;
w.creature = c;
const surfaceAt = (x: number) => { for (let y = 0; y < g.h; y++) if (g.mat[y*g.w+x] !== 0) return y; return -1; };
const x = Math.round(c.body.x[SEG.PELVIS]);
console.log(`старт: таз y=${c.body.y[SEG.PELVIS].toFixed(1)}, поверхность под ним y=${surfaceAt(x)}`);
for (const t of [300, 1500, 9000]) {
  while (w.tick <= t) w.tickOnce();
  const xx = Math.round(c.body.x[SEG.PELVIS]);
  const yy = Math.round(c.body.y[SEG.PELVIS]);
  const here = MATERIALS[g.mat[yy*g.w+xx]]?.name ?? '?';
  console.log(`тик ${String(t).padStart(4)}: x=${xx} таз y=${yy} (${here}), поверхность под ним y=${surfaceAt(xx)}, разница ${yy - surfaceAt(xx)}`);
}
