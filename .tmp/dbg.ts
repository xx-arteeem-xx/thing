import { World } from '../packages/world/src/world.ts';
import { MAT } from '../packages/world/src/materials.ts';

const w = new World({ width: 32, height: 32, seed: 5, ambient: 20, heatEveryTicks: 4 });
for (let x = 0; x < 32; x++) w.grid.set(x, 31, MAT.STONE);
w.grid.set(16, 5, MAT.SAND);

console.log('старт: chunk1 dirty =', w.grid.isDirty(1), ' chunk3 dirty =', w.grid.isDirty(3));
for (let t = 1; t <= 8; t++) {
  w.tickOnce();
  const col = [4,5,6,7,8,9].map((y) => w.grid.get(16, y)).join(',');
  console.log(
    `тик ${t}: col(4..9)=[${col}] dirty=[${[0,1,2,3].map((c) => (w.grid.isDirty(c) ? 1 : 0)).join('')}]`,
  );
}
