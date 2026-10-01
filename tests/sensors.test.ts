/**
 * Датчики: существо должно чувствовать то, что с ним происходит.
 * Это вход будущего рефлекторного мозга, поэтому проверяем и размер
 * вектора, и что он действительно меняется от событий в мире.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Creature } from '../packages/body/src/creature.ts';
import { readSensors, SENSE, SENSE_COUNT, senseLabels } from '../packages/body/src/sensors.ts';
import { REGION } from '../packages/body/src/physiology.ts';
import { MAT } from '../packages/world/src/materials.ts';
import { emptyWorld } from './helpers.ts';

function ground(seed = 1, width = 48, height = 32) {
  const w = emptyWorld(width, height, seed, { weather: false });
  for (let x = 0; x < width; x++) {
    w.grid.set(x, height - 1, MAT.STONE);
    w.grid.set(x, height - 2, MAT.DIRT);
    w.grid.set(x, height - 3, MAT.GRASS);
  }
  return w;
}

function live(w: ReturnType<typeof ground>, c: Creature, ticks: number): void {
  for (let t = 0; t < ticks && c.alive; t++) {
    w.tickOnce();
    c.step(w, 1 / 60, 0.2);
  }
}

test('вектор наблюдений имеет объявленный размер и без дыр', () => {
  const w = ground(1);
  const c = new Creature(24, 25, 1, 0);
  const out = new Float32Array(SENSE_COUNT);
  readSensors(w, c, out);

  assert.equal(out.length, SENSE_COUNT);
  assert.equal(senseLabels().length, SENSE_COUNT, 'подписи не совпадают с раскладкой');
  for (let i = 0; i < out.length; i++) {
    assert.ok(Number.isFinite(out[i]), `датчик ${i} вернул не число`);
    assert.ok(Math.abs(out[i]) <= 4, `датчик ${i} вышел за пределы: ${out[i]}`);
  }
});

test('датчики замечают боль', () => {
  const w = ground(2);
  const c = new Creature(24, 25, 1, 0);
  const before = new Float32Array(SENSE_COUNT);
  readSensors(w, c, before);

  c.hurt(REGION.L_LEG, 30, 'cut');

  const after = new Float32Array(SENSE_COUNT);
  readSensors(w, c, after);

  assert.ok(after[SENSE.PAIN + REGION.L_LEG] > before[SENSE.PAIN + REGION.L_LEG], 'боль не видна');
  assert.ok(after[SENSE.DRIVES + 4] > before[SENSE.DRIVES + 4], 'общая боль не выросла');
  assert.equal(after[SENSE.PAIN + REGION.R_LEG], 0, 'болит здоровая нога');
});

test('существо чувствует, что стоит на земле', () => {
  const w = ground(3);
  const c = new Creature(24, 25, 1, 0);
  live(w, c, 300);

  const out = new Float32Array(SENSE_COUNT);
  readSensors(w, c, out);

  // Мышцы держат позу, поэтому важно, что опора чувствуется хотя бы одной
  // стопой, а не что стоят обе.
  const feet = out[SENSE.CONTACT + 0] + out[SENSE.CONTACT + 1];
  assert.ok(feet >= 1, 'ни одна стопа не чувствует опоры');
  assert.ok(out[SENSE.ORIENTATION + 1] > 0, 'существо не понимает, что стоит вверх головой');
});

test('существо видит огонь впереди', () => {
  const w = ground(4);
  const c = new Creature(24, 25, 1, 0);
  live(w, c, 120);

  const headY = Math.round(c.body.y[3]);
  const headX = Math.round(c.body.x[3]);
  // Кладём огонь с обеих сторон: тело могло развернуться, а проверяем
  // мы зрение, а не ориентацию.
  for (let k = 1; k <= 3; k++) {
    w.grid.set(headX + k, headY, MAT.FIRE);
    w.grid.set(headX - k, headY, MAT.FIRE);
  }

  const out = new Float32Array(SENSE_COUNT);
  readSensors(w, c, out);

  const sight = [];
  for (let k = 0; k < 9; k++) sight.push(out[SENSE.SIGHT + k]);
  assert.ok(sight.some((v) => v < -0.5), `огонь не виден: ${sight.join(', ')}`);
});

test('голод, жажда и усталость растут и видны датчикам', () => {
  const w = ground(5);
  const c = new Creature(24, 25, 1, 0);
  const before = new Float32Array(SENSE_COUNT);
  readSensors(w, c, before);

  live(w, c, 1800);

  const after = new Float32Array(SENSE_COUNT);
  readSensors(w, c, after);

  assert.ok(after[SENSE.DRIVES + 0] > before[SENSE.DRIVES + 0], 'голод не чувствуется');
  assert.ok(after[SENSE.DRIVES + 1] > before[SENSE.DRIVES + 1], 'жажда не чувствуется');
  assert.ok(after[SENSE.DRIVES + 2] > before[SENSE.DRIVES + 2], 'усталость не чувствуется');
});

test('под водой существо чувствует нехватку кислорода', () => {
  const w = ground(6);
  const c = new Creature(24, 20, 1, 0);
  for (let x = 10; x < 40; x++) {
    for (let y = 8; y < 30; y++) w.grid.set(x, y, MAT.WATER);
  }

  live(w, c, 300);

  const out = new Float32Array(SENSE_COUNT);
  readSensors(w, c, out);
  assert.ok(out[SENSE.VITALS + 1] < 0.9, `кислород не падает: ${out[SENSE.VITALS + 1]}`);
});

test('вектор наблюдений не зависит от предыдущего содержимого буфера', () => {
  const w = ground(7);
  const c = new Creature(24, 25, 1, 0);
  const clean = new Float32Array(SENSE_COUNT);
  const dirty = new Float32Array(SENSE_COUNT).fill(99);

  readSensors(w, c, clean);
  readSensors(w, c, dirty);

  for (let i = 0; i < SENSE_COUNT; i++) {
    assert.equal(dirty[i], clean[i], `датчик ${i} не перезаписан`);
  }
});
