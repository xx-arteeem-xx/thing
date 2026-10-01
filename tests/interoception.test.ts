/**
 * Ф3, шаг 1: интероцепция.
 *
 * Прежде чем существо научится говорить, оно должно уметь описывать себя
 * фактами. Проверяем, что описание соответствует телу, а не выдумано.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Creature } from '../packages/body/src/creature.ts';
import { describe, sense, think } from '../packages/brain-language/src/interoception.ts';
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

test('здоровое существо описывает себя спокойно', () => {
  const w = ground(1);
  const c = new Creature(24, 25, 1, 0);
  live(w, c, 120);

  const s = sense(w, c);
  assert.equal(s.alive, true);
  assert.equal(s.blood, 'full');
  assert.equal(s.oxygen, 'ok');
  assert.equal(s.energy, 'fed');
  assert.equal(s.danger, null);
  assert.ok(describe(s).includes('blood full'), describe(s));
});

test('голод, жажда и холод видны в описании', () => {
  const w = ground(2);
  const c = new Creature(24, 25, 1, 0);
  c.physiology.glucose = 0.2;
  c.physiology.hydration = 0.05;
  c.physiology.coreTemp = 32;
  live(w, c, 5);

  const s = sense(w, c);
  assert.equal(s.energy, 'starving');
  assert.equal(s.water, 'parched');
  assert.equal(s.warmth, 'freezing');

  const text = describe(s);
  assert.ok(text.includes('starving'), text);
  assert.ok(text.includes('parched'), text);
  assert.ok(text.includes('freezing'), text);
});

test('рана называется по месту, а не «где-то болит»', () => {
  const w = ground(3);
  const c = new Creature(24, 25, 1, 0);
  live(w, c, 60);
  c.hurt(REGION.L_LEG, 30, 'cut');

  const s = sense(w, c);
  assert.equal(s.pain, 'left leg');
  assert.ok(s.wounds >= 1);
  assert.ok(describe(s).includes('left leg'), describe(s));
});

test('лава поблизости распознаётся как опасность', () => {
  const w = ground(4);
  const c = new Creature(24, 25, 1, 0);
  live(w, c, 60);
  const px = Math.round(c.body.x[3]);
  const py = Math.round(c.body.y[3]);
  for (let k = 1; k <= 3; k++) w.grid.set(px + k, py, MAT.LAVA);

  const s = sense(w, c);
  assert.equal(s.danger, 'lava');
  assert.ok(think(s).includes('get away'), think(s));
});

test('мысль ведёт себя по старшинству нужд', () => {
  const w = ground(5);
  const c = new Creature(24, 25, 1, 0);
  live(w, c, 60);

  // Сытый и целый — думает про осмотр.
  assert.ok(think(sense(w, c)).includes('look around'), think(sense(w, c)));

  // Голодный — про еду.
  c.physiology.glucose = 0.1;
  c.physiology.glycogen = 400;
  assert.ok(think(sense(w, c)).includes('food'), think(sense(w, c)));

  // Удушье важнее голода.
  c.physiology.oxygen = 20;
  assert.ok(think(sense(w, c)).includes('air'), think(sense(w, c)));
});

test('мертвец не думает о делах', () => {
  const w = ground(6);
  const c = new Creature(24, 25, 1, 0);
  live(w, c, 60);
  c.physiology.blood = 1.0;
  c.physiology.step(1, {
    ambient: 20, submerged: false, activity: 0, eating: false, drinking: false, insulation: 0,
  });
  assert.equal(c.alive, false);
  assert.equal(think(sense(w, c)), 'I am dead.');
});

test('описание всегда даёт непустой связный текст', () => {
  const w = ground(7);
  const c = new Creature(24, 25, 1, 0);
  for (let t = 0; t < 600; t++) {
    w.tickOnce();
    c.step(w, 1 / 60, t % 100 === 0 ? 0.9 : 0.2);
    const text = describe(sense(w, c));
    assert.ok(text.length > 20, `описание слишком короткое: ${text}`);
    assert.ok(text.endsWith('.'), `описание без точки: ${text}`);
    assert.ok(!text.includes('undefined'), `в описании дыра: ${text}`);
    assert.ok(!text.includes('NaN'), `в описании NaN: ${text}`);
  }
});
