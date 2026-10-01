/**
 * Реестр маршрутов сервера.
 *
 * Отдельный файл нужен ради инварианта И7 из docs/PLAN.md: право вмешаться
 * в жизнь существа должно быть проверяемым, а не «мы договорились».
 * Тест обходит этот реестр и падает, если появился мутирующий маршрут
 * вне разрешённого списка (см. tests/contract.test.ts).
 */

export type HttpMethod = 'GET' | 'POST';

export interface RouteDef {
  method: HttpMethod;
  path: string;
  /** Меняет состояние мира или ход симуляции. */
  mutating: boolean;
  /** Инструмент отладки: выключается в боевом режиме (debug.tools = false). */
  debugOnly?: boolean;
  description: string;
}

export const ROUTES: readonly RouteDef[] = [
  { method: 'GET', path: '/health', mutating: false, description: 'жив ли процесс и идёт ли время' },
  { method: 'GET', path: '/api/meta', mutating: false, description: 'состояние симуляции и её темп' },
  { method: 'GET', path: '/api/frame', mutating: false, description: 'кадр мира: кейфрейм или патч изменившихся чанков' },
  { method: 'GET', path: '/api/materials', mutating: false, description: 'справочник веществ' },
  { method: 'GET', path: '/api/species', mutating: false, description: 'справочник видов живности' },
  { method: 'GET', path: '/api/journal', mutating: false, description: 'летопись первых событий мира' },
  { method: 'GET', path: '/api/stats', mutating: false, description: 'сколько чего в мире, горячие клетки' },
  { method: 'GET', path: '/api/snapshot.vvs', mutating: false, description: 'скачать текущий снапшот' },

  // Операционные: нужны для переезда, отладки и остановки жизни без потерь.
  { method: 'GET', path: '/api/creature', mutating: false, description: 'состояние существа и вскрытие' },
  { method: 'GET', path: '/api/thoughts', mutating: false, description: 'дневник мыслей существа' },
  { method: 'POST', path: '/api/world/reset', mutating: true, description: 'вернуть мир к исходному состоянию (сила наблюдателя)' },
  { method: 'POST', path: '/api/fauna/spawn', mutating: true, description: 'создать живых организмов (сила наблюдателя)' },
  { method: 'POST', path: '/api/weather', mutating: true, description: 'сменить погоду (сила наблюдателя)' },
  { method: 'POST', path: '/api/revive', mutating: true, description: 'вернуть существо к жизни (единственная сила наблюдателя)' },
  { method: 'POST', path: '/api/pause', mutating: true, description: 'остановить время' },
  { method: 'POST', path: '/api/resume', mutating: true, description: 'запустить время' },
  { method: 'POST', path: '/api/snapshot', mutating: true, description: 'сохранить снапшот на диск' },
  { method: 'POST', path: '/api/load', mutating: true, description: 'загрузить снапшот с диска' },

  // Только при debug.tools = true. В боевой сборке этих маршрутов нет вовсе.
  { method: 'POST', path: '/api/paint', mutating: true, debugOnly: true, description: 'кисть наблюдателя (отладка)' },
  { method: 'POST', path: '/api/heat', mutating: true, debugOnly: true, description: 'нагрев области (отладка)' },
  { method: 'POST', path: '/api/step', mutating: true, debugOnly: true, description: 'один тик на паузе (отладка)' },
  { method: 'POST', path: '/api/muscle', mutating: true, debugOnly: true, description: 'задать углы суставов (отладка)' },
  { method: 'POST', path: '/api/walk', mutating: true, debugOnly: true, description: 'заставить идти (отладка)' },
];

/**
 * Полный список того, что вообще имеет право менять мир в боевом режиме.
 * POST /api/revive появится в Ф1: воскрешение — единственная игровая сила
 * наблюдателя, и она обязана быть здесь явно.
 */
/**
 * Что вообще разрешено менять в мире.
 *
 * Первые пять — операции с временем и состоянием, последние три — силы
 * наблюдателя: вернуть мир к исходному, создать живых, сменить погоду.
 * Плюс воскрешение. Редактирования карты здесь нет и не будет.
 */
export const ALLOWED_MUTATING: readonly string[] = [
  'POST /api/revive',
  'POST /api/pause',
  'POST /api/resume',
  'POST /api/snapshot',
  'POST /api/load',
  'POST /api/world/reset',
  'POST /api/fauna/spawn',
  'POST /api/weather',
];

/**
 * Инструменты отладки: они мутируют мир, но существуют только при
 * debug.tools = true и в боевой сборке недостижимы.
 */
export const DEBUG_MUTATING: readonly string[] = [
  'POST /api/paint',
  'POST /api/heat',
  'POST /api/step',
  'POST /api/muscle',
  'POST /api/walk',
];

export function routeKey(r: { method: HttpMethod; path: string }): string {
  return `${r.method} ${r.path}`;
}

/** Маршруты, активные при данном режиме. */
export function activeRoutes(debug: boolean): RouteDef[] {
  return ROUTES.filter((r) => debug || r.debugOnly !== true);
}

/** Мутирующие маршруты при данном режиме — то, что проверяет тест контракта. */
export function mutatingRoutes(debug: boolean): string[] {
  return activeRoutes(debug)
    .filter((r) => r.mutating)
    .map(routeKey);
}

/** Мутирующие маршруты, которых нет в разрешённом списке. Должно быть пусто. */
export function contractViolations(debug: boolean): string[] {
  const allowed = new Set<string>(ALLOWED_MUTATING);
  if (debug) for (const key of DEBUG_MUTATING) allowed.add(key);
  return mutatingRoutes(debug).filter((k) => !allowed.has(k));
}

/** Разрешённые мутирующие маршруты, которых пока нет в реестре (например, revive до Ф1). */
export function notYetImplemented(debug: boolean): string[] {
  const present = new Set<string>(mutatingRoutes(debug));
  return ALLOWED_MUTATING.filter((k) => !present.has(k));
}
