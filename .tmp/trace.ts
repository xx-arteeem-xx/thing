import { Creature } from '../packages/body/src/creature.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SEG } from '../packages/body/src/body.ts';
import { MATERIALS } from '../packages/world/src/materials.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 26 });
const g = w.grid;
const spot = w.findSurfaceSpot();
const c = new Creature(spot.x, spot.y, 1, 0);
w.creature = c;
const ground = (x: number) => { for (let y = 0; y < g.h; y++) { const m = g.mat[y*g.w+x]; if (m !== 0 && m !== 4) return y; } return -1; };
const supported = (id: number) => {
  const x = Math.round(c.body.x[id]), y = Math.round(c.body.y[id]) + 1;
  if (y >= g.h || x < 0 || x >= g.w) return false;
  const m = g.mat[y*g.w+x];
  return m !== 0 && m !== 4;
};
let gait = 0, lost = -1, air = 0;
for (let t = 0; t < 20000; t++) {
  const want = c.locomotionMode(w);
  c.walkDirection = 1;
  gait += 0.16;
  c.walk(gait, w);
  w.tickOnce();
  const ok = supported(SEG.L_FOOT) || supported(SEG.R_FOOT) || supported(SEG.PELVIS);
  // Первые тики тело падает с высоты постановки — это не потеря опоры.
  if (t < 200) continue;
  if (!ok) { air++; if (air > 30 && lost < 0) { lost = t; break; } } else air = 0;
}
console.log(lost < 0 ? 'опора не терялась ни разу за 20000 тиков' : `опора потеряна на тике ${lost}`);
if (lost > 0) {
  const px = Math.round(c.body.x[SEG.PELVIS]), py = Math.round(c.body.y[SEG.PELVIS]);
  const fx = Math.round(c.body.x[SEG.L_FOOT]), fy = Math.round(c.body.y[SEG.L_FOOT]);
  const name = (x: number, y: number) => (x<0||y<0||x>=g.w||y>=g.h) ? '—' : (MATERIALS[g.mat[y*g.w+x]]?.name ?? '?');
  console.log(`таз (${px},${py}) = ${name(px,py)} | стопа (${fx},${fy}) = ${name(fx,fy)}, под ней ${name(fx,fy+1)}`);
  console.log(`поверхность под тазом y=${ground(px)}, под стопой y=${ground(fx)}`);
  console.log('профиль впереди:', Array.from({length: 12}, (_,k) => ground(px + k) - py).join(' '));
}
