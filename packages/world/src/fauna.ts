/**
 * Фауна: организмы, которые живут по алгоритмам, а не с помощью ИИ.
 *
 * Смысл этого слоя — сделать мир действительно живым до появления существа:
 * травоядные выедают траву, хищники охотятся на травоядных, рыбы пасутся
 * на водорослях, щуки охотятся на рыб. Всё вместе даёт колебания численности,
 * к которым можно прийти и посмотреть, что будет.
 *
 * Правила, заданные заказчиком:
 *   — безобидные виды сами не нападают никогда, только отвечают на атаку;
 *   — агрессивные виды нападают с вероятностью, а не на всё, что видят;
 *   — организмы бывают наземные и водные.
 *
 * Организм занимает примерно одну клетку: так он остаётся простым, попадает
 * в снапшот и не ломает сеточную симуляцию. Позиция хранится дробной ради
 * плавного движения, а столкновения проверяются по клетке.
 */
import { MAT, MATERIAL_COUNT, MAT_STATE, ST } from './materials.ts';
import type { World } from './world.ts';

// ------------------------------------------------------------------ виды

export const SPECIES = {
  NONE: 0,
  RABBIT: 1,
  DEER: 2,
  WOLF: 3,
  FISH: 4,
  PIKE: 5,
} as const;

/** Рацион. */
export const DIET = { PLANT: 0, MEAT: 1 } as const;

/** Состояния поведения. */
export const ACT = {
  WANDER: 0,
  SEEK_FOOD: 1,
  HUNT: 2,
  FLEE: 3,
  FIGHT: 4,
  REST: 5,
} as const;

export const ACT_NAME: Record<number, string> = {
  0: 'бродит',
  1: 'идёт к еде',
  2: 'охотится',
  3: 'убегает',
  4: 'дерётся',
  5: 'отдыхает',
};

export interface SpeciesDef {
  id: number;
  key: string;
  name: string;
  /** Живёт в воде. */
  aquatic: boolean;
  hp: number;
  damage: number;
  /** Клеток за тик. */
  speed: number;
  /** Вероятность начать охоту, увидев добычу. 0 — вид не нападает сам. */
  aggression: number;
  /** Отвечает ли на атаку. */
  retaliates: boolean;
  diet: number;
  sight: number;
  /** Тиков до взрослости. */
  maturity: number;
  /** Сколько энергии нужно, чтобы оставить потомство. */
  breedEnergy: number;
  maxAge: number;
  color: [number, number, number];
  size: number;
  maxCount: number;
}

function sp(base: SpeciesDef): SpeciesDef {
  return base;
}

export const SPECIES_LIST: SpeciesDef[] = [
  sp({
    id: SPECIES.RABBIT,
    key: 'rabbit',
    name: 'кролик',
    aquatic: false,
    hp: 6,
    damage: 1,
    speed: 0.085,
    aggression: 0,
    retaliates: true,
    diet: DIET.PLANT,
    sight: 9,
    maturity: 1800,
    breedEnergy: 165,
    maxAge: 42000,
    color: [214, 206, 196],
    size: 2,
    maxCount: 70,
  }),
  sp({
    id: SPECIES.DEER,
    key: 'deer',
    name: 'олень',
    aquatic: false,
    hp: 15,
    damage: 2,
    speed: 0.075,
    aggression: 0,
    retaliates: true,
    diet: DIET.PLANT,
    sight: 12,
    maturity: 3000,
    breedEnergy: 195,
    maxAge: 66000,
    color: [156, 116, 72],
    size: 3,
    maxCount: 18,
  }),
  sp({
    id: SPECIES.WOLF,
    key: 'wolf',
    name: 'волк',
    aquatic: false,
    hp: 20,
    damage: 5,
    speed: 0.105,
    aggression: 0.35,
    retaliates: true,
    diet: DIET.MEAT,
    sight: 16,
    maturity: 3000,
    breedEnergy: 200,
    maxAge: 60000,
    color: [116, 116, 128],
    size: 3,
    maxCount: 30,
  }),
  sp({
    id: SPECIES.FISH,
    key: 'fish',
    name: 'рыба',
    aquatic: true,
    hp: 4,
    damage: 1,
    speed: 0.095,
    aggression: 0,
    retaliates: true,
    diet: DIET.PLANT,
    sight: 8,
    maturity: 1200,
    breedEnergy: 135,
    maxAge: 30000,
    color: [124, 178, 208],
    size: 2,
    maxCount: 90,
  }),
  sp({
    id: SPECIES.PIKE,
    key: 'pike',
    name: 'щука',
    aquatic: true,
    hp: 13,
    damage: 4,
    speed: 0.125,
    aggression: 0.4,
    retaliates: true,
    diet: DIET.MEAT,
    sight: 14,
    maturity: 2400,
    breedEnergy: 175,
    maxAge: 45000,
    color: [86, 108, 94],
    size: 3,
    maxCount: 25,
  }),
];

export const SPECIES_BY_ID: SpeciesDef[] = (() => {
  const list: SpeciesDef[] = new Array(SPECIES_LIST.length + 1);
  list[SPECIES.NONE] = sp({
    id: 0,
    key: 'none',
    name: 'нет',
    aquatic: false,
    hp: 0,
    damage: 0,
    speed: 0,
    aggression: 0,
    retaliates: false,
    diet: DIET.PLANT,
    sight: 0,
    maturity: 0,
    breedEnergy: 0,
    maxAge: 0,
    color: [0, 0, 0],
    size: 0,
    maxCount: 0,
  });
  for (const s of SPECIES_LIST) list[s.id] = s;
  return list;
})();

// --------------------------------------------------- свойства клеток

/** Куда можно войти пешком. */
const WALKABLE = new Uint8Array(MATERIAL_COUNT);
/** На чём можно стоять. */
const SUPPORT = new Uint8Array(MATERIAL_COUNT);
/** Что едят травоядные. */
const FOOD_PLANT = new Uint8Array(MATERIAL_COUNT);
/** Что едят хищники. */
const FOOD_MEAT = new Uint8Array(MATERIAL_COUNT);

for (let m = 0; m < MATERIAL_COUNT; m++) {
  WALKABLE[m] =
    m === MAT.AIR ||
    m === MAT.GRASS ||
    m === MAT.FLOWER ||
    m === MAT.MUSHROOM ||
    m === MAT.SEED ||
    m === MAT.FRUIT ||
    m === MAT.SMOKE ||
    m === MAT.STEAM ||
    m === MAT.MEAT ||
    m === MAT.ALGAE
      ? 1
      : 0;

  SUPPORT[m] = m !== MAT.AIR && (MAT_STATE[m] === ST.SOLID || MAT_STATE[m] === ST.POWDER) ? 1 : 0;

  FOOD_PLANT[m] =
    m === MAT.GRASS || m === MAT.LEAVES || m === MAT.BUSH || m === MAT.FRUIT ||
    m === MAT.ALGAE || m === MAT.MUSHROOM || m === MAT.FLOWER
      ? 1
      : 0;

  FOOD_MEAT[m] = m === MAT.MEAT ? 1 : 0;
}

const MAX_ENTITIES = 512;
const PERCEIVE_EVERY = 12;
const MAX_ENERGY = 255;
const BASAL_COST = 2; // в единицах энергии за «тик экономики»

// ------------------------------------------------------------------ фауна

export class Fauna {
  count = 0;
  readonly species = new Uint8Array(MAX_ENTITIES);
  readonly x = new Float32Array(MAX_ENTITIES);
  readonly y = new Float32Array(MAX_ENTITIES);
  readonly hp = new Uint8Array(MAX_ENTITIES);
  readonly energy = new Uint8Array(MAX_ENTITIES);
  readonly age = new Uint32Array(MAX_ENTITIES);
  readonly act = new Uint8Array(MAX_ENTITIES);
  readonly dir = new Int8Array(MAX_ENTITIES);
  readonly timer = new Uint16Array(MAX_ENTITIES);
  readonly targetX = new Float32Array(MAX_ENTITIES);
  readonly targetY = new Float32Array(MAX_ENTITIES);
  readonly targetKind = new Uint8Array(MAX_ENTITIES);
  readonly targetIndex = new Int16Array(MAX_ENTITIES);
  /** Счётчики рождений и смертей — для наблюдателя и тестов. */
  born = 0;
  died = 0;
  starved = 0;
  eaten = 0;
  diedOld = 0;
  diedEnv = 0;
  drowned = 0;
  diedFire = 0;
  /** Кто получил урон от среды в этом тике (для разбора причин смерти). */
  readonly hurtEnv = new Uint8Array(MAX_ENTITIES);

  spawn(species: number, x: number, y: number, energy = 140): number {
    if (this.count >= MAX_ENTITIES || species === SPECIES.NONE) return -1;
    const i = this.count++;
    const def = SPECIES_BY_ID[species];
    this.species[i] = species;
    this.x[i] = x;
    this.y[i] = y;
    this.hp[i] = def.hp;
    this.energy[i] = Math.min(MAX_ENERGY, energy);
    this.age[i] = 0;
    this.act[i] = ACT.WANDER;
    this.dir[i] = 1;
    this.timer[i] = 0;
    this.targetKind[i] = 0;
    this.targetIndex[i] = -1;
    return i;
  }

  removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.species[i] = this.species[last];
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.hp[i] = this.hp[last];
    this.energy[i] = this.energy[last];
    this.age[i] = this.age[last];
    this.act[i] = this.act[last];
    this.dir[i] = this.dir[last];
    this.timer[i] = this.timer[last];
    this.targetX[i] = this.targetX[last];
    this.targetY[i] = this.targetY[last];
    this.targetKind[i] = this.targetKind[last];
    this.targetIndex[i] = this.targetIndex[last];
  }

  countOf(species: number): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.species[i] === species) n++;
    return n;
  }

  /** Полный шаг фауны. */
  step(w: World): void {
    const perceive = w.tick % PERCEIVE_EVERY === 0;

    for (let i = this.count - 1; i >= 0; i--) {
      const s = this.species[i];
      if (s === SPECIES.NONE) continue;
      const def = SPECIES_BY_ID[s];

      this.age[i]++;
      if (this.timer[i] > 0) this.timer[i]--;

      // Экономика: энергия тратится медленно, но неумолимо. Мелкий зверь
      // должен есть примерно раз в минуту, иначе он не выживет.
      const moving =
        this.act[i] === ACT.WANDER ||
        this.act[i] === ACT.SEEK_FOOD ||
        this.act[i] === ACT.HUNT ||
        this.act[i] === ACT.FLEE;
      const drainEvery = moving ? 48 : 128;
      if (w.tick % drainEvery === 0) {
        this.energy[i] = Math.max(0, this.energy[i] - 1);
      }

      if (this.energy[i] === 0 && (w.tick & 255) === 0) {
        this.hp[i] = Math.max(0, this.hp[i] - 1);
        this.starved++;
      }

      // Среда: огонь, вода не по средствам, воздух не по средствам.
      this.environment(w, i, def);

      if (this.hp[i] === 0 || this.age[i] > def.maxAge) {
        if (this.age[i] > def.maxAge) this.diedOld++;
        else if (this.hurtEnv[i] === 1) this.diedEnv++;
        this.die(w, i, def);
        continue;
      }
      this.hurtEnv[i] = 0;

      if (perceive) this.perceive(w, i, def);

      this.actOut(w, i, def);
    }
  }

  /** Опасности среды: огонь, утопление, высыхание. */
  private environment(w: World, i: number, def: SpeciesDef): void {
    const g = w.grid;
    const cx = Math.round(this.x[i]);
    const cy = Math.round(this.y[i]);
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) {
      this.hp[i] = 0;
      return;
    }
    const j = cy * g.w + cx;
    const m = g.mat[j];

    if (m === MAT.FIRE) {
      this.hp[i] = Math.max(0, this.hp[i] - 3);
      this.act[i] = ACT.FLEE;
      this.hurtEnv[i] = 1;
      this.diedFire++;
      return;
    }
    if (g.temp[j] > w.ambient[j] + 120) {
      this.hp[i] = Math.max(0, this.hp[i] - 1);
      this.hurtEnv[i] = 1;
      this.diedFire++;
    }

    if (def.aquatic && m !== MAT.WATER) {
      // Рыба без воды задыхается и пытается сползти обратно.
      if ((w.tick & 7) === 0) {
        this.hp[i] = Math.max(0, this.hp[i] - 1);
        this.hurtEnv[i] = 1;
        this.drowned++;
      }
      this.seekWater(w, i, cx, cy);
      return;
    }

    if (!def.aquatic && m === MAT.WATER) {
      // Наземный зверь в воде тонет и гребёт наверх, к воздуху.
      if ((w.tick & 7) === 0) {
        this.hp[i] = Math.max(0, this.hp[i] - 1);
        this.hurtEnv[i] = 1;
        this.drowned++;
      }
      this.y[i] = Math.max(0, this.y[i] - 0.22);
    }
  }

  /** Рыба ищет воду: сначала вбок, потом вниз. */
  private seekWater(w: World, i: number, cx: number, cy: number): void {
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ]) {
      if (this.aquaticFree(w, cx + dx, cy + dy)) {
        this.x[i] += clamp(cx + dx - this.x[i], -0.2, 0.2);
        this.y[i] += clamp(cy + dy - this.y[i], -0.2, 0.2);
        return;
      }
    }
  }

  /**
   * Восприятие: раз в PERCEIVE_EVERY тиков организм решает, чем заняться.
   * Именно здесь работает вероятность агрессии — хищник не бросается на всё
   * подряд, а лишь иногда решает, что пора охотиться.
   */
  private perceive(w: World, i: number, def: SpeciesDef): void {
    const g = w.grid;
    const rng = w.rng;
    const cx = Math.round(this.x[i]);
    const cy = Math.round(this.y[i]);

    let threatDist = Infinity;
    let preyDist = Infinity;
    let preyIndex = -1;
    let foodDist = Infinity;
    let foodX = -1;
    let foodY = -1;

    // Другие организмы: угрозы и добыча.
    for (let k = 0; k < this.count; k++) {
      if (k === i) continue;
      const os = this.species[k];
      if (os === SPECIES.NONE) continue;
      const od = SPECIES_BY_ID[os];
      if (od.aquatic !== def.aquatic) continue;

      const dx = this.x[k] - this.x[i];
      const dy = this.y[k] - this.y[i];
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > def.sight) continue;

      if (od.diet === DIET.MEAT && od.damage > def.damage) {
        if (dist < threatDist) threatDist = dist;
      } else if (def.diet === DIET.MEAT && od.damage < def.damage + 3) {
        if (dist < preyDist) {
          preyDist = dist;
          preyIndex = k;
        }
      }
    }

    // Растения: ищем съедобное в клетках вокруг.
    if (def.diet === DIET.PLANT) {
      const r = Math.min(def.sight, 8);
      for (let dy = -r; dy <= r; dy += 2) {
        const ny = cy + dy;
        if (ny < 0 || ny >= g.h) continue;
        for (let dx = -r; dx <= r; dx += 2) {
          const nx = cx + dx;
          if (nx < 0 || nx >= g.w) continue;
          const m = g.mat[ny * g.w + nx];
          if (FOOD_PLANT[m] === 0) continue;
          if (def.aquatic && m !== MAT.ALGAE) continue;
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < foodDist) {
            foodDist = dist;
            foodX = nx;
            foodY = ny;
          }
        }
      }
    } else {
      // Падаль тоже еда.
      const r = Math.min(def.sight, 8);
      for (let dy = -r; dy <= r; dy += 2) {
        const ny = cy + dy;
        if (ny < 0 || ny >= g.h) continue;
        for (let dx = -r; dx <= r; dx += 2) {
          const nx = cx + dx;
          if (nx < 0 || nx >= g.w) continue;
          if (FOOD_MEAT[g.mat[ny * g.w + nx]] === 0) continue;
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < foodDist) {
            foodDist = dist;
            foodX = nx;
            foodY = ny;
          }
        }
      }
    }

    // Решение.
    const wounded = this.hp[i] < SPECIES_BY_ID[this.species[i]].hp * 0.6;

    if (threatDist <= def.sight && (def.diet === DIET.PLANT || wounded)) {
      this.act[i] = ACT.FLEE;
      this.targetKind[i] = 2;
      this.targetX[i] = this.x[i];
      this.targetY[i] = this.y[i];
      return;
    }

    if (def.retaliates && this.act[i] === ACT.FIGHT) {
      // Уже дерётся — доводим до конца, если враг ещё рядом.
      if (preyIndex >= 0 || threatDist < def.sight) return;
      this.act[i] = ACT.WANDER;
    }

    if (def.aggression > 0 && preyIndex >= 0 && rng.chance(def.aggression)) {
      this.act[i] = ACT.HUNT;
      this.targetKind[i] = 1;
      this.targetIndex[i] = preyIndex;
      this.targetX[i] = this.x[preyIndex];
      this.targetY[i] = this.y[preyIndex];
      return;
    }

    if (foodX >= 0 && this.energy[i] < 250) {
      this.act[i] = ACT.SEEK_FOOD;
      this.targetKind[i] = 3;
      this.targetX[i] = foodX;
      this.targetY[i] = foodY;
      return;
    }

    // Отдых не кормит: он только прекращает расход. Голодный зверь,
    // который не нашёл еды, всё равно погибнет — и это правильно.
    if (this.act[i] !== ACT.REST && this.energy[i] < 40) {
      this.act[i] = ACT.REST;
      this.targetKind[i] = 0;
    }
  }

  /** Движение и действия. */
  private actOut(w: World, i: number, def: SpeciesDef): void {
    const rng = w.rng;
    const cx = Math.round(this.x[i]);
    const cy = Math.round(this.y[i]);

    if (this.act[i] === ACT.REST) {
      // Пищеварение даёт немного энергии, но отдыхом сыт не будешь.
      if ((w.tick & 63) === 0 && this.energy[i] < MAX_ENERGY) this.energy[i]++;
      return;
    }

    // Цель обновляем: добыча могла убежать.
    if (this.act[i] === ACT.HUNT && this.targetIndex[i] >= 0 && this.targetIndex[i] < this.count) {
      const t = this.targetIndex[i];
      if (this.species[t] !== SPECIES.NONE) {
        this.targetX[i] = this.x[t];
        this.targetY[i] = this.y[t];
      } else {
        this.act[i] = ACT.WANDER;
      }
    }

    let dx = 0;
    let dy = 0;

    if (this.act[i] === ACT.FLEE && this.targetKind[i] === 2) {
      dx = this.dir[i];
      dy = 0;
      // Убегаем в сторону от ближайшей угрозы.
      this.targetKind[i] = 0;
    } else if (this.targetKind[i] === 0) {
      // Бродим: иногда меняем направление.
      if (this.timer[i] === 0) {
        this.dir[i] = rng.sign() as -1 | 1;
        this.timer[i] = 40 + rng.nextInt(160);
      }
      dx = this.dir[i];
    } else {
      dx = Math.sign(this.targetX[i] - this.x[i]);
      dy = Math.sign(this.targetY[i] - this.y[i]);
    }

    this.moveStep(w, i, def, dx, dy, cx, cy);
    this.eatOrAttack(w, i, def, cx, cy);
    this.tryBreed(w, i, def);
  }

  /** Один шаг движения с учётом опоры, воды и препятствий. */
  private moveStep(
    w: World,
    i: number,
    def: SpeciesDef,
    dx: number,
    dy: number,
    cx: number,
    cy: number,
  ): void {
    const g = w.grid;

    if (def.aquatic) {
      let nx = cx + dx;
      let ny = cy + dy;
      if (!this.aquaticFree(w, nx, ny)) {
        if (this.aquaticFree(w, nx, cy)) ny = cy;
        else if (this.aquaticFree(w, cx, ny)) nx = cx;
        else {
          nx = cx;
          ny = cy;
        }
      }
      const speed = def.speed;
      const tx = nx + 0.5 * (dx === 0 ? 0 : 0);
      this.x[i] += clamp(nx - this.x[i], -speed, speed);
      this.y[i] += clamp(ny - this.y[i], -speed, speed);
      void tx;
      return;
    }

    // В воде наземный зверь не тонет под собственной тяжестью: он гребёт
    // наверх (см. environment). Иначе гравитация съедала всё всплытие.
    if (g.mat[cy * g.w + cx] === MAT.WATER) return;

    // Наземные: гравитация.
    const supported = this.supported(w, cx, cy);
    if (!supported) {
      this.y[i] = Math.min(g.h - 1, this.y[i] + 0.35);
      this.act[i] = ACT.WANDER;
      return;
    }

    if (dx !== 0) {
      const nx = cx + dx;
      // Идти можно и туда, где под клеткой пустота: следующий тик зверь
      // просто упадёт. Раньше требовалась опора, и звери не могли спуститься
      // с холма — стояли на месте и умирали с голоду.
      if (this.walkable(w, nx, cy)) {
        this.x[i] += clamp(nx - this.x[i], -def.speed, def.speed);
        this.y[i] += clamp(cy - this.y[i], -def.speed, def.speed);
        return;
      }
      // Препятствие: пробуем перелезть, до двух клеток вверх.
      for (let lift = 1; lift <= 2; lift++) {
        if (!this.walkable(w, nx, cy - lift)) break;
        if (!this.walkable(w, cx, cy - lift)) break;
        this.x[i] += clamp(nx - this.x[i], -def.speed, def.speed);
        this.y[i] += clamp(cy - lift - this.y[i], -def.speed, def.speed);
        return;
      }
      this.dir[i] = -this.dir[i] as -1 | 1;
      this.timer[i] = 20 + w.rng.nextInt(60);
    }
  }

  private walkable(w: World, x: number, y: number): boolean {
    const g = w.grid;
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false;
    const m = g.mat[y * g.w + x];
    if (m === MAT.WATER || m === MAT.FIRE) return false;
    return WALKABLE[m] === 1;
  }

  private supported(w: World, x: number, y: number): boolean {
    const g = w.grid;
    const ny = y + 1;
    if (ny >= g.h) return true;
    return SUPPORT[g.mat[ny * g.w + x]] === 1;
  }

  private aquaticFree(w: World, x: number, y: number): boolean {
    const g = w.grid;
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false;
    return g.mat[y * g.w + x] === MAT.WATER;
  }

  /** Поесть или укусить — в зависимости от того, что рядом. */
  private eatOrAttack(w: World, i: number, def: SpeciesDef, cx: number, cy: number): void {
    const g = w.grid;

    // Атака: цель рядом?
    if (this.act[i] === ACT.HUNT || this.act[i] === ACT.FIGHT) {
      for (let k = 0; k < this.count; k++) {
        if (k === i) continue;
        const os = this.species[k];
        if (os === SPECIES.NONE) continue;
        const od = SPECIES_BY_ID[os];
        if (od.aquatic !== def.aquatic) continue;
        if (Math.abs(this.x[k] - this.x[i]) > 1.6 || Math.abs(this.y[k] - this.y[i]) > 1.6) continue;

        if (this.timer[i] > 0) return;
        this.timer[i] = 24;
        this.hp[k] = Math.max(0, this.hp[k] - def.damage);

        // Ответная реакция: безобидный вид драться не начинает, но даёт сдачи.
        if (this.hp[k] > 0 && od.retaliates && this.act[k] !== ACT.FLEE) {
          this.act[k] = ACT.FIGHT;
          this.targetKind[k] = 1;
          this.targetIndex[k] = i;
          this.targetX[k] = this.x[i];
          this.targetY[k] = this.y[i];
        }
        if (this.hp[k] === 0) {
          this.die(w, k, od);
          this.eaten++;
          this.energy[i] = Math.min(MAX_ENERGY, this.energy[i] + 70);
          this.act[i] = ACT.WANDER;
          this.targetIndex[i] = -1;
        }
        return;
      }
      return;
    }

    // Еда: своя клетка и четыре соседних. Едим только когда голодны и
    // с передышкой — иначе стадо выедает луг за полминуты.
    if (this.energy[i] > 225) return;
    if (this.timer[i] > 0) return;

    const meal = def.diet === DIET.PLANT ? FOOD_PLANT : FOOD_MEAT;
    const cells = [
      [cx, cy],
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const [nx, ny] of cells) {
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const j = ny * g.w + nx;
      const m = g.mat[j];
      if (meal[m] === 0) continue;
      if (def.aquatic && m !== MAT.ALGAE) continue;

      // Траву не вырываем с корнем — остаётся земля, и она зарастёт снова.
      if (m === MAT.GRASS) g.set(nx, ny, MAT.DIRT);
      else g.set(nx, ny, MAT.AIR);

      this.energy[i] = Math.min(MAX_ENERGY, this.energy[i] + (def.diet === DIET.MEAT ? 90 : 70));
      this.timer[i] = 90;
      this.act[i] = ACT.WANDER;
      return;
    }
  }

  /** Потомство: только взрослый и хорошо упитанный организм. */
  private tryBreed(w: World, i: number, def: SpeciesDef): void {
    if (this.age[i] < def.maturity) return;
    if (this.energy[i] < def.breedEnergy) return;
    const population = this.countOf(def.id);
    if (population >= def.maxCount) return;
    if (this.count >= MAX_ENTITIES - 1) return;

    // Плодовитость падает по мере заполнения нишы: без этого стадо
    // размножается до предела, выедает всю траву и вымирает целиком.
    const crowding = population / def.maxCount;
    const chance = 0.004 * (crowding > 0.6 ? 0.15 : crowding > 0.35 ? 0.5 : 1);
    if (!w.rng.chance(chance)) return;

    const g = w.grid;
    const cx = Math.round(this.x[i]);
    const cy = Math.round(this.y[i]);
    const spots = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy - 1],
      [cx + 2, cy],
      [cx - 2, cy],
    ];
    for (const [nx, ny] of spots) {
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const ok = def.aquatic ? this.aquaticFree(w, nx, ny) : this.walkable(w, nx, ny) && this.supported(w, nx, ny);
      if (!ok) continue;
      this.energy[i] -= 70;
      const child = this.spawn(def.id, nx, ny, 110);
      if (child >= 0) this.born++;
      return;
    }
  }

  /** Смерть: остаётся падаль, которую съедят или которая истлеет. */
  private die(w: World, i: number, def: SpeciesDef): void {
    const g = w.grid;
    const cx = Math.round(this.x[i]);
    const cy = Math.round(this.y[i]);
    if (cx >= 0 && cy >= 0 && cx < g.w && cy < g.h) {
      const j = cy * g.w + cx;
      const m = g.mat[j];
      if (m === MAT.AIR || WALKABLE[m] === 1) g.set(cx, cy, MAT.MEAT);
      else {
        // Клетка занята — кладём рядом.
        if (cx + 1 < g.w && g.mat[j + 1] === MAT.AIR) g.set(cx + 1, cy, MAT.MEAT);
        else if (cx > 0 && g.mat[j - 1] === MAT.AIR) g.set(cx - 1, cy, MAT.MEAT);
      }
    }
    this.died++;
    void def;
    this.removeAt(i);
  }

  /** Компактное представление для снапшота и кадра. */
  toBytes(): Uint8Array {
    const out = new Uint8Array(4 + this.count * 12);
    const view = new DataView(out.buffer);
    view.setUint16(0, this.count, true);
    view.setUint16(2, this.born & 0xffff, true);
    let o = 4;
    for (let i = 0; i < this.count; i++) {
      out[o] = this.species[i];
      view.setFloat32(o + 1, this.x[i], true);
      view.setFloat32(o + 5, this.y[i], true);
      out[o + 9] = this.hp[i];
      out[o + 10] = this.act[i];
      out[o + 11] = this.dir[i] & 0xff;
      o += 12;
    }
    return out;
  }

  fromBytes(bytes: Uint8Array): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.count = Math.min(view.getUint16(0, true), MAX_ENTITIES);
    this.born = view.getUint16(2, true);
    let o = 4;
    for (let i = 0; i < this.count; i++) {
      const s = bytes[o];
      this.species[i] = s;
      this.x[i] = view.getFloat32(o + 1, true);
      this.y[i] = view.getFloat32(o + 5, true);
      this.hp[i] = bytes[o + 9];
      this.energy[i] = 140;
      this.age[i] = 0;
      this.act[i] = bytes[o + 10];
      this.dir[i] = (bytes[o + 11] << 24) >> 24;
      this.timer[i] = 0;
      this.targetKind[i] = 0;
      this.targetIndex[i] = -1;
      o += 12;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Заселение мира при генерации: травоядные на лугах, рыбы в воде. */
export function seedFauna(w: World): void {
  const g = w.grid;
  const rng = w.rng;
  const fauna = w.fauna;

  const landSpots: number[] = [];
  const shoreSpots: number[] = [];
  const waterSpots: number[] = [];

  // Ищем места не случайными тычками, а обходом поверхности: так звери
  // гарантированно попадают на луг, а рыбы — в достаточно глубокую воду.
  for (let x = 1; x < g.w - 1; x += 2) {
    for (let y = 1; y < g.h - 1; y++) {
      const i = y * g.w + x;
      const m = g.mat[i];
      if (m === MAT.AIR && g.mat[i + g.w] === MAT.GRASS) {
        landSpots.push(i);
        break;
      }
      if (m === MAT.WATER) {
        if (g.mat[i + g.w] === MAT.WATER && g.mat[i - g.w] === MAT.WATER) waterSpots.push(i);
        else if (g.mat[i + g.w] === MAT.WATER) shoreSpots.push(i);
        break;
      }
      if (m !== MAT.AIR) break;
    }
  }

  const pick = (list: number[], count: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < count && list.length > 0; k++) {
      out.push(list[rng.nextInt(list.length)]);
    }
    return out;
  };

  for (const i of pick(landSpots, Math.min(26, landSpots.length))) {
    const roll = rng.nextFloat();
    const kind = roll < 0.12 ? SPECIES.WOLF : roll < 0.3 ? SPECIES.DEER : SPECIES.RABBIT;
    fauna.spawn(kind, i % g.w, (i / g.w) | 0, 160);
  }

  for (const i of pick(waterSpots, Math.min(26, waterSpots.length))) {
    fauna.spawn(rng.chance(0.16) ? SPECIES.PIKE : SPECIES.FISH, i % g.w, (i / g.w) | 0, 160);
  }

  for (const i of pick(shoreSpots, Math.min(8, shoreSpots.length))) {
    fauna.spawn(SPECIES.FISH, i % g.w, (i / g.w) | 0, 160);
  }
}
