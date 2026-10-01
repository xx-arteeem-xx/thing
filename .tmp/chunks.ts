import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { debugStats } from '../packages/world/src/sim.ts';
import { MATERIALS } from '../packages/world/src/materials.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 8, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });
for (let i = 0; i < 400; i++) w.tickOnce();
console.log('чанков за тик:', debugStats.chunks, 'из', w.grid.chunkCount, '| клеток', debugStats.cells);
const s = w.stats();
const rows = s.counts.map((n, id) => ({ n, id })).filter(e => e.n > 0).sort((a,b)=>b.n-a.n).slice(0,12);
console.log('состав:', rows.map(e => `${MATERIALS[e.id].name}=${e.n}`).join(', '));
console.log('растений', s.plants, 'зверей', s.fauna, 'tick', w.tick);
