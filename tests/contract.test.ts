/**
 * Контракт наблюдателя (инвариант И7).
 *
 * Самое важное обещание проекта: существо не может воскреснуть само, а ты
 * не можешь вмешаться ни во что, кроме воскрешения. Обещание должно быть
 * проверяемым, иначе оно ничего не стоит.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_MUTATING,
  activeRoutes,
  contractViolations,
  mutatingRoutes,
  notYetImplemented,
  routeKey,
} from '../packages/server/src/routes.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('в боевом режиме нет мутирующих маршрутов вне разрешённого списка', () => {
  assert.deepEqual(contractViolations(false), []);
});

test('в отладочном режиме тоже нет нарушений', () => {
  assert.deepEqual(contractViolations(true), []);
});

test('мутирующие маршруты — операции и силы наблюдателя', () => {
  assert.deepEqual(
    [...mutatingRoutes(false)].sort(),
    [
      'POST /api/fauna/spawn',
      'POST /api/load',
      'POST /api/pause',
      'POST /api/resume',
      'POST /api/revive',
      'POST /api/snapshot',
      'POST /api/weather',
      'POST /api/world/reset',
    ],
  );
});

test('отладочные инструменты полностью отсутствуют в боевом режиме', () => {
  const keys = activeRoutes(false).map(routeKey);
  for (const debugRoute of ['POST /api/paint', 'POST /api/heat', 'POST /api/step']) {
    assert.ok(!keys.includes(debugRoute), `${debugRoute} доступен при debug.tools = false`);
  }
  const debugKeys = activeRoutes(true).map(routeKey);
  for (const debugRoute of ['POST /api/paint', 'POST /api/heat', 'POST /api/step']) {
    assert.ok(debugKeys.includes(debugRoute), `${debugRoute} пропал при debug.tools = true`);
  }
});

test('воскрешение — единственная игровая сила, и оно уже реализовано', () => {
  assert.ok(ALLOWED_MUTATING.includes('POST /api/revive'));
  assert.deepEqual(notYetImplemented(false), [], 'разрешённый маршрут объявлен, но не реализован');
  assert.ok(mutatingRoutes(false).includes('POST /api/revive'));
});

test('воскрешение живёт в сервере, а не в мире', () => {
  // Функция возврата к жизни обязана быть снаружи симуляции. Если она
  // появится в мире или в теле, существо сможет оживить себя само.
  const source = readFileSync(join(ROOT, 'packages/server/src/index.ts'), 'utf8');
  assert.ok(/revive/.test(source), 'воскрешение исчезло из сервера');
});

test('мир ничего не знает о воскрешении: пути из симуляции к нему нет', () => {
  const packages = ['packages/world/src', 'packages/core/src'];
  const suspects = /revive|resurrect|воскреш/i;

  for (const pkg of packages) {
    const dir = join(ROOT, pkg);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      // Комментарии не считаем: важно отсутствие КОДА, умеющего возвращать
      // к жизни, а не словесное упоминание.
      const source = readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      assert.ok(!suspects.test(source), `${pkg}/${file} содержит код воскрешения — это нарушает И7`);
    }
  }
});
