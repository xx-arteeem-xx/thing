import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { debugStats } from '../packages/world/src/sim.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 8, dayLengthTicks: 4800, weather: true });
generateTerrain(w, { trees: 26 });
for (let i = 0; i < 6000; i++) w.tickOnce();
const samples: number[] = [];
for (let i = 0; i < 600; i++) { const t = performance.now(); w.tickOnce(); samples.push(performance.now() - t); }
samples.sort((a,b)=>a-b);
const mean = samples.reduce((a,b)=>a+b,0)/samples.length;
console.log(`после 6000 тиков: среднее ${mean.toFixed(3)} мс, p50 ${samples[300].toFixed(3)}, p95 ${samples[570].toFixed(3)}, чанков ${debugStats.chunks}, зверей ${w.fauna.count}`);
console.log(`при 60 Гц это ${((mean/16.67)*100).toFixed(1)}% ядра, при 30 Гц — ${((mean/33.3)*100).toFixed(1)}%`);
