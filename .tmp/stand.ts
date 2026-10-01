import { Creature } from '../packages/body/src/creature.ts';
import { readSensors, SENSE } from '../packages/body/src/sensors.ts';
import { World } from '../packages/world/src/world.ts';
import { MAT } from '../packages/world/src/materials.ts';
const w = new World({ width: 48, height: 32, seed: 3, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 4, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
for (let x = 0; x < 48; x++) { w.grid.set(x, 31, MAT.STONE); w.grid.set(x, 30, MAT.DIRT); w.grid.set(x, 29, MAT.GRASS); }
const c = new Creature(24, 25, 1, 0);
for (let t = 0; t < 300; t++) { w.tickOnce(); c.step(w, 1/60, 0.2); }
const out = new Float32Array(100);
readSensors(w, c, out);
console.log('опора стоп:', out[SENSE.CONTACT], out[SENSE.CONTACT+1], '| кисти:', out[SENSE.CONTACT+2], out[SENSE.CONTACT+3]);
console.log('позиции: таз', c.body.y[0].toFixed(1), 'л.стопа', c.body.y[12].toFixed(1), 'п.стопа', c.body.y[15].toFixed(1), '| голова', c.body.y[3].toFixed(1));
console.log('вверх головой:', out[SENSE.ORIENTATION+1]);
