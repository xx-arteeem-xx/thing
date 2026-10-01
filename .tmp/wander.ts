import { Creature } from '../packages/body/src/creature.ts';
import { ReflexPolicy } from '../packages/brain-reflex/src/policy.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SEG } from '../packages/body/src/body.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 26 });
const g = w.grid;
const spot = w.findSurfaceSpot(undefined, { nearWater: 40 }); console.log('место рождения:', JSON.stringify(spot), 'вода рядом:', w.waterWithin(spot.x, spot.y+4, 40));
const c = new Creature(spot.x, spot.y, 1, 0);
const p = new ReflexPolicy();
w.creature = c;

// расстояние до ближайшей воды и до ближайшей еды
function nearest(what: 'water' | 'food'): number {
  const cx = Math.round(c.body.x[SEG.PELVIS]), cy = Math.round(c.body.y[SEG.PELVIS]);
  const food = [10, 11, 14, 16, 29, 31];
  let best = 999;
  for (let dx = -80; dx <= 80; dx++) for (let dy = -40; dy <= 40; dy++) {
    const x = cx+dx, y = cy+dy;
    if (x<0||y<0||x>=g.w||y>=g.h) continue;
    const m = g.mat[y*g.w+x];
    if (what === 'water' ? m === 4 : food.includes(m)) {
      const d = Math.abs(dx)+Math.abs(dy);
      if (d < best) best = d;
    }
  }
  return best;
}
let gait = 0;
for (let t = 0; t < 50000 && c.alive; t++) {
  const want = p.survival(w, c);
  c.drinking = want.drinking; c.eating = want.eating;
  c.walkDirection = want.dir !== 0 ? want.dir : c.walkDirection;
  gait += 0.16 * c.walkDirection;
  c.walk(gait, w);
  w.tickOnce();
  if (t % 8000 === 0) console.log(`t=${String(t).padStart(5)} x=${Math.round(c.body.x[SEG.PELVIS])} жажда ${c.physiology.thirst.toFixed(2)} голод ${c.physiology.hunger.toFixed(2)} | до воды ${nearest('water')} до еды ${nearest('food')} | пьёт=${c.drinking} ест=${c.eating}`);
}
console.log('итог:', c.alive ? 'жив' : c.physiology.explainDeath(), '| x =', Math.round(c.body.x[SEG.PELVIS]));
