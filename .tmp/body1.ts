import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { Body, SEGMENTS, SEG } from '../packages/body/src/body.ts';
import { MAT } from '../packages/world/src/materials.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 12 });
// найдём ровное место на лугу
const g = w.grid;
let spot = { x: 200, y: 0 };
for (let x = 150; x < 300; x++) {
  for (let y = 40; y < 140; y++) {
    if (g.mat[y*g.w+x] === MAT.GRASS && g.mat[(y-1)*g.w+x] === MAT.AIR) { spot = { x, y: y - 3 }; break; }
  }
  if (spot.y) break;
}
const body = new Body(spot.x, spot.y);
const len = (a: number, b: number) => Math.hypot(body.x[a]-body.x[b], body.y[a]-body.y[b]);
console.log(`тело поставлено у (${spot.x}, ${spot.y})`);
for (const t of [0, 30, 90, 180, 360, 720]) {
  while (w.tick < t) { w.tickOnce(); body.step(w, 1/60); }
  const c = body.center();
  const chest = len(SEG.PELVIS, SEG.CHEST), thigh = len(SEG.PELVIS, SEG.L_THIGH);
  console.log(`тик ${String(t).padStart(3)}: центр (${c.x.toFixed(1)}, ${c.y.toFixed(1)}) голова y=${body.y[SEG.HEAD].toFixed(1)} таз-грудь=${chest.toFixed(2)} (норма 2.55) таз-бедро=${thigh.toFixed(2)} (норма 2.15) на опоре=${body.onGround(w)}`);
}
console.log('разрывы связей:', SEGMENTS.filter((s,i)=> i>0 && s.parent>=0).map(s => {
  const d = len(s.id, s.parent); const rest = s.length;
  return Math.abs(d - rest) > 0.6 ? `${s.name}: ${d.toFixed(2)} вместо ${rest.toFixed(2)}` : null;
}).filter(Boolean).join(', ') || 'нет');
