import { Creature } from '../packages/body/src/creature.ts';
import { ReflexPolicy } from '../packages/brain-reflex/src/policy.ts';
import { Reward } from '../packages/brain-reflex/src/reward.ts';
import { Learner } from '../packages/brain-reflex/src/learn.ts';
import { WeightGuard } from '../packages/brain-reflex/src/guard.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: true, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 26 });
const spot = w.findSurfaceSpot();
let c = new Creature(spot.x, spot.y, 1, 0);
let p = new ReflexPolicy();
const r = new Reward();
const l = new Learner();
const g = new WeightGuard();
w.creature = c;
let report = 0, lives = 1;
for (let t = 0; t < 60000; t++) {
  if (!c.alive) { lives++; c = new Creature(spot.x, spot.y, lives, w.tick); w.creature = c; l.reset(); g.reset(); }
  w.tickOnce();
  p.act(w, c, t * 0.16);
  r.setAge(w.tick - c.bornTick);
  const parts = r.step(c, p.sensors, 0, w.journal.total, 1/60);
  if (l.observe(p, parts.total)) g.observe(p, l.lastMeanReward);
  if (t - report >= 12000) {
    report = t;
    console.log(`тик ${String(t).padStart(5)}: средняя ${l.lastMeanReward.toFixed(3)} | новизна×${r.noveltyScale.toFixed(2)} покой×${r.safetyScale.toFixed(2)} | обновл ${l.updates} | откатов ${g.rollbacks} | состояний ${r.visitedStates} | жизней ${lives}`);
  }
}
console.log('итог:', 'жизней', lives, '| обновлений', l.updates, '| откатов', g.rollbacks, '| состояний', r.visitedStates, '| награда', r.total.toFixed(0));
