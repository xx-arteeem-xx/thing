/**
 * Ф1, шаг 3: существо целиком — мир калечит его, он умирает, и вскрытие
 * объясняет, что именно его убило.
 *
 * Отдельно проверяется инвариант И7: воскрешение недостижимо из мира.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Creature } from '../packages/body/src/creature.ts';
import { MAT } from '../packages/world/src/materials.ts';
import { emptyWorld } from './helpers.ts';
import { World } from '../packages/world/src/world.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function ground(seed = 1, width = 48, height = 32) {
  const w = emptyWorld(width, height, seed, { weather: false });
  for (let x = 0; x < width; x++) {
    w.grid.set(x, height - 1, MAT.STONE);
    w.grid.set(x, height - 2, MAT.DIRT);
    w.grid.set(x, height - 3, MAT.GRASS);
  }
  return w;
}

function live(w: ReturnType<typeof ground>, c: Creature, ticks: number, activity = 0.2): void {
  for (let t = 0; t < ticks && c.alive; t++) {
    w.tickOnce();
    c.step(w, 1 / 60, activity);
  }
}

test('существо рождается живым и здоровым', () => {
  const c = new Creature(24, 20, 1, 0);
  assert.ok(c.alive);
  assert.equal(c.generation, 1);
  assert.equal(c.physiology.blood, 5);
  assert.equal(c.autopsy().cause, 'жив');
});

test('в спокойном мире существо не умирает само', () => {
  const w = ground(2);
  const c = new Creature(24, 25, 1, 0);
  live(w, c, 600);
  assert.ok(c.alive, `существо умерло без причины: ${c.physiology.explainDeath()}`);
});

test('огонь убивает: существо горит и погибает', () => {
  const w = ground(3);
  const c = new Creature(24, 25, 1, 0);
  // Поджигаем всё вокруг тела: огонь должен доставать до сегментов.
  for (let x = 20; x <= 28; x++) {
    for (let y = 24; y <= 29; y++) w.grid.set(x, y, MAT.FIRE);
  }

  live(w, c, 900);

  assert.equal(c.alive, false, `существо выжило в огне: ${c.physiology.explainDeath()}`);
  assert.ok(c.physiology.totalDamage > 0, 'огонь не нанёс повреждений');
  assert.ok(c.physiology.painLevel > 0 || c.physiology.wounds.length > 0, 'огонь не оставил следов');
});

test('удушье убивает, если голова под водой', () => {
  const w = ground(4);
  const c = new Creature(24, 20, 1, 0);
  // Погружаем тело в воду.
  for (let x = 10; x < 40; x++) {
    for (let y = 8; y < 30; y++) w.grid.set(x, y, MAT.WATER);
  }

  live(w, c, 1200);

  assert.equal(c.alive, false, 'существо не утонуло');
  assert.ok(
    c.physiology.deathCause === 'удушье' || c.physiology.deathCause === 'кровопотеря',
    `неожиданная причина: ${c.physiology.deathCause}`,
  );
});

test('вскрытие объясняет смерть и показывает цепочку', () => {
  const w = ground(5);
  const c = new Creature(24, 25, 1, 0);
  // Запасаемся всем, кроме крови: смерть должна быть именно от ран.
  c.physiology.glucose = 8;
  c.physiology.glycogen = 600;
  c.physiology.hydration = 1;
  c.hurt(1, 45, 'cut');
  c.hurt(4, 45, 'cut');
  // Кормим и поим, чтобы смерть была именно от ран, а не от голода.
  for (let t = 0; t < 90000 && c.alive; t++) {
    w.tickOnce();
    c.step(w, 1 / 60, 0.2);
    c.physiology.eat(1);
    c.physiology.drink(1);
  }

  const a = c.autopsy();
  assert.equal(a.cause, 'кровопотеря');
  assert.ok(a.chain.length > 0, 'вскрытие не назвало цепочку причин');
  assert.ok(a.chain.some((line) => line.includes('крови')), 'вскрытие не упомянуло кровь');
  assert.ok(a.timeline.length > 0, 'нет хронологии жизни');
  assert.ok(a.ageTicks > 0, 'возраст не посчитан');
});

test('после смерти существо больше не двигается и не думает', () => {
  const w = ground(6);
  const c = new Creature(24, 25, 1, 0);
  // Трёх тяжёлых ударов по голове хватает, одного — нет: урон накапливается.
  c.hurt(0, 60, 'blunt');
  c.hurt(0, 60, 'blunt');
  c.hurt(0, 60, 'blunt');
  live(w, c, 10);
  assert.equal(c.alive, false, `существо выжило: ${c.physiology.explainDeath()}`);

  const posBefore = c.body.center();
  live(w, c, 600);
  const posAfter = c.body.center();

  assert.equal(c.canAct, false, 'мёртвое существо считает, что может действовать');
  assert.ok(Math.abs(posAfter.x - posBefore.x) < 0.01, 'мёртвое тело уползло');
});

test('поколение растёт, а вскрытие помнит номер жизни', () => {
  const w = ground(7);
  const first = new Creature(24, 25, 1, 0);
  first.hurt(0, 60, 'blunt');
  first.hurt(0, 60, 'blunt');
  first.hurt(0, 60, 'blunt');
  live(w, first, 10);

  const second = new Creature(24, 25, 2, w.tick);

  assert.equal(first.autopsy().generation, 1);
  assert.equal(second.generation, 2);
  assert.ok(second.alive);
  assert.equal(second.autopsy().cause, 'жив');
});

test('инвариант И7: воскрешение недостижимо из мира и тела', () => {
  // Самая важная проверка проекта: существо не может оживить себя само,
  // и в симуляции нет даже функции, которая это умеет.
  const packages = ['packages/world/src', 'packages/core/src', 'packages/body/src'];
  const suspects = /revive|resurrect|воскреш/i;

  for (const pkg of packages) {
    const dir = join(ROOT, pkg);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      // Комментарии не считаем: важно, чтобы не было КОДА, умеющего
      // возвращать к жизни, а не чтобы об этом нельзя было написать.
      const source = readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      assert.ok(!suspects.test(source), `${pkg}/${file} содержит код воскрешения — это нарушает И7`);
    }
  }
});

test('существо не знает о своих прошлых жизнях', () => {
  // В памяти и в заключении не должно быть ничего о смерти и возрождении:
  // знание переходит дальше, а память о смерти — нет.
  const c = new Creature(24, 20, 5, 0);
  const text = JSON.stringify(c.autopsy());
  assert.ok(!/прошл|предыдущ|возрожд|перерожд/i.test(text), 'существо помнит прошлые жизни');
});

test('существо переживает снапшот и перезапуск', () => {
  const w = ground(11);
  const c = new Creature(24, 25, 3, 0);
  w.creature = c;
  c.hurt(2, 25, 'cut');
  live(w, c, 300);

  const restored = World.fromSnapshot(w.toSnapshot());

  assert.ok(restored.creature !== null, 'существо потерялось при загрузке');
  const r = restored.creature;
  assert.equal(r.generation, c.generation);
  assert.equal(r.bornTick, c.bornTick);
  assert.equal(r.alive, c.alive);
  assert.ok(Math.abs(r.physiology.blood - c.physiology.blood) < 1e-6, 'кровь не восстановилась');
  assert.ok(Math.abs(r.physiology.hydration - c.physiology.hydration) < 1e-6, 'вода не восстановилась');
  assert.equal(r.physiology.wounds.length, c.physiology.wounds.length, 'раны потерялись');
  assert.ok(Math.abs(r.body.x[0] - c.body.x[0]) < 1e-6, 'поза не восстановилась');
});

test('после загрузки существо продолжает жить как прежде', () => {
  const w = ground(12);
  const c = new Creature(24, 25, 1, 0);
  w.creature = c;
  live(w, c, 200);

  const snap = w.toSnapshot();
  const a = World.fromSnapshot(snap);
  const b = World.fromSnapshot(snap);

  // Оба мира живут дальше одинаково — значит состояние полное.
  for (let t = 0; t < 200; t++) {
    a.tickOnce();
    b.tickOnce();
  }
  assert.ok(a.creature !== null && b.creature !== null);
  assert.ok(
    Math.abs(a.creature.physiology.blood - b.creature.physiology.blood) < 1e-9,
    'восстановленные миры разошлись',
  );
  assert.ok(
    Math.abs(a.creature.body.x[0] - b.creature.body.x[0]) < 1e-9,
    'позы разошлись',
  );
});
