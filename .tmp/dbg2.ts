import { World } from '../packages/world/src/world.ts';
import { MAT } from '../packages/world/src/materials.ts';

function count(w: World, m: number) {
  let n = 0;
  for (const c of w.grid.mat) if (c === m) n++;
  return n;
}

// дым
const s = new World({ width: 32, height: 48, seed: 29, ambient: 20, heatEveryTicks: 4 });
for (let x = 0; x < 32; x++) s.grid.set(x, 47, MAT.STONE);
for (let y = 20; y <= 22; y++) for (let x = 14; x <= 17; x++) s.grid.set(x, y, MAT.SMOKE);
for (const t of [1, 5, 20, 100, 300, 600, 900, 1200]) {
  while (s.tick < t) s.tickOnce();
  console.log(`дым на тике ${t}: ${count(s, MAT.SMOKE)}, dirtyChunks=${[0,1,2,3,4,5].map(c=>s.grid.isDirty(c)?1:0).join('')}`);
}

// огонь и дерево
const f = new World({ width: 32, height: 32, seed: 11, ambient: 20, heatEveryTicks: 4 });
for (let x = 0; x < 32; x++) f.grid.set(x, 31, MAT.STONE);
f.grid.set(16, 30, MAT.WOOD);
f.grid.set(15, 30, MAT.FIRE);
console.log('--- огонь/дерево');
for (let t = 1; t <= 900; t++) {
  f.tickOnce();
  if (t % 100 === 0 || t < 6) {
    console.log(`тик ${t}: дерево=${count(f, MAT.WOOD)} огонь=${count(f, MAT.FIRE)} дым=${count(f, MAT.SMOKE)} T(дерево)=${f.grid.temp[30*32+16]} T(огонь)=${f.grid.temp[30*32+15]}`);
  }
}
