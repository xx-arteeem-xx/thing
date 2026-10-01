import { Creature } from '../packages/body/src/creature.ts';
import { ReflexPolicy } from '../packages/brain-reflex/src/policy.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SEG } from '../packages/body/src/body.ts';
import { MATERIALS } from '../packages/world/src/materials.ts';
const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 26 });
const spot = w.findSurfaceSpot();
const c = new Creature(spot.x, spot.y, 1, 0);
const p = new ReflexPolicy();
w.creature = c;
let gait = 0;
for (let t = 0; t < 12000; t++) {
  const want = p.survival(w, c);
  c.drinking = want.drinking; c.eating = want.eating;
  gait += 0.16 * (want.dir !== 0 ? want.dir : 1);
  c.walk(gait, w);
  w.tickOnce();
  p.act(w, c, t * 0.16);
  if (t === 11999) {
    const g = w.grid;
    const at = (x: number, y: number) => MATERIALS[g.mat[Math.round(y)*g.w + Math.round(x)]]?.name ?? '?';
    console.log('таз:', c.body.x[0].toFixed(1), c.body.y[0].toFixed(1), '| л.стопа:', c.body.x[12].toFixed(1), c.body.y[12].toFixed(1));
    console.log('под стопой:', at(c.body.x[12], c.body.y[12]+1), '| на стопе:', at(c.body.x[12], c.body.y[12]));
    console.log('голод:', c.physiology.hunger.toFixed(2), 'жажда:', c.physiology.thirst.toFixed(2));
    console.log('survival:', JSON.stringify(p.survival(w, c)));
  }
}
