import { Creature } from '../packages/body/src/creature.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SEG } from '../packages/body/src/body.ts';

function trial(dir: number, label: string) {
  const w = new World({ width: 256, height: 128, seed: 7, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
  generateTerrain(w, { trees: 8 });
  const g = w.grid;
  let water: {x:number,y:number} | null = null;
  for (let x = 20; x < 240 && !water; x++) for (let y = 40; y < 120; y++) {
    if (g.mat[y*g.w+x] === 4 && g.mat[(y-3)*g.w+x] === 4 && g.mat[(y+2)*g.w+x] === 4) { water = {x, y}; break; }
  }
  const c = new Creature(water!.x, water!.y, 1, 0);
  w.creature = c;
  c.walkDirection = dir;
  const x0 = c.body.x[SEG.PELVIS];
  let gait = 0;
  for (let t = 0; t < 3000; t++) { gait += 0.16 * dir; c.walk(gait, w); w.tickOnce(); }
  const dx = c.body.x[SEG.PELVIS] - x0;
  console.log(`${label}: сдвиг ${dx >= 0 ? '+' : ''}${dx.toFixed(1)} клеток | режим ${c.locomotionMode(w)}`);
}
trial(1, 'гребёт вправо');
trial(-1, 'гребёт влево ');
