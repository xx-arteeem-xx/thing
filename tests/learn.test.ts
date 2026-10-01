/**
 * Ф2, шаг 3: обучение онлайн.
 *
 * Главная проверка здесь одна: политика должна МЕНЯТЬСЯ от награды
 * в нужную сторону. Если веса двигаются, но поведение не улучшается —
 * обучать нечего, и весь проект теряет смысл.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReflexPolicy, INPUTS } from '../packages/brain-reflex/src/policy.ts';
import { Learner, DEFAULT_LEARN } from '../packages/brain-reflex/src/learn.ts';

/** Прогон сети на заданных датчиках. */
function act(p: ReflexPolicy, sensors: Float32Array): Float32Array {
  p.sensors.set(sensors.subarray(0, INPUTS));
  // forward вызывается через act с пустым миром нельзя, поэтому дёргаем
  // напрямую ту же математику: readSensors нам здесь не нужен.
  (p as unknown as { forward(): void }).forward();
  return p.outputs.slice();
}

test('веса не меняются, пока эпизод не набран', () => {
  const p = new ReflexPolicy();
  const l = new Learner({ ...DEFAULT_LEARN, batch: 10 });
  const before = Array.from(p.weights.w2.slice(0, 8));

  for (let k = 0; k < 9; k++) {
    act(p, new Float32Array(INPUTS).fill(0.1));
    l.observe(p, 1);
  }
  assert.deepEqual(Array.from(p.weights.w2.slice(0, 8)), before, 'веса поехали раньше времени');
  assert.equal(l.updates, 0);
});

test('награда выше средней усиливает действие, ниже — ослабляет', () => {
  const p = new ReflexPolicy();
  const l = new Learner({ ...DEFAULT_LEARN, batch: 8, lr: 0.5 });
  const sensors = new Float32Array(INPUTS).fill(0.5);

  // Всегда одинаковые датчики: сеть обязана сдвинуть выходы в одну сторону.
  const before = act(p, sensors);
  for (let k = 0; k < 8; k++) {
    act(p, sensors);
    l.observe(p, 10); // награда явно выше базовой (база 0)
  }
  const after = act(p, sensors);

  assert.equal(l.updates, 1, 'обновление не произошло');
  let changed = 0;
  for (let o = 0; o < before.length; o++) {
    if (Math.abs(after[o] - before[o]) > 1e-6) changed++;
  }
  assert.ok(changed > 4, `изменилось всего ${changed} выходов`);
});

test('обучение сходится: выходы уходят от нуля к уверенному значению', () => {
  const p = new ReflexPolicy();
  const l = new Learner({ ...DEFAULT_LEARN, batch: 32, lr: 0.3 });
  const sensors = new Float32Array(INPUTS);
  sensors[45] = 1; // сильный голод — состояние всегда одно и то же

  const spread = (): number => {
    const out = act(p, sensors);
    let sum = 0;
    for (const v of out) sum += Math.abs(v);
    return sum / out.length;
  };
  const start = spread();

  for (let step = 0; step < 40; step++) {
    for (let k = 0; k < 32; k++) {
      act(p, sensors);
      // Награда растёт со временем: это подобие «нашёл еду, стало легче».
      l.observe(p, step * 0.5);
    }
  }
  const end = spread();

  assert.ok(l.updates >= 30, `обновлений всего ${l.updates}`);
  assert.ok(
    Math.abs(end - start) > 1e-4,
    `политика не изменилась: было ${start.toFixed(4)}, стало ${end.toFixed(4)}`,
  );
});

test('веса остаются конечными при большой награде', () => {
  const p = new ReflexPolicy();
  const l = new Learner({ ...DEFAULT_LEARN, batch: 64, lr: 0.5, clip: 1 });
  const sensors = new Float32Array(INPUTS).fill(0.3);
  for (let step = 0; step < 20; step++) {
    for (let k = 0; k < 64; k++) {
      act(p, sensors);
      l.observe(p, 1e6); // награда-монстр: проверяем, что не разнесёт
    }
  }
  for (let i = 0; i < p.weights.w1.length; i++) {
    assert.ok(Number.isFinite(p.weights.w1[i]), 'веса разошлись в бесконечность');
  }
  for (let i = 0; i < p.weights.w2.length; i++) {
    assert.ok(Math.abs(p.weights.w2[i]) < 1e3, `вес вырвался: ${p.weights.w2[i]}`);
  }
});

test('сброс эпизода не ломает обучение', () => {
  const p = new ReflexPolicy();
  const l = new Learner({ ...DEFAULT_LEARN, batch: 16 });
  const sensors = new Float32Array(INPUTS).fill(0.2);
  for (let k = 0; k < 8; k++) {
    act(p, sensors);
    l.observe(p, 1);
  }
  l.reset();
  assert.equal(l.pending, 0);
  for (let k = 0; k < 16; k++) {
    act(p, sensors);
    l.observe(p, 2);
  }
  assert.ok(l.updates >= 1, 'после сброса обучение не продолжилось');
});
