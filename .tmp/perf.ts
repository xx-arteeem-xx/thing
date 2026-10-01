import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';

function run(tag: string, withFauna: boolean) {
  const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 8, dayLengthTicks: 4800, weather: true });
  generateTerrain(w, { trees: 26 });
  if (!withFauna) w.fauna.count = 0;
  for (let i = 0; i < 200; i++) { w.tickOnce(); if (!withFauna) w.fauna.count = 0; }
  const t0 = performance.now();
  for (let i = 0; i < 600; i++) { w.tickOnce(); if (!withFauna) w.fauna.count = 0; }
  const ms = (performance.now() - t0) / 600;
  console.log(`${tag}: ${ms.toFixed(3)} мс/тик, зверей ${w.fauna.count}`);
}
run('с фауной   ', true);
run('без фауны  ', false);
