import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { debugStats } from '../packages/world/src/sim.ts';
import { MATERIALS, LIFETIME, FLAMMABLE, MELT_TEMP, FREEZE_TEMP, IS_PLANT, NEEDS_TIME, NO_TEMP, NO_FREEZE } from '../packages/world/src/materials.ts';

function measure(tag: string, weather: boolean, ticks: number) {
  const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 8, dayLengthTicks: 4800, weather });
  generateTerrain(w, { trees: 26 });
  while (w.tick < ticks) w.tickOnce();
  // пересчёт «кто будит чанки»: пройдём по бодрствующим чанкам и посчитаем причины
  const g = w.grid;
  const reasons = new Map<string, number>();
  let awakeChunks = 0;
  for (let c = 0; c < g.chunkCount; c++) {
    if (!g.isDirty(c)) continue;
    awakeChunks++;
    const cx = c % g.cols, cy = (c / g.cols) | 0;
    for (let y = cy * 16; y < Math.min(cy * 16 + 16, g.h); y++) {
      for (let x = cx * 16; x < Math.min(cx * 16 + 16, g.w); x++) {
        const i = y * g.w + x;
        const m = g.mat[i];
        if (m === 0 || NEEDS_TIME[m] === 0) continue;
        const amb = w.ambient[i]; const t = g.temp[i];
        let why = '';
        if (LIFETIME[m] > 0) why = 'время жизни';
        else if (MELT_TEMP[m] !== NO_TEMP && (t >= MELT_TEMP[m] || amb >= MELT_TEMP[m])) why = 'плавится';
        else if (FREEZE_TEMP[m] !== NO_FREEZE && (t <= FREEZE_TEMP[m] || amb <= FREEZE_TEMP[m])) why = 'мёрзнет';
        else if (FLAMMABLE[m] > 0 && (t >= 100 || t > amb + 5)) why = 'горит';
        else if (IS_PLANT[m] === 1) why = 'растение ' + MATERIALS[m].name;
        if (why) reasons.set(why, (reasons.get(why) ?? 0) + 1);
      }
    }
  }
  console.log(`${tag}: тик ${w.tick}, бодрствующих чанков ${awakeChunks}/${g.chunkCount}, клеток ${debugStats.cells}`);
  console.log('   причины: ' + [...reasons.entries()].sort((a,b)=>b[1]-a[1]).slice(0,7).map(([k,v])=>`${k}=${v}`).join(', '));
}
measure('погода вкл, 5000', true, 5000);
measure('погода выкл, 5000', false, 5000);
