import { Creature } from '../packages/body/src/creature.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SEG } from '../packages/body/src/body.ts';
const w = new World({ width: 256, height: 128, seed: 7, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 8 });
const g = w.grid;
// ищем воду поглубже
let water: {x:number,y:number} | null = null;
for (let x = 20; x < 240 && !water; x++) for (let y = 40; y < 120; y++) {
  if (g.mat[y*g.w+x] === 4 && g.mat[(y-3)*g.w+x] === 4 && g.mat[(y+2)*g.w+x] === 4) { water = {x, y}; break; }
}
console.log('вода найдена в', JSON.stringify(water));
const c = new Creature(water!.x, water!.y - 2, 1, 0);
w.creature = c;
let gait = 0;
for (let t = 0; t < 4000; t++) {
  const mode = c.locomotionMode(w);
  c.walkDirection = 1;
  gait += 0.16;
  c.walk(gait, w);
  w.tickOnce();
  if (t % 800 === 0) {
    const cx = Math.round(c.body.x[SEG.PELVIS]), cy = Math.round(c.body.y[SEG.PELVIS]);
    console.log(`t=${String(t).padStart(4)} режим=${mode} позиция (${cx},${cy}) глубина: ${cy - (function(){for(let y=0;y<g.h;y++) if(g.mat[y*g.w+cx]!==0 && g.mat[y*g.w+cx]!==4) return y; return -1;})()}`);
  }
}
const cx = Math.round(c.body.x[SEG.PELVIS]), cy = Math.round(c.body.y[SEG.PELVIS]);
console.log('итог: позиция', cx, cy, '| режим', c.locomotionMode(w), '|', c.alive ? 'жив' : c.physiology.explainDeath(), '| голова y=', Math.round(c.body.y[3]));
