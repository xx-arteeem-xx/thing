/**
 * Ф1, шаг 2: физиология.
 *
 * Проверяем, что у существа есть различимые способы умереть и что боль,
 * голод и жажда — это сигналы, а не украшение: на них будет опираться
 * и рефлекторный мозг, и языковой контур.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEATH_CAUSE,
  Physiology,
  REGION,
  REGION_COUNT,
  type PhysiologyContext,
} from '../packages/body/src/physiology.ts';

const CALM: PhysiologyContext = {
  ambient: 22,
  submerged: false,
  activity: 0.2,
  eating: false,
  drinking: false,
  insulation: 0.3,
};

function run(p: Physiology, seconds: number, ctx: Partial<PhysiologyContext> = {}): void {
  const c = { ...CALM, ...ctx };
  for (let t = 0; t < seconds * 10 && p.alive; t++) p.step(0.1, c);
}

test('здоровое тело живёт в покое и не умирает само', () => {
  const p = new Physiology();
  run(p, 120);
  assert.ok(p.alive, `существо умерло ни с того ни с сего: ${p.explainDeath()}`);
  assert.ok(p.blood > 4.5, 'кровь ушла без причины');
  assert.ok(p.oxygen > 90, 'кислород упал без причины');
});

test('без еды наступает истощение', () => {
  const p = new Physiology();
  run(p, 6000, { activity: 0.6, drinking: true });
  assert.equal(p.alive, false, 'существо не умерло от голода');
  assert.equal(p.deathCause, DEATH_CAUSE.STARVATION);
});

test('без воды наступает обезвоживание', () => {
  const p = new Physiology();
  p.glucose = 8;
  p.glycogen = 600;
  // Едим постоянно, чтобы смерть была именно от жажды.
  run(p, 900, { eating: true, activity: 0.1 });
  assert.equal(p.alive, false, 'существо не умерло от жажды');
  assert.equal(p.deathCause, DEATH_CAUSE.DEHYDRATION);
});

test('под водой наступает удушье', () => {
  const p = new Physiology();
  run(p, 60, { submerged: true });
  assert.equal(p.alive, false, 'существо не утонуло');
  assert.equal(p.deathCause, DEATH_CAUSE.ASPHYXIA);
});

test('на морозе наступает переохлаждение', () => {
  const p = new Physiology();
  run(p, 900, { ambient: -30, insulation: 0 });
  assert.equal(p.alive, false, 'существо не замёрзло');
  assert.equal(p.deathCause, DEATH_CAUSE.HYPOTHERMIA);
});

test('в жаре наступает перегрев', () => {
  const p = new Physiology();
  run(p, 900, { ambient: 90, insulation: 0, drinking: true, eating: true });
  assert.equal(p.alive, false, 'существо не перегрелось');
  assert.equal(p.deathCause, DEATH_CAUSE.OVERHEAT);
});

test('резаная рана приводит к кровопотере', () => {
  const p = new Physiology();
  p.applyDamage(REGION.L_ARM, 30, 'cut');
  assert.ok(p.pain[REGION.L_ARM] > 0.15, 'рана не вызвала боли');
  assert.ok(p.adrenaline > 0.2, 'рана не подняла адреналин');

  run(p, 600, { eating: true, drinking: true });
  assert.ok(p.bloodLost > 0.2, 'кровь не потеряна');
  assert.ok(p.blood < 5, 'объём крови не изменился');
});

test('тяжёлая рана головы убивает', () => {
  const p = new Physiology();
  // Сотня единиц урона — это смертельная рана целиком, поэтому бьём трижды.
  p.applyDamage(REGION.HEAD, 60, 'blunt');
  p.applyDamage(REGION.HEAD, 60, 'blunt');
  p.applyDamage(REGION.HEAD, 60, 'blunt');
  run(p, 5);
  assert.equal(p.alive, false, 'смертельная рана головы не убила');
  assert.equal(p.deathCause, DEATH_CAUSE.TRAUMA);
});

test('рана заживает, если существо сыто и не bleeding дальше', () => {
  const p = new Physiology();
  p.applyDamage(REGION.TORSO, 6, 'blunt');
  const before = p.wounds.length;
  run(p, 400, { eating: true });
  assert.ok(p.wounds.length <= before, 'раны не заживают');
  assert.ok(p.painLevel < 0.5, 'боль не утихла');
});

test('кровопотеря приводит к шоку и потере сознания', () => {
  const p = new Physiology();
  p.applyDamage(REGION.TORSO, 45, 'cut');
  p.applyDamage(REGION.L_LEG, 45, 'cut');
  let lostConsciousness = false;
  for (let t = 0; t < 3000 && p.alive; t++) {
    p.step(0.1, CALM);
    if (!p.conscious) lostConsciousness = true;
  }
  assert.ok(lostConsciousness, 'существо не потеряло сознание при кровопотере');
});

test('драйвы растут: голод, жажда, усталость', () => {
  const p = new Physiology();
  const hunger0 = p.hunger;
  const thirst0 = p.thirst;
  run(p, 300, { activity: 0.8 });
  assert.ok(p.hunger > hunger0, 'голод не растёт');
  assert.ok(p.thirst > thirst0, 'жажда не растёт');
  assert.ok(p.fatigue > 0, 'усталость не растёт');
});

test('еда и питьё восстанавливают силы', () => {
  const p = new Physiology();
  run(p, 200, { activity: 0.8 });
  const before = p.glucose;
  run(p, 30, { eating: true, drinking: true, activity: 0.2 });
  assert.ok(p.glucose > before, 'еда не восстановила глюкозу');
  assert.ok(p.hydration > 0.9, 'питьё не восстановило воду');
});

test('вскрытие объясняет причину смерти', () => {
  const p = new Physiology();
  run(p, 60, { submerged: true });
  const text = p.explainDeath();
  assert.ok(text.includes(DEATH_CAUSE.ASPHYXIA), `вскрытие не назвало причину: ${text}`);
});

test('боль считается по шести частям тела', () => {
  assert.equal(REGION_COUNT, 6);
  const p = new Physiology();
  p.applyDamage(REGION.L_LEG, 20, 'burn');
  assert.ok(p.pain[REGION.L_LEG] > 0, 'нога не болит');
  assert.equal(p.pain[REGION.R_LEG], 0, 'болит здоровая нога');
});
