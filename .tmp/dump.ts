import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SPECIES } from '../packages/world/src/fauna.ts';
import { MATERIALS } from '../packages/world/src/materials.ts';
const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });
while (w.tick < 6000) w.tickOnce();
const g = w.grid;
const at = (x: number, y: number) => (x<0||y<0||x>=g.w||y>=g.h) ? '—' : MATERIALS[g.mat[y*g.w+x]].name;
let shown = 0;
for (let i = 0; i < w.fauna.count && shown < 5; i++) {
  if (w.fauna.species[i] !== SPECIES.RABBIT) continue;
  shown++;
  const x = w.fauna.x[i], y = w.fauna.y[i];
  const cx = Math.round(x), cy = Math.round(y);
  console.log(`кролик #${i}: позиция (${x.toFixed(2)}, ${y.toFixed(2)}) клетка (${cx},${cy}) энергия ${w.fauna.energy[i]} цель (${w.fauna.targetX[i]},${w.fauna.targetY[i]})`);
  console.log(`   вокруг: своя=${at(cx,cy)} низ=${at(cx,cy+1)} верх=${at(cx,cy-1)} лево=${at(cx-1,cy)} право=${at(cx+1,cy)}`);
  console.log(`   на 2 ниже=${at(cx,cy+2)} на 3 ниже=${at(cx,cy+3)}`);
}
console.log('--- где вообще трава на этом участке:');
for (let x = 140; x < 150; x++) {
  const col: string[] = [];
  for (let y = 74; y < 86; y++) col.push(`${y}:${at(x,y)}`);
  console.log(`x=${x}: ${col.join(' ')}`);
}
