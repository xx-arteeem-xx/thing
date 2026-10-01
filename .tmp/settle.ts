import { Creature } from '../packages/body/src/creature.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SEG } from '../packages/body/src/body.ts';

function trial(muscles: number, walk: boolean, label: string) {
  const w = new World({ width: 256, height: 128, seed: 7, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
  generateTerrain(w, { trees: 8 });
  const g = w.grid;
  const spot = w.findSurfaceSpot();
  const c = new Creature(spot.x, spot.y, 1, 0);
  c.body.muscleStrength = muscles;
  w.creature = c;
  const ground = (x: number) => { for (let y = 0; y < g.h; y++) { const m = g.mat[y*g.w+x]; if (m !== 0 && m !== 4) return y; } return -1; };
  let gait = 0, minGap = 99, touches = 0, samples = 0;
  for (let t = 0; t < 2000; t++) {
    if (walk) { gait += 0.16; c.walk(gait, w); }
    w.tickOnce();
    if (t < 200) continue;
    const l = Math.round(c.body.y[SEG.L_FOOT]), lx = Math.round(c.body.x[SEG.L_FOOT]);
    const r = Math.round(c.body.y[SEG.R_FOOT]), rx = Math.round(c.body.x[SEG.R_FOOT]);
    const gl = ground(lx), gr = ground(rx);
    if (gl < 0 || gr < 0) continue;
    const gap = Math.min(gl - l, gr - r);
    minGap = Math.min(minGap, gap);
    samples++;
    if (gap <= 1) touches++;
  }
  console.log(`  касаний земли: ${touches} из ${samples} (${(100*touches/Math.max(1,samples)).toFixed(0)}%), минимальный зазор ${minGap}`);
  const fy = Math.round(c.body.y[SEG.L_FOOT]), fx = Math.round(c.body.x[SEG.L_FOOT]);
  const py = Math.round(c.body.y[SEG.PELVIS]), px = Math.round(c.body.x[SEG.PELVIS]);
  console.log(`${label}: стопа (${fx},${fy}) земля ${ground(fx)} → зазор ${ground(fx)-fy} | таз (${px},${py}) земля ${ground(px)} → зазор ${ground(px)-py}`);
}
trial(0, false, 'без мышц, стоит ');
trial(0.6, false, 'с мышцами, стоит');
trial(0, true, 'без мышц, идёт  ');
trial(0.6, true, 'с мышцами, идёт ');
