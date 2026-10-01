import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SPECIES } from '../packages/world/src/fauna.ts';
import { MAT } from '../packages/world/src/materials.ts';
const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });
const g = w.grid;
const nearestGrass = (x: number, y: number, r: number) => {
  for (let d = 0; d <= r; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    const nx = Math.round(x)+dx, ny = Math.round(y)+dy;
    if (nx<0||ny<0||nx>=g.w||ny>=g.h) continue;
    if (g.mat[ny*g.w+nx] === MAT.GRASS) return Math.abs(dx)+Math.abs(dy);
  }
  return -1;
};
for (const t of [6000, 12000, 18000]) {
  while (w.tick < t) w.tickOnce();
  let n=0, sumD=0, noGrass=0, sumE=0, inGrass=0;
  const acts = new Map<number, number>();
  for (let i=0;i<w.fauna.count;i++) {
    if (w.fauna.species[i] !== SPECIES.RABBIT) continue;
    n++; sumE += w.fauna.energy[i];
    const d = nearestGrass(w.fauna.x[i], w.fauna.y[i], 40);
    if (d < 0) noGrass++; else sumD += d;
    const cx = Math.round(w.fauna.x[i]), cy = Math.round(w.fauna.y[i]);
    for (const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=cx+dx, ny=cy+dy;
      if (nx>=0&&ny>=0&&nx<g.w&&ny<g.h&&g.mat[ny*g.w+nx]===MAT.GRASS) { inGrass++; break; }
    }
    acts.set(w.fauna.act[i], (acts.get(w.fauna.act[i])??0)+1);
  }
  console.log(`тик ${t}: кроликов ${n}, средняя энергия ${(sumE/n).toFixed(0)}`);
  console.log(`   рядом с травой: ${inGrass}, без травы в радиусе 40: ${noGrass}, среднее расстояние до травы: ${((sumD)/Math.max(1,n-noGrass)).toFixed(1)}`);
  console.log(`   занятия: ${[...acts.entries()].map(([k,v])=>`${['бродит','к еде','охотится','убегает','дерётся','отдыхает'][k]??k}=${v}`).join(', ')}`);
}
