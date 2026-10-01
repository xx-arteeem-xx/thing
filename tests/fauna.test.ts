/**
 * Фауна: проверяем поведение организмов, а не картинку.
 *
 * Здесь фиксируются три обещания заказчика: безобидные виды сами не нападают,
 * агрессивные нападают не всегда, и жизнь бывает наземная и водная.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAT } from '../packages/world/src/materials.ts';
import { ACT, SPECIES, SPECIES_BY_ID } from '../packages/world/src/fauna.ts';
import { World } from '../packages/world/src/world.ts';
import { count, emptyWorld, fillRect, run } from './helpers.ts';

/** Ровный луг: земля, трава сверху, твёрдая подложка. */
function meadow(seed = 1, width = 48, height = 32): World {
  const w = emptyWorld(width, height, seed, { weather: false });
  for (let x = 0; x < width; x++) {
    w.grid.set(x, height - 1, MAT.STONE);
    w.grid.set(x, height - 2, MAT.DIRT);
    w.grid.set(x, height - 3, MAT.GRASS);
  }
  return w;
}

/** Бассейн с водой. */
function pond(seed = 2, width = 48, height = 32): World {
  const w = emptyWorld(width, height, seed, { weather: false });
  for (let x = 0; x < width; x++) w.grid.set(x, height - 1, MAT.STONE);
  fillRect(w, 4, height - 10, 40, height - 2, MAT.WATER);
  // стенки, чтобы вода не растеклась
  for (let y = height - 10; y < height - 1; y++) {
    w.grid.set(3, y, MAT.STONE);
    w.grid.set(41, y, MAT.STONE);
  }
  return w;
}

test('травоядное ест траву, когда голодно', () => {
  const w = meadow(3);
  const i = w.fauna.spawn(SPECIES.RABBIT, 24, 28, 80);
  assert.ok(i >= 0);
  const before = count(w, MAT.GRASS);

  // Трава отрастает, поэтому смотрим не на итог, а на то, что её
  // действительно сгрызали по ходу.
  let minGrass = before;
  for (let t = 0; t < 600; t++) {
    w.tickOnce();
    const now = count(w, MAT.GRASS);
    if (now < minGrass) minGrass = now;
  }

  assert.ok(minGrass < before, 'кролик не съел ни травинки');
  assert.ok(w.fauna.energy[i] > 80, 'энергия не выросла после еды');
});

test('сытое травоядное не выедает луг', () => {
  const w = meadow(4);
  w.fauna.spawn(SPECIES.RABBIT, 24, 28, 255);
  const before = count(w, MAT.GRASS);

  run(w, 300);

  assert.ok(
    count(w, MAT.GRASS) >= before - 1,
    'сытый кролик выел траву — значит, ест без остановки',
  );
});

test('безобидный вид не нападает первым', () => {
  const w = meadow(5);
  const rabbit = w.fauna.spawn(SPECIES.RABBIT, 20, 28, 150);
  const deer = w.fauna.spawn(SPECIES.DEER, 22, 28, 150);

  let rabbitWasHunting = false;
  for (let t = 0; t < 2000; t++) {
    w.tickOnce();
    if (w.fauna.act[rabbit] === ACT.HUNT) rabbitWasHunting = true;
  }

  assert.equal(rabbitWasHunting, false, 'кролик начал охотиться, хотя вид безобидный');
  assert.ok(w.fauna.hp[deer] === SPECIES_BY_ID[SPECIES.DEER].hp, 'олень получил урон без причины');
});

test('раненый безобидный зверь даёт сдачи', () => {
  const w = meadow(6);
  const rabbit = w.fauna.spawn(SPECIES.RABBIT, 24, 28, 150);
  const wolf = w.fauna.spawn(SPECIES.WOLF, 25, 28, 150);

  let retaliated = false;
  for (let t = 0; t < 3000; t++) {
    w.tickOnce();
    if (w.fauna.hp[rabbit] < SPECIES_BY_ID[SPECIES.RABBIT].hp) {
      // Получил урон — обязан либо драться, либо убегать, но не игнорировать.
      retaliated = w.fauna.act[rabbit] === ACT.FIGHT || w.fauna.act[rabbit] === ACT.FLEE;
      if (retaliated) break;
    }
  }

  assert.ok(retaliated, 'кролик не отреагировал на нападение волка');
  assert.ok(w.fauna.hp[wolf] > 0);
});

test('хищник нападает не всегда: агрессия вероятностная', () => {
  const decisions = 400;
  let hunts = 0;

  for (let seed = 1; seed <= decisions; seed++) {
    const w = meadow(seed, 32, 24);
    const wolf = w.fauna.spawn(SPECIES.WOLF, 12, 20, 200);
    const rabbit = w.fauna.spawn(SPECIES.RABBIT, 14, 20, 200);

    // Один «решающий» тик восприятия.
    while (w.tick % 12 !== 0) w.tickOnce();
    w.tickOnce();

    if (w.fauna.act[wolf] === ACT.HUNT) hunts++;
    void rabbit;
  }

  assert.ok(hunts > 0, 'волк не охотился ни разу — агрессия не работает');
  assert.ok(hunts < decisions, 'волк охотился всегда — вероятности нет');
});

test('рыба живёт в воде и гибнет на суше', () => {
  const w = pond(7);
  const fish = w.fauna.spawn(SPECIES.FISH, 20, 26, 200);
  assert.ok(fish >= 0);

  run(w, 600);

  assert.ok(w.fauna.countOf(SPECIES.FISH) > 0, 'рыба погибла в воде');
});

test('рыба, выброшенная на берег, задыхается', () => {
  const w = emptyWorld(32, 24, 8, { weather: false });
  for (let x = 0; x < 32; x++) w.grid.set(x, 23, MAT.STONE);
  const fish = w.fauna.spawn(SPECIES.FISH, 16, 22, 200);
  assert.ok(fish >= 0);

  run(w, 900);

  assert.equal(w.fauna.countOf(SPECIES.FISH), 0, 'рыба выжила на суше');
});

test('наземный зверь не тонет в глубокой воде', () => {
  const w = pond(9, 48, 40);
  const rabbit = w.fauna.spawn(SPECIES.RABBIT, 20, 20, 200);
  assert.ok(rabbit >= 0);

  run(w, 400);

  // Либо выбрался, либо погиб, но не должен бесконечно барахтаться на дне.
  const alive = w.fauna.countOf(SPECIES.RABBIT);
  const y = w.fauna.y[0];
  assert.ok(alive === 0 || y < 39, 'кролик остался на дне водоёма');
});

test('организмы размножаются на сытом лугу', () => {
  const w = meadow(10, 64, 32);
  for (let k = 0; k < 6; k++) w.fauna.spawn(SPECIES.RABBIT, 10 + k * 8, 28, 200);

  run(w, 6000);

  assert.ok(w.fauna.born > 0, 'за 6000 тиков не родился ни один крольчонок');
});

test('популяция не растёт бесконечно', () => {
  const w = meadow(11, 96, 32);
  for (let k = 0; k < 10; k++) w.fauna.spawn(SPECIES.RABBIT, 6 + k * 9, 28, 200);

  run(w, 40000);

  assert.ok(
    w.fauna.countOf(SPECIES.RABBIT) <= SPECIES_BY_ID[SPECIES.RABBIT].maxCount,
    'популяция превысила предел вида',
  );
  assert.ok(w.fauna.count < 512, 'организмы переполнили мир');
});

test('фауна попадает в снапшот и переживает перезагрузку', () => {
  const w = meadow(12);
  w.fauna.spawn(SPECIES.RABBIT, 20, 28, 150);
  w.fauna.spawn(SPECIES.WOLF, 24, 28, 150);
  run(w, 200);

  const restored = World.fromSnapshot(w.toSnapshot());

  assert.equal(restored.fauna.count, w.fauna.count);
  for (let i = 0; i < w.fauna.count; i++) {
    assert.equal(restored.fauna.species[i], w.fauna.species[i]);
    assert.ok(Math.abs(restored.fauna.x[i] - w.fauna.x[i]) < 0.01);
  }
});

test('фауна детерминирована', () => {
  const a = meadow(13, 64, 32);
  const b = meadow(13, 64, 32);
  for (let k = 0; k < 8; k++) {
    a.fauna.spawn(SPECIES.RABBIT, 8 + k * 7, 28, 170);
    b.fauna.spawn(SPECIES.RABBIT, 8 + k * 7, 28, 170);
  }

  run(a, 3000);
  run(b, 3000);

  assert.equal(a.fauna.count, b.fauna.count);
  for (let i = 0; i < a.fauna.count; i++) {
    assert.equal(a.fauna.species[i], b.fauna.species[i]);
    assert.ok(Math.abs(a.fauna.x[i] - b.fauna.x[i]) < 1e-4, `расхождение в позиции ${i}`);
    assert.equal(a.fauna.hp[i], b.fauna.hp[i]);
  }
});
