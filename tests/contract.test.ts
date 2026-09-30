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

test('боевой набор мутирующих маршрутов — ровно операционные', () => {
  assert.deepEqual(
    [...mutatingRoutes(false)].sort(),
    ['POST /api/load', 'POST /api/pause', 'POST /api/resume', 'POST /api/snapshot'],
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

test('воскрешение объявлено как единственная игровая сила (реализация — Ф1)', () => {
  assert.ok(ALLOWED_MUTATING.includes('POST /api/revive'));
  assert.deepEqual(notYetImplemented(false), ['POST /api/revive']);
});

test('мир ничего не знает о воскрешении: пути из симуляции к нему нет', () => {
  const packages = ['packages/world/src', 'packages/core/src'];
  const suspects = /revive|resurrect|воскреш/i;

  for (const pkg of packages) {
    const dir = join(ROOT, pkg);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      const source = readFileSync(join(dir, file), 'utf8');
      assert.ok(!suspects.test(source), `${pkg}/${file} упоминает воскрешение — это нарушает И7`);
    }
  }
});
