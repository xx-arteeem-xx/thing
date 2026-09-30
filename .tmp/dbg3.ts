import { World } from '../packages/world/src/world.ts';
import { MAT, MATERIALS } from '../packages/world/src/materials.ts';

const s = new World({ width: 32, height: 48, seed: 29, ambient: 20, heatEveryTicks: 4 });
for (let x = 0; x < 32; x++) s.grid.set(x, 47, MAT.STONE);
for (let y = 20; y <= 22; y++) for (let x = 14; x <= 17; x++) s.grid.set(x, y, MAT.SMOKE);

function dump(tag: string) {
  const g = s.grid;
  const cells: string[] = [];
  for (let i = 0; i < g.mat.length; i++) {
    if (g.mat[i] === MAT.SMOKE) {
      const x = i % g.w, y = (i / g.w) | 0;
      cells.push(`(${x},${y}) aux=${g.aux[i]} flags=${g.flags[i]}`);
    }
  }
  console.log(`${tag}: ${cells.length} шт → ${cells.join(' | ')}`);
}

while (s.tick < 100) s.tickOnce();
dump('тик 100');
while (s.tick < 1200) s.tickOnce();
dump('тик 1200');
console.log('lifetime дыма:', MATERIALS[MAT.SMOKE].lifetime, 'в aux допустимо до', 65535);
