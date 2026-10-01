/**
 * Ф2, шаг 1: рефлекторный контур.
 *
 * Сеть ещё не обучена, но она обязана быть работоспособной оболочкой:
 * врождённые рефлексы должны работать всегда, а веса — сохраняться
 * и восстанавливаться без потерь.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Creature } from '../packages/body/src/creature.ts';
import { ReflexPolicy, HIDDEN, INPUTS, OUTPUTS } from '../packages/brain-reflex/src/policy.ts';
import { SEG } from '../packages/body/src/body.ts';
import { REGION } from '../packages/body/src/physiology.ts';
import { SENSE } from '../packages/body/src/sensors.ts';
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

test('сеть крошечная и выдаёт углы в допустимых пределах', () => {
  assert.equal(INPUTS, 68);
  assert.equal(OUTPUTS, 16);
  assert.equal(HIDDEN, 24);
  assert.ok(ReflexPolicy.parameterCount() < 2500, 'сеть слишком большая для 60 Гц');

  const w = ground(1);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  for (let t = 0; t < 200; t++) {
    w.tickOnce();
    c.step(w, 1 / 60, 0.2);
    p.act(w, c, t * 0.16);
  }
  for (let i = 1; i < OUTPUTS; i++) {
    assert.ok(Number.isFinite(c.body.targetAngle[i]), `сустав ${i} получил не число`);
    assert.ok(Math.abs(c.body.targetAngle[i]) <= 1.6, `сустав ${i} вывернут`);
  }
});

test('веса сохраняются и восстанавливаются без потерь', () => {
  const p = new ReflexPolicy();
  const before = Array.from(p.weights.w1.slice(0, 12));
  const restored = ReflexPolicy.fromBytes(p.toBytes());
  const after = Array.from(restored.weights.w1.slice(0, 12));
  assert.deepEqual(after, before);
  assert.equal(ReflexPolicy.parameterCount(), p.toBytes().byteLength / 4);
});

test('рефлекс отдёргивания работает без обучения', () => {
  const w = ground(2);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  for (let t = 0; t < 120; t++) {
    w.tickOnce();
    c.step(w, 1 / 60, 0.2);
    p.act(w, c, t * 0.16);
  }
  c.hurt(REGION.L_ARM, 30, 'cut');
  p.act(w, c, 1);
  assert.ok(p.lastReflex.includes('поджимаю'), `рефлекс не сработал: ${p.lastReflex}`);
  // Знак угла зависит ещё и от сети, поэтому проверяем сам факт поджатия:
  // выход руки сдвинулся в сторону поджатия по сравнению с покоем.
  p.outputs[SEG.L_UPPER_ARM] = 0;
  p.networkAuthority = 1;
  (p as unknown as { applyReflexes(c: Creature, phase: number): void }).applyReflexes(c, 0);
  assert.ok(c.body.targetAngle[SEG.L_UPPER_ARM] < 0, 'пострадавшая рука не поджалась');
});

test('рефлекс удушья работает без обучения', () => {
  const w = ground(3);
  const c = new Creature(24, 20, 1, 0);
  for (let x = 10; x < 40; x++) for (let y = 8; y < 30; y++) w.grid.set(x, y, MAT.WATER);
  const p = new ReflexPolicy();
  // Кислород падает не мгновенно: рефлексу нужно около десяти секунд.
  for (let t = 0; t < 600; t++) {
    w.tickOnce();
    c.step(w, 1 / 60, 0.2);
    p.act(w, c, t * 0.16);
  }
  assert.ok(
    p.lastReflex.includes('воздух') || p.lastReflex.includes('опору'),
    `рефлекс не сработал: ${p.lastReflex}`,
  );
});

test('существо с рефлексами живёт дольше, чем без них', () => {
  function lifetime(withPolicy: boolean): number {
    const w = ground(4);
    const c = new Creature(24, 25, 1, 0);
    const p = new ReflexPolicy();
    let ticks = 0;
    for (let t = 0; t < 3000 && c.alive; t++) {
      w.tickOnce();
      c.step(w, 1 / 60, 0.2);
      if (withPolicy) p.act(w, c, t * 0.16);
      ticks = t;
    }
    return ticks;
  }
  const withP = lifetime(true);
  const without = lifetime(false);
  assert.ok(withP >= without, `с рефлексами прожило меньше: ${withP} против ${without}`);
  assert.ok(withP > 100, 'существо с рефлексами умерло почти сразу');
});

test('у сети есть власть над телом: при полной власти походка не мешает', () => {
  const w = ground(10);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  // Ставим stance-рефлексы в покой и отдаём всю власть сети.
  p.networkAuthority = 1;
  for (let t = 0; t < 120; t++) {
    w.tickOnce();
    c.step(w, 1 / 60, 0.2);
    p.act(w, c, t * 0.16);
  }
  // При полной власти выходы сети доходят до суставов почти без поправок
  // врождённой походки: проверяем, что угол следует за сетью.
  const before = c.body.targetAngle[SEG.L_THIGH];
  p.outputs[SEG.L_THIGH] = 0.9;
  p.networkAuthority = 1;
  // Повторяем применение рефлексов ещё раз с тем же выходом.
  (p as unknown as { applyReflexes(c: Creature, phase: number): void }).applyReflexes(c, 0);
  const after = c.body.targetAngle[SEG.L_THIGH];
  assert.ok(Math.abs(after - 0.9) < 0.3, `сеть не задаёт позу: ${after.toFixed(2)} против ${before.toFixed(2)}`);
});

test('при нулевой власти всем правит врождённая походка', () => {
  const w = ground(11);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  p.networkAuthority = 0;
  p.outputs.fill(0);
  (p as unknown as { applyReflexes(c: Creature, phase: number): void }).applyReflexes(c, 1.2);
  assert.ok(Math.abs(c.body.targetAngle[SEG.L_THIGH]) > 0.05, 'походка не сработала');
});

test('существо уходит от лавы', () => {
  const w = ground(12);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  for (let t = 0; t < 120; t++) {
    w.tickOnce();
    c.step(w, 1 / 60, 0.2);
    p.act(w, c, t * 0.16);
  }
  // Кладём лаву справа от тела.
  const px = Math.round(c.body.x[3]);
  const py = Math.round(c.body.y[3]);
  for (let k = 1; k <= 4; k++) w.grid.set(px + k, py, MAT.LAVA);

  const want = p.survival(w, c);
  assert.equal(want.drinking, false);
  assert.equal(want.eating, false);
  assert.equal(want.dir, -1, `существо не уходит от лавы: dir=${want.dir}`);
});

test('огонь тоже считается опасностью', () => {
  const w = ground(13);
  const c = new Creature(24, 25, 1, 0);
  const p = new ReflexPolicy();
  for (let t = 0; t < 120; t++) {
    w.tickOnce();
    c.step(w, 1 / 60, 0.2);
    p.act(w, c, t * 0.16);
  }
  const px = Math.round(c.body.x[3]);
  const py = Math.round(c.body.y[3]);
  for (let k = 1; k <= 3; k++) w.grid.set(px - k, py, MAT.FIRE);

  const want = p.survival(w, c);
  assert.equal(want.dir, 1, `существо идёт в огонь: dir=${want.dir}`);
});
