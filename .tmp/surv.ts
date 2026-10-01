import { Creature } from '../packages/body/src/creature.ts';
import { ReflexPolicy } from '../packages/brain-reflex/src/policy.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 26 });
const spot = w.findSurfaceSpot();
const c = new Creature(spot.x, spot.y, 1, 0);
const p = new ReflexPolicy();
w.creature = c;
let gait = 0;
for (let t = 0; t < 30000 && c.alive; t++) {
  const want = p.survival(w, c);
  c.drinking = want.drinking; c.eating = want.eating;
  gait += 0.16 * (want.dir !== 0 ? want.dir : 1);
  c.walk(gait, w);
  w.tickOnce();
  p.act(w, c, t * 0.16);
  if (t % 6000 === 0) console.log(`t=${String(t).padStart(5)} жажда ${c.physiology.thirst.toFixed(2)} голод ${c.physiology.hunger.toFixed(2)} вода ${(c.physiology.hydration*100).toFixed(0)}% глюкоза ${c.physiology.glucose.toFixed(1)} пьёт=${c.drinking} ест=${c.eating} жив=${c.alive}`);
}
console.log('итог:', c.alive ? `жив, вода ${(c.physiology.hydration*100).toFixed(0)}%, глюкоза ${c.physiology.glucose.toFixed(1)}` : c.physiology.explainDeath());
