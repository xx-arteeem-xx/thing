/**
 * Ф2, шаг 2: внутренняя награда.
 *
 * Проверяем, что сигнал вообще есть и что он ведёт себя правильно:
 * новизна затухает, облегчение поощряется, боль и топтание наказываются.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Creature } from '../packages/body/src/creature.ts';
import { ReflexPolicy } from '../packages/brain-reflex/src/policy.ts';
import { Reward } from '../packages/brain-reflex/src/reward.ts';
import { REGION } from '../packages/body/src/physiology.ts';
import { MAT } from '../packages/world/src/materials.ts';
import { emptyWorld } from './helpers.ts';

function ground(seed = 1) {
  const w = emptyWorld(48, 32, seed, { weather: false });
  for (let x = 0; x < 48; x++) {
    w.grid.set(x, 31, MAT.STONE);
    w.grid.set(x, 30, MAT.DIRT);
    w.grid.set(x, 29, MAT.GRASS);
  }
  return w;
}

test('награда считается и остаётся конечной', () => {
  const w = ground(1);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  const r = new Reward();

  for (let t = 0; t < 300; t++) {
    w.tickOnce();
    c.step(w, 1 / 60, 0.2);
    p.act(w, c, t * 0.16);
    const parts = r.step(c, p.sensors, t % 16, w.journal.total, 1 / 60);
    assert.ok(Number.isFinite(parts.total), 'награда не число');
    assert.ok(Math.abs(parts.total) < 50, `награда вырвалась: ${parts.total}`);
  }
  assert.ok(Number.isFinite(r.total));
  assert.ok(r.visitedStates > 0, 'ни одного состояния не запомнено');
});

test('новизна затухает: то же состояние больше не радует', () => {
  const w = ground(2);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  const r = new Reward();
  w.tickOnce();
  p.act(w, c, 0);

  const first = r.step(c, p.sensors, 0, 0, 1 / 60);
  let later = first;
  for (let k = 0; k < 50; k++) later = r.step(c, p.sensors, 0, 0, 1 / 60);

  assert.ok(first.novelty > later.novelty, 'новизна не затухает');
  assert.ok(later.novelty < 0.05, `новизна осталась ${later.novelty}`);
});

test('боль наказывается', () => {
  const w = ground(3);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  const r = new Reward();
  w.tickOnce();
  p.act(w, c, 0);
  const calm = r.step(c, p.sensors, 0, 0, 1 / 60);

  c.hurt(REGION.TORSO, 40, 'cut');
  p.act(w, c, 0);
  const hurt = r.step(c, p.sensors, 0, 0, 1 / 60);

  assert.ok(hurt.pain < 0, 'боль не наказана');
  assert.ok(hurt.total < calm.total, 'с болью стало не хуже, чем без неё');
});

test('облегчение поощряется', () => {
  const w = ground(4);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  const r = new Reward();
  w.tickOnce();
  p.act(w, c, 0);

  // Делаем существу плохо, потом резко легче.
  c.physiology.fear = 0.9;
  c.hurt(REGION.L_ARM, 10, 'cut');
  r.step(c, p.sensors, 0, 0, 1 / 60);

  c.physiology.fear = 0;
  c.physiology.pain.fill(0);
  p.act(w, c, 0);
  const relief = r.step(c, p.sensors, 0, 0, 1 / 60);

  assert.ok(relief.drives > 0, `облегчение не поощрено: ${relief.drives}`);
});

test('топтание на месте наказывается', () => {
  const w = ground(5);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  const r = new Reward();
  w.tickOnce();
  p.act(w, c, 0);

  let parts = r.step(c, p.sensors, 7, 0, 1 / 60);
  for (let k = 0; k < 200; k++) parts = r.step(c, p.sensors, 7, 0, 1 / 60);

  assert.ok(parts.repetition < 0, 'повтор не наказан');
});

test('открытие мира поощряется', () => {
  const w = ground(6);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  const r = new Reward();
  w.tickOnce();
  p.act(w, c, 0);

  r.step(c, p.sensors, 0, 10, 1 / 60);
  const after = r.step(c, p.sensors, 0, 12, 1 / 60);

  assert.ok(after.discovery > 0, 'новое открытие мира не поощрено');
  const again = r.step(c, p.sensors, 0, 12, 1 / 60);
  assert.equal(again.discovery, 0, 'одно открытие посчитано дважды');
});

test('программа взросления: сначала безопасность, потом любопытство', () => {
  const w = ground(7);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  const r = new Reward();
  w.tickOnce();
  p.act(w, c, 0);

  r.setAge(0);
  const atBirth = { novelty: r.noveltyScale, safety: r.safetyScale };
  r.setAge(36000);
  const atMaturity = { novelty: r.noveltyScale, safety: r.safetyScale };

  assert.ok(atBirth.novelty < atMaturity.novelty, 'новизна не растёт со возрастом');
  assert.ok(atBirth.safety > atMaturity.safety, 'забота о себе не уступает любопытству');
  assert.ok(atMaturity.novelty > 0.9, 'взрослое существо не становится любопытным');
});

test('программа меняет награду, а не только числа', () => {
  const w = ground(8);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  const young = new Reward();
  const old = new Reward();
  w.tickOnce();
  p.act(w, c, 0);

  young.setAge(0);
  old.setAge(36000);

  const a = young.step(c, p.sensors, 0, 0, 1 / 60);
  const b = old.step(c, p.sensors, 0, 0, 1 / 60);

  assert.ok(
    Math.abs(a.novelty - b.novelty) > 1e-6,
    'взросление не влияет на награду за новизну',
  );
  assert.ok(b.novelty > a.novelty, 'у взрослого новизна не весит больше');
});
