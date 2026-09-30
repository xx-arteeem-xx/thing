import { World } from '../packages/world/src/world.ts';
import { MAT } from '../packages/world/src/materials.ts';
const w = new World({ width: 32, height: 32, seed: 11, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 4, dayLengthTicks: 4800, weather: false });
for (let x = 0; x < 32; x++) w.grid.set(x, 31, MAT.STONE);
for (let y = 26; y <= 30; y++) w.grid.set(16, y, MAT.WOOD);
w.grid.set(15, 30, MAT.FIRE);
const c = (m: number) => { let n = 0; for (const v of w.grid.mat) if (v === m) n++; return n; };
for (const t of [5, 50, 100, 200, 400, 600, 900]) {
  while (w.tick < t) w.tickOnce();
  console.log(`тик ${t}: дерево=${c(MAT.WOOD)} огонь=${c(MAT.FIRE)} дым=${c(MAT.SMOKE)} пепел=${c(MAT.ASH)}`);
}
