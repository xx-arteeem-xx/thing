import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { run } from '../tests/helpers.ts';

const a = new World({ width: 128, height: 96, seed: 2024, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 4, dayLengthTicks: 4800, weather: false, maxWaterCells: 4500, journalFile: null });
generateTerrain(a, { trees: 8 });
run(a, 200);
const b = World.fromSnapshot(a.toSnapshot());
run(a, 120);
run(b, 120);
console.log('тик:', a.tick, b.tick);
console.log('вода:', a.waterCells, b.waterCells, '| weather:', a.weather.kind, b.weather.kind, '| until:', a.weather.until, b.weather.until);
console.log('грязных чанков A:', [...Array(a.grid.chunkCount).keys()].filter(c=>a.grid.isDirty(c)).length, 'B:', [...Array(b.grid.chunkCount).keys()].filter(c=>b.grid.isDirty(c)).length);
// сравниваем сетки
let diffMat = 0, diffTemp = 0, firstAt = -1;
for (let i = 0; i < a.grid.mat.length; i++) {
  if (a.grid.mat[i] !== b.grid.mat[i]) { diffMat++; if (firstAt < 0) firstAt = i; }
  if (a.grid.temp[i] !== b.grid.temp[i]) diffTemp++;
}
console.log('различий в веществе:', diffMat, 'в температуре:', diffTemp, 'первое в', firstAt, 'x=', firstAt % 128, 'y=', (firstAt/128)|0);
console.log('фауна:', a.fauna.count, b.fauna.count);
