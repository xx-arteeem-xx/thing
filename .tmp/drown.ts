import { Creature } from '../packages/body/src/creature.ts';
import { ReflexPolicy } from '../packages/brain-reflex/src/policy.ts';
import { SENSE } from '../packages/body/src/sensors.ts';
import { World } from '../packages/world/src/world.ts';
import { MAT } from '../packages/world/src/materials.ts';
const w = new World({ width: 48, height: 32, seed: 3, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 4, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
for (let x = 0; x < 48; x++) { w.grid.set(x, 31, MAT.STONE); w.grid.set(x, 30, MAT.DIRT); w.grid.set(x, 29, MAT.GRASS); }
const c = new Creature(24, 20, 1, 0);
for (let x = 10; x < 40; x++) for (let y = 8; y < 30; y++) w.grid.set(x, y, MAT.WATER);
const p = new ReflexPolicy();
for (let t = 0; t < 900 && c.alive; t++) {
  w.tickOnce(); c.step(w, 1/60, 0.2); p.act(w, c, t*0.16);
  if (t % 150 === 0) console.log(`t=${t} O2=${c.physiology.oxygen.toFixed(0)} датчик=${p.sensors[SENSE.VITALS+1].toFixed(2)} рефлекс="${p.lastReflex}" жив=${c.alive} голова y=${c.body.y[3].toFixed(0)}`);
}
console.log('итог:', c.alive ? 'жив' : c.physiology.explainDeath());
