/**
 * Интероцепция: состояние тела и мира, превращённое в слова.
 *
 * Это вход языкового контура из Ф3 и одновременно заготовка датасета:
 * чтобы существо научилось говорить о себе, ему нужно сначала научиться
 * описывать себя фактами. Сначала факты, потом связная речь.
 *
 * Существо думает по-английски — так решено в §0 плана: русский язык для
 * маленькой локальной модели дороже, а мысль важнее языка, на котором
 * она сказана.
 *
 * Здесь нет модели: только факты, собранные из датчиков и физиологии.
 * Модель появится позже и будет учиться на этих строках.
 */
import { MAT } from '../../world/src/materials.ts';
import type { World } from '../../world/src/world.ts';
import type { Creature } from '../../body/src/creature.ts';
import { SEG } from '../../body/src/body.ts';

/** Что существо чувствует прямо сейчас: факты, из которых собирается текст. */
export interface Senses {
  /** Где стоит: трава, камень, песок, вода, грязь, воздух. */
  footing: string;
  /** Состояние тела. */
  blood: 'low' | 'ok' | 'full';
  oxygen: 'choking' | 'thin' | 'ok';
  energy: 'starving' | 'hungry' | 'fed';
  water: 'parched' | 'thirsty' | 'watered';
  warmth: 'freezing' | 'cold' | 'comfortable' | 'hot' | 'burning';
  /** Боль: что болит сильнее всего. */
  pain: string | null;
  /** Опасность рядом. */
  danger: 'fire' | 'lava' | 'drowning' | null;
  /** Время суток. */
  light: 'night' | 'dawn' | 'day' | 'dusk';
  /** Что видно впереди. */
  ahead: string;
  /** Сколько ран и насколько тяжёлых. */
  wounds: number;
  /** Жив ли он вообще. */
  alive: boolean;
}

/** Собрать факты о себе. */
export function sense(w: World, c: Creature): Senses {
  const g = w.grid;
  const p = c.physiology;
  const px = Math.round(c.body.x[SEG.PELVIS]);
  const py = Math.round(c.body.y[SEG.PELVIS]);
  const safe = px >= 0 && py >= 0 && px < g.w && py < g.h;

  // Стоит оно на том, что ПОД ним, а не в клетке таза: таз всегда в
  // воздухе, и получалось «standing on air».
  let groundMat = safe ? g.mat[py * g.w + px] : MAT.AIR;
  if (safe) {
    const below = Math.min(g.h - 1, py + 8);
    for (let y = py; y <= below; y++) {
      const m = g.mat[y * g.w + px];
      if (m !== MAT.AIR) {
        groundMat = m;
        break;
      }
    }
  }

  return {
    footing: safe ? footingName(groundMat) : 'unknown',
    blood: p.blood < 2.5 ? 'low' : p.blood < 4 ? 'ok' : 'full',
    oxygen: p.oxygen < 40 ? 'choking' : p.oxygen < 85 ? 'thin' : 'ok',
    energy: p.hunger > 0.85 ? 'starving' : p.hunger > 0.35 ? 'hungry' : 'fed',
    water: p.thirst > 0.8 ? 'parched' : p.thirst > 0.12 ? 'thirsty' : 'watered',
    warmth:
      p.coreTemp < 33 ? 'freezing'
      : p.coreTemp < 36 ? 'cold'
      : p.coreTemp > 41 ? 'burning'
      : p.coreTemp > 38.5 ? 'hot'
      : 'comfortable',
    pain: worstPain(p.pain),
    danger: dangerNear(w, c),
    light: lightName(w.skyLight),
    ahead: aheadName(w, c),
    wounds: p.wounds.length,
    alive: c.alive,
  };
}

/** Человеческое описание фактов — одна строка. */
export function describe(s: Senses): string {
  const parts: string[] = [];
  parts.push(`standing on ${s.footing}`);
  parts.push(`blood ${s.blood}`);
  if (s.oxygen !== 'ok') parts.push(`breathing ${s.oxygen}`);
  parts.push(s.energy === 'fed' ? 'not hungry' : s.energy);
  parts.push(s.water === 'watered' ? 'not thirsty' : s.water);
  parts.push(s.warmth);
  if (s.pain) parts.push(`pain in ${s.pain}`);
  if (s.wounds > 0) parts.push(`${s.wounds} wound${s.wounds === 1 ? '' : 's'}`);
  if (s.danger) parts.push(`${s.danger} nearby`);
  parts.push(`it is ${s.light}`);
  parts.push(`ahead: ${s.ahead}`);
  return parts.join(', ') + '.';
}

/**
 * Мысль от первого лица.
 *
 * Сначала — что делать, потом — почему. Это ещё не речь, а её каркас:
 * позже языковая модель научится говорить то же самое живыми фразами,
 * но факты под ними останутся этими.
 */
export function think(s: Senses): string {
  if (!s.alive) return 'I am dead.';

  if (s.danger) {
    return s.danger === 'drowning'
      ? 'I cannot breathe. I must reach the air.'
      : `There is ${s.danger} here. I must get away.`;
  }
  if (s.oxygen === 'choking') return 'I am choking. I need air now.';
  if (s.water === 'parched') return 'I am drying out. I need water.';
  if (s.energy === 'starving') return 'I am starving. I must find food.';
  if (s.warmth === 'freezing') return 'I am freezing. I need warmth.';
  if (s.warmth === 'burning') return 'I am burning up. I need shade or water.';
  if (s.pain) return `My ${s.pain} hurts.`;
  if (s.blood === 'low') return 'I have lost too much blood. I must rest.';
  if (s.water === 'thirsty') return 'I am thirsty.';
  if (s.energy === 'hungry') return 'I am hungry.';
  if (s.light === 'night') return 'It is dark. I can barely see.';
  return `I am on ${s.footing}. Nothing is wrong. I could look around.`;
}

// ------------------------------------------------------------- подробности

/**
 * Названия земли по-английски: существо думает на английском (§0 плана),
 * а таблица веществ подписана по-русски.
 */
const GROUND_NAMES: Record<number, string> = {
  [MAT.AIR]: 'air',
  [MAT.WATER]: 'water',
  [MAT.STONE]: 'stone',
  [MAT.DIRT]: 'dirt',
  [MAT.GRASS]: 'grass',
  [MAT.SAND]: 'sand',
  [MAT.CLAY]: 'clay',
  [MAT.GRAVEL]: 'gravel',
  [MAT.MUD]: 'mud',
  [MAT.SNOW]: 'snow',
  [MAT.ICE]: 'ice',
  [MAT.LAVA]: 'lava',
  [MAT.WOOD]: 'wood',
  [MAT.LEAVES]: 'leaves',
  [MAT.MOSS]: 'moss',
  [MAT.ASH]: 'ash',
  [MAT.COAL]: 'coal',
  [MAT.SALT]: 'salt',
};

function footingName(m: number): string {
  return GROUND_NAMES[m] ?? 'rough ground';
}

function worstPain(pain: Float32Array): string | null {
  const names = ['head', 'chest', 'left arm', 'right arm', 'left leg', 'right leg'];
  let worst = 0.15;
  let at = -1;
  for (let i = 0; i < pain.length; i++) {
    if (pain[i] > worst) {
      worst = pain[i];
      at = i;
    }
  }
  return at < 0 ? null : names[at];
}

function dangerNear(w: World, c: Creature): 'fire' | 'lava' | 'drowning' | null {
  const g = w.grid;
  const cx = Math.round(c.body.x[SEG.PELVIS]);
  const cy = Math.round(c.body.y[SEG.PELVIS]);
  // Смотрим вокруг тела, а не только в клетках, где оно стоит: опасность
  // важна до того, как в неё войдёшь, иначе о ней незачем и думать.
  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      const m = g.mat[y * g.w + x];
      if (m === MAT.LAVA) return 'lava';
      if (m === MAT.FIRE) return 'fire';
    }
  }
  if (c.physiology.oxygen < 60) return 'drowning';
  return null;
}

function lightName(skyLight: number): 'night' | 'dawn' | 'day' | 'dusk' {
  if (skyLight < 50) return 'night';
  if (skyLight < 130) return 'dawn';
  if (skyLight < 240) return 'day';
  return 'dusk';
}

/** Что видно впереди: первое, что попадётся на глаза. */
function aheadName(w: World, c: Creature): string {
  const g = w.grid;
  const head = SEG.HEAD;
  const facing = c.body.x[SEG.CHEST] - c.body.x[SEG.PELVIS] >= 0 ? 1 : -1;
  const hx = Math.round(c.body.x[head]);
  const hy = Math.round(c.body.y[head]);
  for (let k = 1; k <= 4; k++) {
    const x = hx + facing * k;
    if (x < 0 || x >= g.w || hy < 0 || hy >= g.h) break;
    const m = g.mat[hy * g.w + x];
    if (m === MAT.AIR) continue;
    return footingName(m);
  }
  return 'open air';
}
