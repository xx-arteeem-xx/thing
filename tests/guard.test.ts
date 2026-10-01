/**
 * Ф2, шаг 4: защита от деградации.
 *
 * Обучение без сторожа — это тихая порча: награда падает, навыки
 * затираются, и никто этого не замечает. Проверяем, что сторож
 * действительно возвращает лучшее состояние.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReflexPolicy } from '../packages/brain-reflex/src/policy.ts';
import { WeightGuard } from '../packages/brain-reflex/src/guard.ts';

test('сторож запоминает лучшее состояние', () => {
  const p = new ReflexPolicy();
  const g = new WeightGuard({ patience: 3, tolerance: 0.01 });

  g.observe(p, 1);
  const best = Array.from(p.weights.w1.slice(0, 6));
  g.observe(p, 0.5);

  assert.equal(g.rollbacks, 0, 'откат случился раньше времени');
  assert.deepEqual(Array.from(p.weights.w1.slice(0, 6)), best, 'веса изменились без отката');
  assert.equal(g.bestReward, 1);
});

test('после устойчивого ухудшения веса возвращаются к лучшим', () => {
  const p = new ReflexPolicy();
  const g = new WeightGuard({ patience: 3, tolerance: 0.01 });

  g.observe(p, 1);
  const best = Array.from(p.weights.w1.slice(0, 6));

  // Портим веса руками — как это сделало бы плохое обучение.
  for (let i = 0; i < 6; i++) p.weights.w1[i] += 5;

  let rolled = false;
  for (let k = 0; k < 5 && !rolled; k++) rolled = g.observe(p, 0.2);

  assert.ok(rolled, 'откат не произошёл');
  assert.deepEqual(Array.from(p.weights.w1.slice(0, 6)), best, 'веса не восстановлены');
  assert.equal(g.rollbacks, 1);
});

test('разовые просадки не считаются деградацией', () => {
  const p = new ReflexPolicy();
  const g = new WeightGuard({ patience: 4, tolerance: 0.01 });
  // Просадки чередуются с возвратом к прежнему уровню — это колебания,
  // а не деградация.
  g.observe(p, 1);
  g.observe(p, 0.5);
  g.observe(p, 1.0);
  g.observe(p, 0.4);
  g.observe(p, 1.0);
  g.observe(p, 0.6);
  g.observe(p, 1.0);
  assert.equal(g.rollbacks, 0, 'сторож сработал на случайных колебаниях');
});

test('улучшение сбрасывает счётчик ухудшений', () => {
  const p = new ReflexPolicy();
  const g = new WeightGuard({ patience: 3, tolerance: 0.01 });
  g.observe(p, 1);
  g.observe(p, 0.5);
  g.observe(p, 0.5);
  g.observe(p, 2); // стало лучше — новый эталон
  g.observe(p, 1.9);
  assert.equal(g.rollbacks, 0);
  assert.ok(g.bestReward >= 2, 'новый эталон не запомнен');
});

test('сброс сторожа забывает эталон', () => {
  const p = new ReflexPolicy();
  const g = new WeightGuard({ patience: 2, tolerance: 0.01 });
  g.observe(p, 1);
  g.reset();
  g.observe(p, 0.1);
  assert.equal(g.rollbacks, 0, 'после сброса сторож откатил к старому эталону');
});
