/**
 * Снапшоты: главное требование — «сон, а не смерть».
 * После загрузки симуляция обязана продолжиться ровно так же, как если бы
 * её не прерывали (см. §12 PLAN.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSnapshot, writeSnapshot } from '../packages/core/src/snapshot.ts';
import { World } from '../packages/world/src/world.ts';
import { makeWorld, run } from './helpers.ts';

test('снапшот восстанавливает состояние бит в бит', () => {
  const w = makeWorld(31337);
  run(w, 250);

  const buf = w.toSnapshot();
  const restored = World.fromSnapshot(buf);

  assert.equal(restored.tick, w.tick);
  assert.equal(restored.cfg.width, w.cfg.width);
  assert.equal(restored.cfg.height, w.cfg.height);
  assert.equal(restored.stateHash(), w.stateHash());
});

test('продолжение после снапшота совпадает с непрерывным прогоном', () => {
  const continuous = makeWorld(2024);
  run(continuous, 200);
  const buf = continuous.toSnapshot();

  const restored = World.fromSnapshot(buf);

  run(continuous, 200);
  run(restored, 200);

  assert.equal(restored.tick, continuous.tick);
  assert.equal(
    restored.stateHash(),
    continuous.stateHash(),
    'восстановленный мир пошёл другим путём — значит, в снапшоте не хватает состояния',
  );
});

test('снапшот сжимается заметно сильнее сырых массивов', () => {
  const w = makeWorld(5);
  run(w, 100);
  const buf = w.toSnapshot();
  const rawCells = w.grid.w * w.grid.h;
  const rawBytes = rawCells * (1 + 1 + 2 + 2); // mat + flags + temp + aux

  assert.ok(
    buf.length < rawBytes / 4,
    `снапшот ${buf.length} Б против сырых ${rawBytes} Б — сжатие почти не работает`,
  );
});

test('чужой файл отвергается, а не молча ломает мир', () => {
  assert.throws(() => readSnapshot(Buffer.from('это точно не снапшот, а текст')), /снапшот/);
});

test('снапшот переживает запись и чтение через диск', () => {
  const w = makeWorld(99);
  run(w, 120);
  const buf = w.toSnapshot();
  const again = readSnapshot(buf);
  const restored = World.fromSnapshot(buf);

  assert.equal(again.tick, w.tick);
  assert.equal(restored.stateHash(), w.stateHash());
  assert.ok(buf.length > 0);
});

test('writeSnapshot не портит переданные секции', () => {
  const data = new Uint8Array([1, 2, 3, 4, 5]);
  const buf = writeSnapshot({
    tick: 7,
    seed: 1,
    width: 2,
    height: 2,
    meta: { hello: 'мир' },
    sections: [{ id: 42, data }],
  });
  const back = readSnapshot(buf);
  assert.equal(back.tick, 7);
  assert.equal(back.meta.hello, 'мир');
  assert.deepEqual(Array.from(back.sections[0].data), [1, 2, 3, 4, 5]);
});
