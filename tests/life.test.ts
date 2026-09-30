/**
 * Живой мир: свет, вода, растения и поколения леса.
 *
 * Эти проверки отвечают на вопрос «мир действительно живёт сам», а не
 * «картинка красивая». Именно от них зависит, будет ли существу что есть,
 * где прятаться и что исследовать.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAT } from '../packages/world/src/materials.ts';
import { WEATHER, computeSkyLight, strikeLightning } from '../packages/world/src/sim.ts';
import { count, emptyWorld, fillRect, makeWorld, run } from './helpers.ts';

test('небесный свет доходит до поверхности, но не проходит сквозь породу', () => {
  const w = emptyWorld(48, 48, 3);
  for (let x = 0; x < 48; x++) {
    for (let y = 20; y < 48; y++) w.grid.set(x, y, MAT.STONE);
  }
  run(w, 8);

  assert.ok(w.grid.light[10 * 48 + 24] > 200, 'над землёй должно быть светло');
  assert.equal(w.grid.light[30 * 48 + 24], 0, 'под породой должно быть темно');
});

test('сутки: полдень ярче полуночи', () => {
  const noon = computeSkyLight(0, 4800);
  const evening = computeSkyLight(1200, 4800);
  const night = computeSkyLight(2400, 4800);

  assert.ok(noon > 240, `в полдень свет ${noon}`);
  assert.ok(night < 60, `в полночь свет ${night}`);
  assert.ok(evening < noon && evening > night, `в промежутке свет ${evening}`);
});

test('мир рождается в тёплой полосе слева холоднее, чем справа', () => {
  const w = makeWorld(4242, 256, 128);
  const left = w.ambientAt(8, 100);
  const right = w.ambientAt(w.grid.w - 8, 100);
  assert.ok(left < right, `слева ${left} °C, справа ${right} °C — полосы температур нет`);
});

test('лёд в холодной полосе не тает', () => {
  const w = makeWorld(20251001, 256, 128);
  const before = count(w, MAT.ICE);
  assert.ok(before > 0, 'лёд не сгенерирован');
  run(w, 2000);
  assert.ok(count(w, MAT.ICE) > 0, 'лёд растаял, хотя слева мира должно быть холодно');
});

test('трава расползается по земле', () => {
  const w = emptyWorld(48, 32, 5);
  for (let x = 0; x < 48; x++) {
    for (let y = 28; y < 32; y++) w.grid.set(x, y, MAT.DIRT);
  }
  w.grid.set(24, 27, MAT.GRASS);
  const before = count(w, MAT.GRASS);

  run(w, 3000);

  const after = count(w, MAT.GRASS);
  assert.ok(after > before + 20, `трава почти не выросла: было ${before}, стало ${after}`);
});

test('семя прорастает и вырастает в дерево с кроной', () => {
  const w = emptyWorld(48, 64, 7);
  for (let x = 0; x < 48; x++) {
    w.grid.set(x, 60, MAT.DIRT);
    for (let y = 61; y < 64; y++) w.grid.set(x, y, MAT.STONE);
  }
  w.grid.set(24, 59, MAT.SEED);

  run(w, 9000);

  assert.ok(count(w, MAT.WOOD) > 3, `ствол не вырос: ${count(w, MAT.WOOD)}`);
  assert.ok(count(w, MAT.LEAVES) > 3, `крона не появилась: ${count(w, MAT.LEAVES)}`);
});

test('листва без ствола опадает', () => {
  const w = emptyWorld(48, 40, 11);
  fillRect(w, 20, 12, 27, 16, MAT.LEAVES);
  assert.ok(count(w, MAT.LEAVES) > 20);

  run(w, 1500);

  assert.equal(count(w, MAT.LEAVES), 0, 'листва осталась висеть без дерева');
});

test('лес сам себя расширяет: взрослое дерево роняет семя', () => {
  const w = emptyWorld(64, 48, 13);
  for (let x = 0; x < 64; x++) w.grid.set(x, 44, MAT.DIRT);
  for (let x = 0; x < 64; x++) {
    for (let y = 45; y < 48; y++) w.grid.set(x, y, MAT.STONE);
  }
  // одно взрослое дерево
  for (let y = 34; y < 44; y++) w.grid.set(32, y, MAT.WOOD);
  fillRect(w, 29, 30, 35, 34, MAT.LEAVES);

  run(w, 20000);

  const wood = count(w, MAT.WOOD);
  assert.ok(wood > 12, `новых деревьев не появилось: стволов ${wood}`);
});

test('мокрая земля превращается в грязь', () => {
  const w = emptyWorld(32, 24, 17);
  fillRect(w, 0, 20, 31, 23, MAT.DIRT);
  fillRect(w, 10, 16, 20, 19, MAT.WATER);

  run(w, 800);

  assert.ok(count(w, MAT.MUD) > 0, 'грязь так и не появилась');
});

test('дождь добавляет воду в мир', () => {
  const w = emptyWorld(64, 32, 19, { weather: true });
  for (let x = 0; x < 64; x++) w.grid.set(x, 31, MAT.STONE);

  w.weather.kind = WEATHER.RAIN;
  w.weather.until = w.tick + 100000;

  let wet = 0;
  for (let i = 0; i < 200; i++) {
    w.tickOnce();
    wet += count(w, MAT.WATER);
  }

  assert.ok(wet > 0, 'дождь не пролился');
});

test('молния поджигает сухое', () => {
  const w = emptyWorld(32, 32, 23, { weather: true });
  fillRect(w, 0, 28, 31, 31, MAT.DIRT);
  fillRect(w, 10, 26, 20, 27, MAT.LEAVES);

  strikeLightning(w, 15);
  assert.equal(w.grid.get(15, 26), MAT.FIRE, 'молния не подожгла листву');

  run(w, 200);
  assert.equal(count(w, MAT.LEAVES), 0, 'пожар не распространился по листве');
});

test('гроза рано или поздно случается в мире с погодой', () => {
  const w = emptyWorld(64, 32, 29, { weather: true });
  for (let x = 0; x < 64; x++) w.grid.set(x, 31, MAT.STONE);

  let rain = false;
  let anyWeather = false;
  for (let i = 0; i < 20000; i++) {
    w.tickOnce();
    if (w.weather.kind !== WEATHER.CLEAR) anyWeather = true;
    if (w.weather.kind === WEATHER.RAIN) rain = true;
  }
  assert.ok(anyWeather, 'погода ни разу не сменилась за 20000 тиков');
  assert.ok(rain, 'дождь ни разу не выпал за 20000 тиков');
});
