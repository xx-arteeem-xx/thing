import { Creature } from '../packages/body/src/creature.ts';
import { ReflexPolicy } from '../packages/brain-reflex/src/policy.ts';
import { Reward } from '../packages/brain-reflex/src/reward.ts';
import { Learner } from '../packages/brain-reflex/src/learn.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { MATERIALS } from '../packages/world/src/materials.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: true, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 26 });
const spot = w.findSurfaceSpot();
const c = new Creature(spot.x, spot.y, 1, 0);
const p = new ReflexPolicy();
const r = new Reward();
const l = new Learner({ ...({ lr: 0.02, batch: 512, clip: 1, baselineMomentum: 0.98 }) });
w.creature = c;
let lastReport = 0;
for (let t = 0; t < 12000 && c.alive; t++) {
  w.tickOnce();
  p.act(w, c, t * 0.16);
  const parts = r.step(c, p.sensors, 0, w.journal.total, 1/60);
  l.observe(p, parts.total);
  if (t - lastReport >= 3000) {
    lastReport = t;
    console.log(`тик ${String(t).padStart(5)}: награда/шаг ${parts.total.toFixed(3)} | средняя ${l.lastMeanReward.toFixed(3)} | база ${l.baselineValue.toFixed(3)} | разброс ${l.lastStd.toFixed(2)} | обновлений ${l.updates} | состояний ${r.visitedStates} | жив ${c.alive}`);
  }
}
console.log('итог: обновлений', l.updates, '| состояний увидено', r.visitedStates, '| суммарная награда', r.total.toFixed(1), '|', c.alive ? 'жив' : c.physiology.explainDeath());
let name = '';
for (const mm of MATERIALS) if (mm.id === 0) name = mm.name;
void name;
