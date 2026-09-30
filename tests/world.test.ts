/**
 * Поведение мира: проверяем правила, а не картинку.
 * Каждый тест отвечает на вопрос «работает ли закон», который понадобится
 * существу: сыпучесть, течение, огонь, тепло, фазовые переходы.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAT } from '../packages/world/src/materials.ts';
import {
  addFloor,
  count,
  emptyWorld,
  fillRect,
  positionsOf,
  run,
} from './helpers.ts';

test('песок падает и останавливается на опоре', () => {
  const w = emptyWorld(32, 32, 5);
  addFloor(w, 31);
  w.grid.set(16, 5, MAT.SAND);
  run(w, 120);

  assert.equal(w.grid.get(16, 30), MAT.SAND);
  assert.equal(count(w, MAT.SAND), 1);
});

test('песок не проваливается сквозь камень и не исчезает', () => {
  const w = emptyWorld(32, 32, 6);
  addFloor(w, 31);
  for (let x = 14; x <= 18; x++) w.grid.set(x, 5, MAT.SAND);

  run(w, 300);

  assert.equal(count(w, MAT.SAND), 5, 'часть песка потерялась');
  for (const p of positionsOf(w, MAT.SAND)) {
    assert.equal(p.y, 30, `песок оказался на высоте ${p.y}, а должен лежать на опоре`);
  }
});

test('вода растекается и заполняет низину', () => {
  const w = emptyWorld(32, 32, 7);
  addFloor(w, 31);
  for (let y = 24; y <= 30; y++) {
    w.grid.set(8, y, MAT.STONE);
    w.grid.set(23, y, MAT.STONE);
  }
  fillRect(w, 9, 26, 22, 29, MAT.WATER);

  run(w, 600);

  assert.equal(count(w, MAT.WATER), 14 * 4, 'вода потерялась или размножилась');
  for (const p of positionsOf(w, MAT.WATER)) {
    assert.ok(p.x > 8 && p.x < 23, `вода вышла за стенки бассейна: x=${p.x}`);
  }
  // Нижний слой должен быть заполнен целиком
  for (let x = 9; x <= 22; x++) {
    assert.equal(w.grid.get(x, 30), MAT.WATER, `низ бассейна не заполнен при x=${x}`);
  }
});

test('огонь поджигает дерево, оставляет дым и не может гореть вечно', () => {
  const w = emptyWorld(32, 32, 11);
  addFloor(w, 31);
  w.grid.set(16, 30, MAT.WOOD);
  w.grid.set(15, 30, MAT.FIRE);

  let sawSmoke = false;
  for (let i = 0; i < 900; i++) {
    w.tickOnce();
    if (!sawSmoke && count(w, MAT.SMOKE) > 0) sawSmoke = true;
  }

  assert.equal(count(w, MAT.WOOD), 0, 'дерево не сгорело');
  assert.ok(sawSmoke, 'при горении не появился дым');
  assert.ok(count(w, MAT.FIRE) < 3, 'огонь расплодился и не гаснет');
});

test('вода тушит огонь и превращается в пар', () => {
  const w = emptyWorld(32, 32, 13);
  addFloor(w, 31);
  w.grid.set(16, 30, MAT.FIRE);
  w.grid.set(17, 30, MAT.WATER);

  let sawSteam = false;
  for (let i = 0; i < 60; i++) {
    w.tickOnce();
    if (count(w, MAT.STEAM) > 0) sawSteam = true;
  }

  assert.equal(count(w, MAT.FIRE), 0, 'огонь не погас от воды');
  assert.ok(sawSteam, 'вода не превратилась в пар при тушении');
});

test('лёд тает выше нуля', () => {
  const w = emptyWorld(32, 32, 17);
  addFloor(w, 31);
  fillRect(w, 10, 25, 21, 30, MAT.ICE);
  // Приводим лёд к +10 °C (в мире ambient 20, значит сдвиг -10)
  w.heat(16, 28, 20, -10);

  run(w, 400);

  assert.ok(count(w, MAT.ICE) < count(w, MAT.WATER), 'лёд не начал таять');
  assert.ok(count(w, MAT.WATER) > 0, 'талой воды нет вовсе');
});

test('вода замерзает ниже нуля', () => {
  const w = emptyWorld(32, 32, 19);
  addFloor(w, 31);
  fillRect(w, 10, 25, 21, 30, MAT.WATER);
  w.heat(16, 28, 20, -60); // около -40 °C
  w.thermalIdle = false;

  let sawIce = false;
  for (let i = 0; i < 120; i++) {
    w.tickOnce();
    if (count(w, MAT.ICE) > 0) {
      sawIce = true;
      break;
    }
  }

  assert.ok(sawIce, 'холодная вода не замерзает');
});

test('пар поднимается вверх', () => {
  const w = emptyWorld(32, 48, 23);
  addFloor(w, 47);
  fillRect(w, 14, 40, 17, 43, MAT.STEAM);

  run(w, 10);

  const steam = positionsOf(w, MAT.STEAM);
  assert.ok(steam.length > 0, 'пар исчез за десять тиков');
  const avgY = steam.reduce((s, p) => s + p.y, 0) / steam.length;
  assert.ok(avgY < 41.5, `пар не поднимается: средняя высота ${avgY.toFixed(1)}`);
});

test('дым в конце концов рассеивается', () => {
  const w = emptyWorld(32, 48, 29);
  addFloor(w, 47);
  fillRect(w, 14, 20, 17, 22, MAT.SMOKE);

  run(w, 1200);

  assert.equal(count(w, MAT.SMOKE), 0, 'дым остался навсегда');
});

test('мир переживает 1000 тиков без исключений и без потери материи', () => {
  const w = emptyWorld(48, 48, 31);
  addFloor(w, 47);

  fillRect(w, 4, 10, 12, 14, MAT.SAND);
  fillRect(w, 20, 10, 30, 16, MAT.WATER);
  fillRect(w, 34, 10, 44, 20, MAT.WOOD);
  w.grid.set(35, 20, MAT.FIRE);

  const before = w.grid.mat.length - count(w, MAT.AIR);

  run(w, 1000);

  const after = w.grid.mat.length - count(w, MAT.AIR);
  assert.ok(after > 0, 'мир опустел');
  assert.ok(
    after <= before,
    `материи стало больше, чем было: ${after} против ${before}`,
  );
});

test('кисть наблюдателя рисует и стирает', () => {
  const w = emptyWorld(32, 32, 37);
  const painted = w.paint(16, 16, 4, MAT.STONE);
  assert.ok(painted > 20, `кисть нарисовала всего ${painted} клеток`);
  assert.equal(count(w, MAT.STONE), painted);

  const erased = w.paint(16, 16, 4, MAT.AIR);
  assert.equal(erased, painted);
  assert.equal(count(w, MAT.STONE), 0);
});

test('нагрев и охлаждение меняют температуру, а не вещество', () => {
  const w = emptyWorld(16, 16, 41);
  w.grid.set(8, 8, MAT.STONE);
  const before = w.grid.temp[8 * 16 + 8];

  w.heat(8, 8, 2, 300);
  assert.equal(w.grid.temp[8 * 16 + 8], before + 300);
  assert.equal(w.grid.get(8, 8), MAT.STONE);
  assert.equal(w.thermalIdle, false);
});
