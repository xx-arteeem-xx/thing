/**
 * Инвариант И5: при одном seed симуляция обязана идти одинаково.
 * Без этого нельзя ни воспроизвести поведение существа, ни учить политику.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../packages/core/src/rng.ts';
import { makeWorld, run } from './helpers.ts';

test('один seed — одна история', () => {
  const a = makeWorld(777);
  const b = makeWorld(777);
  run(a, 400);
  run(b, 400);
  assert.equal(a.stateHash(), b.stateHash());
  assert.equal(a.tick, b.tick);
});

test('разные seed — разные истории', () => {
  const a = makeWorld(1);
  const b = makeWorld(2);
  run(a, 400);
  run(b, 400);
  assert.notEqual(a.stateHash(), b.stateHash());
});

test('история воспроизводится по шагам, а не только в конце', () => {
  const a = makeWorld(4242);
  const b = makeWorld(4242);
  for (let i = 0; i < 60; i++) {
    a.tickOnce();
    b.tickOnce();
    assert.equal(a.stateHash(), b.stateHash(), `расхождение на тике ${i + 1}`);
  }
});

test('RNG продолжает последовательность из сохранённого состояния', () => {
  const a = new Rng(42);
  for (let i = 0; i < 10; i++) a.nextU32();
  const saved = a.state();
  const expected = [a.nextU32(), a.nextU32(), a.nextU32(), a.nextU32()];

  const b = new Rng(999999);
  b.restore(saved);
  assert.deepEqual([b.nextU32(), b.nextU32(), b.nextU32(), b.nextU32()], expected);
});

test('RNG не вырождается', () => {
  const r = new Rng(0);
  const seen = new Set<number>();
  for (let i = 0; i < 2000; i++) seen.add(r.nextU32());
  assert.ok(seen.size > 1900, `уникальных значений всего ${seen.size}`);
});
