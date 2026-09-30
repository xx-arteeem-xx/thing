import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { MATERIALS } from '../packages/world/src/materials.ts';

function bench(tag: string, opt: { weather?: boolean; trees?: number }, ticks = 1500) {
  const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 4, dayLengthTicks: 4800, weather: opt.weather ?? true });
  generateTerrain(w, { trees: opt.trees ?? 26 });
  for (let i = 0; i < 60; i++) w.tickOnce();
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) w.tickOnce();
  const ms = (performance.now() - t0) / ticks;
  const s = w.stats();
  const plants = s.plants;
  console.log(`${tag}: ${ms.toFixed(3)} мс/тик (${((ms / 16.67) * 100).toFixed(1)}% ядра), растений ${plants}, горячих ${s.hotCells}, idle=${s.thermalIdle}`);
}

bench('погода вкл, 26 деревьев', { weather: true, trees: 26 });
bench('погода выкл, 26 деревьев', { weather: false, trees: 26 });
bench('погода выкл, без деревьев', { weather: false, trees: 0 });
