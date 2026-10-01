import { Creature } from '../packages/body/src/creature.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SEG } from '../packages/body/src/body.ts';

function run(label: string, opt: { walk: boolean; muscles: number; ticks: number }) {
  const w = new World({ width: 256, height: 128, seed: 7, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
  generateTerrain(w, { trees: 8 });
  const spot = w.findSurfaceSpot();
  const c = new Creature(spot.x, spot.y, 1, 0);
  c.body.muscleStrength = opt.muscles;
  w.creature = c;
  const y0 = c.body.y[SEG.PELVIS];
  for (let t = 0; t < opt.ticks; t++) {
    if (opt.walk && t % 3 === 0) c.walk(t * 0.05);
    w.tickOnce();
  }
  console.log(`${label}: таз ${y0.toFixed(1)} → ${c.body.y[SEG.PELVIS].toFixed(1)} | сдвиг ${(c.body.y[SEG.PELVIS]-y0).toFixed(1)} | под стопой ${w.grid.mat[Math.round(c.body.y[12]+1)*w.grid.w + Math.round(c.body.x[12])]}`);
}
run('стоит, без мышц, 9000 ', { walk: false, muscles: 0, ticks: 9000 });
run('идёт,  без мышц, 9000 ', { walk: true, muscles: 0, ticks: 9000 });
run('идёт,  без мышц, 1500 ', { walk: true, muscles: 0, ticks: 1500 });
run('идёт,  без мышц, 300  ', { walk: true, muscles: 0, ticks: 300 });
