/**
 * Ф1, шаг 1: тело как физический объект.
 *
 * Проверяем то, без чего нельзя двигаться дальше: скелет не разваливается,
 * связи держат длину, тело падает и ложится на грунт, не проваливается
 * сквозь породу и не улетает за пределы мира.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Body, SEG, SEGMENTS, SEGMENT_COUNT } from '../packages/body/src/body.ts';
import { MAT } from '../packages/world/src/materials.ts';
import { emptyWorld, run } from './helpers.ts';

/** Ровная площадка: камень, земля, трава сверху. */
function ground(seed = 1) {
  const w = emptyWorld(48, 32, seed, { weather: false });
  for (let x = 0; x < 48; x++) {
    w.grid.set(x, 31, MAT.STONE);
    w.grid.set(x, 30, MAT.DIRT);
    w.grid.set(x, 29, MAT.GRASS);
  }
  return w;
}

function jointError(body: Body): number {
  let worst = 0;
  for (const s of SEGMENTS) {
    if (s.parent < 0) continue;
    const d = Math.hypot(body.x[s.id] - body.x[s.parent], body.y[s.id] - body.y[s.parent]);
    worst = Math.max(worst, Math.abs(d - s.length));
  }
  return worst;
}

test('скелет состоит из 16 сегментов и таблица не перепутана', () => {
  assert.equal(SEGMENT_COUNT, 16);
  assert.equal(SEGMENTS.length, 16);
  for (let i = 0; i < SEGMENTS.length; i++) {
    assert.equal(SEGMENTS[i].id, i, `сегмент ${i} лежит не на своём месте`);
  }
});

test('в позе стоя все связи уже натянуты как надо', () => {
  const body = new Body(24, 20);
  assert.ok(jointError(body) < 1e-3, 'тело рождается с порванными связями');
});

test('тело падает и ложится на землю', () => {
  const w = ground(2);
  const body = new Body(24, 20);
  const startY = body.center().y;

  for (let t = 0; t < 400; t++) {
    w.tickOnce();
    body.step(w, 1 / 60);
  }

  assert.ok(body.center().y > startY, 'тело не упало');
  assert.ok(body.onGround(w), 'тело не встало на опору');
  assert.ok(jointError(body) < 0.25, `связи растянулись на ${jointError(body).toFixed(2)}`);
});

test('тело не проваливается сквозь породу', () => {
  const w = ground(3);
  const body = new Body(24, 10);

  for (let t = 0; t < 600; t++) {
    w.tickOnce();
    body.step(w, 1 / 60);
  }

  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const cx = Math.round(body.x[i]);
    const cy = Math.round(body.y[i]);
    assert.ok(cy < 30, `${SEGMENTS[i].name} оказался внутри грунта: y=${cy}`);
    assert.ok(cx >= 0 && cx < 48, `${SEGMENTS[i].name} вышел за мир`);
  }
});

test('тело остаётся на месте, а не уползает само по себе', () => {
  const w = ground(4);
  const body = new Body(24, 25);
  for (let t = 0; t < 300; t++) {
    w.tickOnce();
    body.step(w, 1 / 60);
  }
  const settled = body.center().x;

  for (let t = 0; t < 600; t++) {
    w.tickOnce();
    body.step(w, 1 / 60);
  }
  const after = body.center().x;

  assert.ok(
    Math.abs(after - settled) < 3,
    `тело уехало на ${Math.abs(after - settled).toFixed(2)} клетки без причины`,
  );
});

test('тело переживает снапшот без изменений', () => {
  const w = ground(5);
  const body = new Body(24, 20);
  for (let t = 0; t < 120; t++) {
    w.tickOnce();
    body.step(w, 1 / 60);
  }
  const saved = body.state();
  const copy = new Body(1, 1);
  copy.restore(saved);

  for (let i = 0; i < SEGMENT_COUNT; i++) {
    assert.equal(copy.x[i], body.x[i]);
    assert.equal(copy.y[i], body.y[i]);
  }
  assert.ok(jointError(copy) < 0.3);
});

test('голова выше таза, пока тело стоит', () => {
  const w = ground(6);
  const body = new Body(24, 25);
  for (let t = 0; t < 60; t++) {
    w.tickOnce();
    body.step(w, 1 / 60);
  }
  assert.ok(body.y[SEG.HEAD] < body.y[SEG.PELVIS], 'скелет собрался вверх ногами');
});

test('в мире без опоры тело просто падает вниз, а не зависает', () => {
  const w = emptyWorld(32, 64, 7, { weather: false });
  const body = new Body(16, 8);
  const before = body.center().y;
  run(w, 5);
  for (let t = 0; t < 200; t++) body.step(w, 1 / 60);
  assert.ok(body.center().y > before + 5, 'тело зависло в воздухе');
});

test('мышцы поворачивают сустав', () => {
  const w = ground(8);
  const body = new Body(24, 25);
  for (let t = 0; t < 120; t++) {
    w.tickOnce();
    body.step(w, 1 / 60);
  }
  const before = { x: body.x[SEG.L_HAND], y: body.y[SEG.L_HAND] };

  body.setJoint(SEG.L_UPPER_ARM, -1.2);
  for (let t = 0; t < 120; t++) {
    w.tickOnce();
    body.step(w, 1 / 60);
  }
  const after = { x: body.x[SEG.L_HAND], y: body.y[SEG.L_HAND] };

  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  assert.ok(moved > 0.5, `рука не послушалась: сдвиг ${moved.toFixed(2)}`);
  assert.ok(jointError(body) < 0.4, 'связи порвались при движении');
});

test('расслабленные мышцы возвращают позу', () => {
  const w = ground(9);
  const body = new Body(24, 25);
  body.setJoint(SEG.L_THIGH, 1.0);
  for (let t = 0; t < 60; t++) {
    w.tickOnce();
    body.step(w, 1 / 60);
  }
  body.relax();
  for (let t = 0; t < 60; t++) {
    w.tickOnce();
    body.step(w, 1 / 60);
  }
  for (let i = 1; i < SEGMENT_COUNT; i++) assert.equal(body.targetAngle[i], 0);
});

test('гребок умеет грести в выбранную сторону', () => {
  // Руль в воде — то, без чего существо, попав в воду, остаётся там
  // навсегда: гребок машет руками на месте.
  const w = emptyWorld(64, 48, 21, { weather: false });
  for (let x = 0; x < 64; x++) {
    w.grid.set(x, 47, MAT.STONE);
    for (let y = 30; y < 47; y++) w.grid.set(x, y, MAT.WATER);
  }
  const body = new Body(32, 36);
  w.tickOnce();
  const x0 = body.x[SEG.PELVIS];
  body.thrust = 0.7;
  for (let t = 0; t < 900; t++) body.step(w, 1 / 60);
  const right = body.x[SEG.PELVIS] - x0;

  const back = new Body(32, 36);
  w.tickOnce();
  const x1 = back.x[SEG.PELVIS];
  back.thrust = -0.7;
  for (let t = 0; t < 900; t++) back.step(w, 1 / 60);
  const left = back.x[SEG.PELVIS] - x1;

  assert.ok(right > 0.5, `вправо не гребёт: ${right.toFixed(2)}`);
  assert.ok(left < -0.5, `влево не гребёт: ${left.toFixed(2)}`);
});

test('в воде тело держится на плаву и не тонет головой', () => {
  const w = emptyWorld(64, 48, 22, { weather: false });
  for (let x = 0; x < 64; x++) {
    w.grid.set(x, 47, MAT.STONE);
    for (let y = 30; y < 47; y++) w.grid.set(x, y, MAT.WATER);
  }
  const body = new Body(32, 32);
  w.tickOnce();
  for (let t = 0; t < 1800; t++) body.step(w, 1 / 60);

  const headY = body.y[SEG.HEAD];
  const pelvisY = body.y[SEG.PELVIS];
  assert.ok(headY < pelvisY, 'тело перевернулось головой вниз');
  assert.ok(headY < 46, `голова утонула: y=${headY.toFixed(1)}`);
});
