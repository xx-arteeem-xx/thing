/**
 * Таблица веществ.
 *
 * Мир — это не физика частиц, а правила над клетками (инвариант И4).
 * Всё «поведение» вещества описывается этой таблицей: как оно течёт, как
 * проводит тепло и свет, при какой температуре плавится, горит и во что
 * превращается. Добавить вещество = добавить строку сюда.
 *
 * Порядок идентификаторов менять нельзя: он попадает в снапшоты.
 */

export const MAT = {
  AIR: 0,
  STONE: 1,
  DIRT: 2,
  SAND: 3,
  WATER: 4,
  ICE: 5,
  WOOD: 6,
  FIRE: 7,
  SMOKE: 8,
  STEAM: 9,
  GRASS: 10,
  LEAVES: 11,
  SAPLING: 12,
  SEED: 13,
  BUSH: 14,
  FLOWER: 15,
  MUSHROOM: 16,
  MUD: 17,
  CLAY: 18,
  GRAVEL: 19,
  COAL: 20,
  IRON_ORE: 21,
  COPPER_ORE: 22,
  SNOW: 23,
  ASH: 24,
  IRON: 25,
  COPPER: 26,
  GLASS: 27,
  BRICK: 28,
  FRUIT: 29,
} as const;

/** Агрегатное состояние — определяет, как клетка двигается. */
export const ST = {
  SOLID: 0,
  POWDER: 1,
  LIQUID: 2,
  GAS: 3,
  ENERGY: 4,
} as const;

/** «Никогда не плавится» / «никогда не замерзает». */
export const NO_TEMP = 32767;
export const NO_FREEZE = -32768;

/** Свет: сколько теряется при проходе сквозь клетку (255 — непрозрачно). */
export const OPAQUE = 255;

export interface MatDef {
  id: number;
  key: string;
  /** Подпись для интерфейса наблюдателя. */
  name: string;
  state: number;
  color: [number, number, number];
  /** Разброс оттенка по клеткам — чтобы песок выглядел песком, а не заливкой. */
  variance: number;
  density: number;
  conductivity: number;
  /** Потеря света при прохождении клетки. */
  lightAtten: number;
  /** Собственное свечение 0..255. */
  emissive: number;
  /** Плавится при temp >= meltTemp с вероятностью meltChance за тик. */
  meltTemp: number;
  meltInto: number;
  meltChance: number;
  /** Замерзает/конденсируется при temp <= freezeTemp. */
  freezeTemp: number;
  freezeInto: number;
  freezeChance: number;
  burnTemp: number;
  flammable: number;
  /** Во что превращается, сгорев (пепел или ничего). */
  burnInto: number;
  burnIntoChance: number;
  /** Время жизни в тиках (0 — вечное). */
  lifetime: number;
  lifetimeInto: number;
  /** На сколько клеток растекается жидкость/газ за тик. */
  dispersion: number;
  /** Яркость свечения для отрисовки, 0..1. */
  glow: number;
}

function def(
  base: { id: number; key: string; name: string; state: number; color: [number, number, number] },
  over: Partial<MatDef> = {},
): MatDef {
  return {
    variance: 8,
    density: 1000,
    conductivity: 0.25,
    lightAtten: 0,
    emissive: 0,
    meltTemp: NO_TEMP,
    meltInto: 0,
    meltChance: 1,
    freezeTemp: NO_FREEZE,
    freezeInto: 0,
    freezeChance: 1,
    burnTemp: 9999,
    flammable: 0,
    burnInto: 0,
    burnIntoChance: 0,
    lifetime: 0,
    lifetimeInto: 0,
    dispersion: 0,
    glow: 0,
    ...base,
    ...over,
  };
}

export const MATERIALS: MatDef[] = [
  def({ id: MAT.AIR, key: 'air', name: 'воздух', state: ST.SOLID, color: [10, 11, 16] }, {
    density: 1,
    conductivity: 0.6,
    lightAtten: 0,
  }),
  def({ id: MAT.STONE, key: 'stone', name: 'камень', state: ST.SOLID, color: [108, 106, 104] }, {
    variance: 12,
    density: 2600,
    conductivity: 0.35,
    lightAtten: OPAQUE,
  }),
  def({ id: MAT.DIRT, key: 'dirt', name: 'земля', state: ST.POWDER, color: [96, 68, 44] }, {
    variance: 16,
    density: 1500,
    conductivity: 0.25,
    lightAtten: 60,
  }),
  def({ id: MAT.SAND, key: 'sand', name: 'песок', state: ST.POWDER, color: [216, 194, 132] }, {
    variance: 18,
    density: 1600,
    conductivity: 0.3,
    lightAtten: 50,
  }),
  def({ id: MAT.WATER, key: 'water', name: 'вода', state: ST.LIQUID, color: [44, 92, 190] }, {
    variance: 8,
    density: 1000,
    conductivity: 0.55,
    lightAtten: 12,
    meltTemp: 100,
    meltInto: MAT.STEAM,
    meltChance: 0.06,
    freezeTemp: -2,
    freezeInto: MAT.ICE,
    freezeChance: 0.05,
    dispersion: 3,
  }),
  def({ id: MAT.ICE, key: 'ice', name: 'лёд', state: ST.SOLID, color: [168, 214, 236] }, {
    variance: 10,
    density: 900,
    conductivity: 0.5,
    lightAtten: 14,
    meltTemp: 0,
    meltInto: MAT.WATER,
    meltChance: 0.15,
  }),
  def({ id: MAT.WOOD, key: 'wood', name: 'древесина', state: ST.SOLID, color: [112, 76, 40] }, {
    variance: 16,
    density: 600,
    conductivity: 0.22,
    lightAtten: 26,
    burnTemp: 250,
    flammable: 0.05,
    burnInto: MAT.ASH,
    burnIntoChance: 0.3,
  }),
  def({ id: MAT.FIRE, key: 'fire', name: 'огонь', state: ST.ENERGY, color: [255, 150, 40] }, {
    variance: 34,
    density: 0.3,
    conductivity: 0.9,
    emissive: 255,
    lifetime: 240,
    lifetimeInto: MAT.SMOKE,
    dispersion: 1,
    glow: 1,
  }),
  def({ id: MAT.SMOKE, key: 'smoke', name: 'дым', state: ST.GAS, color: [62, 62, 66] }, {
    variance: 10,
    density: 0.6,
    conductivity: 0.5,
    lightAtten: 24,
    lifetime: 420,
    lifetimeInto: MAT.AIR,
    dispersion: 2,
  }),
  def({ id: MAT.STEAM, key: 'steam', name: 'пар', state: ST.GAS, color: [200, 204, 216] }, {
    variance: 10,
    density: 0.5,
    conductivity: 0.7,
    lightAtten: 10,
    lifetime: 900,
    lifetimeInto: MAT.AIR,
    freezeTemp: 100,
    freezeInto: MAT.WATER,
    freezeChance: 0.01,
    dispersion: 3,
  }),

  // --- растительность
  def({ id: MAT.GRASS, key: 'grass', name: 'трава', state: ST.SOLID, color: [74, 138, 56] }, {
    variance: 20,
    density: 900,
    conductivity: 0.2,
    lightAtten: 8,
    burnTemp: 220,
    flammable: 0.12,
    burnInto: MAT.ASH,
    burnIntoChance: 0.55,
  }),
  def({ id: MAT.LEAVES, key: 'leaves', name: 'листва', state: ST.SOLID, color: [56, 118, 48] }, {
    variance: 26,
    density: 400,
    conductivity: 0.2,
    lightAtten: 30,
    burnTemp: 200,
    flammable: 0.28,
    burnInto: MAT.ASH,
    burnIntoChance: 0.45,
  }),
  def({ id: MAT.SAPLING, key: 'sapling', name: 'росток', state: ST.SOLID, color: [96, 156, 66] }, {
    variance: 18,
    density: 500,
    conductivity: 0.2,
    lightAtten: 10,
    burnTemp: 200,
    flammable: 0.2,
    burnInto: MAT.ASH,
    burnIntoChance: 0.4,
  }),
  def({ id: MAT.SEED, key: 'seed', name: 'семя', state: ST.POWDER, color: [176, 148, 84] }, {
    variance: 16,
    density: 500,
    conductivity: 0.2,
    lightAtten: 20,
    burnTemp: 200,
    flammable: 0.15,
    burnInto: MAT.ASH,
    burnIntoChance: 0.5,
  }),
  def({ id: MAT.BUSH, key: 'bush', name: 'куст', state: ST.SOLID, color: [64, 120, 52] }, {
    variance: 22,
    density: 500,
    conductivity: 0.2,
    lightAtten: 22,
    burnTemp: 200,
    flammable: 0.22,
    burnInto: MAT.ASH,
    burnIntoChance: 0.4,
  }),
  def({ id: MAT.FLOWER, key: 'flower', name: 'цветок', state: ST.SOLID, color: [216, 132, 186] }, {
    variance: 40,
    density: 400,
    conductivity: 0.2,
    lightAtten: 8,
    burnTemp: 190,
    flammable: 0.2,
    burnInto: MAT.ASH,
    burnIntoChance: 0.5,
  }),
  def({ id: MAT.MUSHROOM, key: 'mushroom', name: 'гриб', state: ST.SOLID, color: [186, 172, 152] }, {
    variance: 22,
    density: 500,
    conductivity: 0.2,
    lightAtten: 10,
    burnTemp: 190,
    flammable: 0.12,
    burnInto: MAT.ASH,
    burnIntoChance: 0.4,
  }),
  def({ id: MAT.FRUIT, key: 'fruit', name: 'плод', state: ST.POWDER, color: [206, 76, 62] }, {
    variance: 24,
    density: 600,
    conductivity: 0.25,
    lightAtten: 14,
  }),

  // --- грунт
  def({ id: MAT.MUD, key: 'mud', name: 'грязь', state: ST.POWDER, color: [78, 56, 38] }, {
    variance: 14,
    density: 1400,
    conductivity: 0.3,
    lightAtten: 60,
  }),
  def({ id: MAT.CLAY, key: 'clay', name: 'глина', state: ST.POWDER, color: [150, 112, 92] }, {
    variance: 14,
    density: 1700,
    conductivity: 0.28,
    lightAtten: 60,
    meltTemp: 700,
    meltInto: MAT.BRICK,
    meltChance: 0.02,
  }),
  def({ id: MAT.GRAVEL, key: 'gravel', name: 'гравий', state: ST.POWDER, color: [124, 120, 116] }, {
    variance: 22,
    density: 1800,
    conductivity: 0.3,
    lightAtten: 70,
  }),

  // --- руды и металлы
  def({ id: MAT.COAL, key: 'coal', name: 'уголь', state: ST.SOLID, color: [46, 46, 50] }, {
    variance: 14,
    density: 1400,
    conductivity: 0.3,
    lightAtten: OPAQUE,
    burnTemp: 320,
    flammable: 0.02,
    burnInto: MAT.ASH,
    burnIntoChance: 0.6,
  }),
  def({ id: MAT.IRON_ORE, key: 'iron_ore', name: 'руда железа', state: ST.SOLID, color: [122, 100, 88] }, {
    variance: 16,
    density: 2800,
    conductivity: 0.4,
    lightAtten: OPAQUE,
  }),
  def({ id: MAT.COPPER_ORE, key: 'copper_ore', name: 'руда меди', state: ST.SOLID, color: [110, 118, 96] }, {
    variance: 18,
    density: 2800,
    conductivity: 0.4,
    lightAtten: OPAQUE,
  }),
  def({ id: MAT.IRON, key: 'iron', name: 'железо', state: ST.SOLID, color: [162, 166, 174] }, {
    variance: 10,
    density: 2800,
    conductivity: 0.75,
    lightAtten: OPAQUE,
  }),
  def({ id: MAT.COPPER, key: 'copper', name: 'медь', state: ST.SOLID, color: [186, 112, 68] }, {
    variance: 12,
    density: 2700,
    conductivity: 0.8,
    lightAtten: OPAQUE,
  }),

  // --- снег, пепел, продукты
  def({ id: MAT.SNOW, key: 'snow', name: 'снег', state: ST.POWDER, color: [226, 234, 244] }, {
    variance: 12,
    density: 300,
    conductivity: 0.3,
    lightAtten: 24,
    meltTemp: 1,
    meltInto: MAT.WATER,
    meltChance: 0.08,
  }),
  def({ id: MAT.ASH, key: 'ash', name: 'пепел', state: ST.POWDER, color: [86, 82, 78] }, {
    variance: 18,
    density: 700,
    conductivity: 0.2,
    lightAtten: 50,
  }),
  def({ id: MAT.GLASS, key: 'glass', name: 'стекло', state: ST.SOLID, color: [170, 210, 214] }, {
    variance: 8,
    density: 2500,
    conductivity: 0.5,
    lightAtten: 4,
  }),
  def({ id: MAT.BRICK, key: 'brick', name: 'кирпич', state: ST.SOLID, color: [156, 84, 62] }, {
    variance: 12,
    density: 2000,
    conductivity: 0.3,
    lightAtten: OPAQUE,
  }),
];

export const MATERIAL_COUNT = MATERIALS.length;

/** Может ли вещество self занять клетку, занятую target. */
export function canDisplace(self: MatDef, targetId: number): boolean {
  if (targetId === MAT.AIR) return true;
  const target = MATERIALS[targetId];
  if (target.state === ST.SOLID || target.state === ST.POWDER) return false;
  if (target.state === ST.LIQUID) {
    // Газ всплывает сквозь жидкость, всё остальное — нет.
    return self.state === ST.GAS;
  }
  // target — газ или огонь: пропускаем более тяжёлое вниз, более лёгкое вверх.
  if (self.state === ST.GAS || self.state === ST.ENERGY) return target.density > self.density;
  return true;
}

/** Краткие категории для интерфейса наблюдателя. */
export const MAT_GROUP: Record<string, string> = {
  air: 'воздух',
  stone: 'порода',
  dirt: 'грунт',
  sand: 'грунт',
  mud: 'грунт',
  clay: 'грунт',
  gravel: 'грунт',
  water: 'вода',
  ice: 'вода',
  snow: 'вода',
  steam: 'вода',
  wood: 'растения',
  leaves: 'растения',
  sapling: 'растения',
  seed: 'растения',
  bush: 'растения',
  flower: 'растения',
  mushroom: 'растения',
  fruit: 'растения',
  grass: 'растения',
  fire: 'энергия',
  smoke: 'энергия',
  ash: 'энергия',
  coal: 'руды',
  iron_ore: 'руды',
  copper_ore: 'руды',
  iron: 'металлы',
  copper: 'металлы',
  glass: 'продукты',
  brick: 'продукты',
};
