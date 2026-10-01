// Проверка критерия приёмки Ф2: 7 суток без вмешательства.
import { Creature } from '../packages/body/src/creature.ts';
import { ReflexPolicy } from '../packages/brain-reflex/src/policy.ts';
import { Reward } from '../packages/brain-reflex/src/reward.ts';
import { Learner } from '../packages/brain-reflex/src/learn.ts';
import { WeightGuard } from '../packages/brain-reflex/src/guard.ts';
import { World } from '../packages/world/src/world.ts';
import { generateTerrain } from '../packages/world/src/terrain.ts';
import { SEG } from '../packages/body/src/body.ts';

const w = new World({ width: 512, height: 256, seed: 20251001, ambient: 20, heatEveryTicks: 4, lightEveryTicks: 16, dayLengthTicks: 4800, weather: true, maxWaterCells: 4500, journalFile: null });
generateTerrain(w, { trees: 26 });
const spot = w.findSurfaceSpot(undefined, { nearWater: 40 });
const c = new Creature(spot.x, spot.y, 1, 0);
const p = new ReflexPolicy();
const r = new Reward();
const l = new Learner();
const g = new WeightGuard();
w.creature = c;

const DAY = 4800, TOTAL = DAY * 7;
let gait = 0, ate = 0, drank = 0, lastEat = -1;
const xs: number[] = [];
const t0 = Date.now();
for (let t = 0; t < TOTAL && c.alive; t++) {
  const want = p.survival(w, c);
  if (want.eating) { ate++; lastEat = t; }
  if (want.drinking) drank++;
  c.drinking = want.drinking; c.eating = want.eating;
  c.walkDirection = want.dir !== 0 ? want.dir : c.walkDirection;
  gait += 0.16 * c.walkDirection;
  c.walk(gait, w);
  w.tickOnce();
  p.act(w, c, t * 0.16);
  r.setAge(w.tick - c.bornTick);
  const parts = r.step(c, p.sensors, 0, w.journal.total, 1/60);
  if (l.observe(p, parts.total)) g.observe(p, l.lastMeanReward);
  if (t % 60 === 0) xs.push(Math.round(c.body.x[SEG.PELVIS]));
}
const secs = (Date.now() - t0) / 1000;
const uniq = new Set(xs).size;
const span = Math.max(...xs) - Math.min(...xs);
console.log(`прогон ${TOTAL} тиков (7 суток мира) за ${secs.toFixed(0)} с реального времени`);
console.log(`  жив: ${c.alive}${c.alive ? '' : ' — ' + c.physiology.explainDeath()}`);
console.log(`  ел: ${ate} тиков, пил: ${drank} тиков`);
console.log(`  новизна: состояний ${r.visitedStates}, награда за жизнь ${r.total.toFixed(0)}`);
console.log(`  петля: уникальных позиций ${uniq} из ${xs.length} замеров, разброс ${span} клеток`);
console.log(`  обучение: обновлений ${l.updates}, откатов ${g.rollbacks}`);
console.log(`  тело: ${c.physiology.summary()}`);
