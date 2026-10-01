import { Creature } from '../packages/body/src/creature.ts';
import { World } from '../packages/world/src/world.ts';
import { MAT } from '../packages/world/src/materials.ts';
const w = new World({ width: 48, height: 32, seed: 3, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 4, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
for (let x = 0; x < 48; x++) { w.grid.set(x, 31, MAT.STONE); w.grid.set(x, 30, MAT.DIRT); w.grid.set(x, 29, MAT.GRASS); }
const c = new Creature(24, 25, 1, 0);
for (let x = 20; x <= 28; x++) for (let y = 24; y <= 29; y++) w.grid.set(x, y, MAT.FIRE);
for (let t = 0; t < 900 && c.alive; t++) { w.tickOnce(); c.step(w, 1/60, 0.2); if (t % 150 === 0) console.log(`t=${t} жив=${c.alive} урон=${c.physiology.totalDamage.toFixed(1)} кровь=${c.physiology.blood.toFixed(2)} боль=${c.physiology.painLevel.toFixed(2)} голова=(${c.body.x[3].toFixed(0)},${c.body.y[3].toFixed(0)})`); }
console.log('итог:', c.alive ? 'жив' : c.physiology.explainDeath());

const w2 = new World({ width: 48, height: 32, seed: 5, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 4, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
for (let x = 0; x < 48; x++) { w2.grid.set(x, 31, MAT.STONE); w2.grid.set(x, 30, MAT.DIRT); w2.grid.set(x, 29, MAT.GRASS); }
const c2 = new Creature(24, 25, 1, 0);
c2.physiology.glucose = 8; c2.physiology.glycogen = 600; c2.physiology.hydration = 1;
c2.hurt(1, 45, 'cut'); c2.hurt(4, 45, 'cut');
for (let t = 0; t < 12000 && c2.alive; t++) { w2.tickOnce(); c2.step(w2, 1/60, 0.2); }
console.log('кровотечение:', c2.alive ? 'жив' : c2.physiology.explainDeath(), '| кровь', c2.physiology.blood.toFixed(2), '| время', (c2.deathTick/60).toFixed(0), 'с');
