import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { MATERIALS } from '../packages/world/src/materials.ts';
import { loadConfig } from '../packages/server/src/config.ts';
const cfg = loadConfig();
const w = new World({ width: 512, height: 256, seed: cfg.world.seed, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 4, dayLengthTicks: 4800, weather: cfg.world.weather });
generateTerrain(w, { trees: 26 });
const show = (tag: string) => {
  const s = w.stats();
  const rows = s.counts.map((n, id) => ({ n, id })).filter((e) => e.n > 0 && e.id !== 0).sort((a, b) => b.n - a.n);
  console.log(`${tag}: воздух=${s.counts[0]} растений=${s.plants} горячих=${s.hotCells}`);
  console.log('  ' + rows.slice(0, 14).map((e) => `${MATERIALS[e.id].name}=${e.n}`).join(' '));
};
show('после генерации');
for (let i = 0; i < 500; i++) w.tickOnce();
show('через 500 тиков');
