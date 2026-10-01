/**
 * Отрисовка мира в RGBA.
 *
 * Используется headless-скриптом (PNG для проверки глазами) и задаёт ту же
 * формулу цвета, что и браузер: свет решает всё. Небо светлеет днём и темнеет
 * ночью, пещеры уходят в темноту, огонь светит сам.
 */
import { hash2d } from '../../core/src/rng.ts';
import type { Grid } from './grid.ts';
import { MAT, MATERIALS } from './materials.ts';

export interface RenderOptions {
  /** Температура среды по клеткам. */
  ambient: Int16Array;
  thermal: boolean;
  /**
   * Текущий свет неба. Нужен потому, что свет в клетках замерзает вместе
   * со спящими чанками: чанк, который никто не трогает, остаётся освещён
   * так, как было в момент засыпания. На экране это выглядело как
   * прямоугольники другого цвета — то день, то ночь в соседних чанках.
   */
  skyLight?: number;
}

/** Ночное и дневное небо. */
const SKY_NIGHT: [number, number, number] = [10, 13, 26];
const SKY_DAY: [number, number, number] = [92, 138, 198];

/** Цвет воздуха в пещерах: это не небо, а темнота под землёй. */
const CAVE_AIR: [number, number, number] = [26, 22, 20];

export function renderRGBA(grid: Grid, out: Uint8Array, opts: RenderOptions): Uint8Array {
  const { w, h } = grid;
  const mat = grid.mat;
  const temp = grid.temp;
  const light = grid.light;
  const ambient = opts.ambient;
  const n = w * h;
  const sky = opts.skyLight ?? -1;

  // Уровень поверхности по столбцам: выше него свет берётся из текущего
  // времени суток, ниже — из клетки (там уже учтены огонь и лава).
  let surfaceY: Int16Array | null = null;
  if (sky >= 0) {
    surfaceY = new Int16Array(w);
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h && mat[y * w + x] === MAT.AIR) y++;
      surfaceY[x] = y;
    }
  }

  for (let i = 0; i < n; i++) {
    const m = mat[i];
    let l = light[i];
    let caveAir = false;
    if (surfaceY !== null) {
      const x = i % w;
      const y = (i / w) | 0;
      if (m === MAT.AIR) {
        // Только воздух НАД поверхностью — небо, и оно всегда текущее.
        // Воздух в пещерах — это темнота под землёй, и красить его небом
        // нельзя: иначе пещеры выглядят залитыми тёмной водой.
        if (y < surfaceY[x]) l = sky;
        else caveAir = true;
      } else {
        const depth = y - surfaceY[x];
        // У самой поверхности свет тоже должен следовать за солнцем;
        // глубже он гаснет, и там остаётся только свет огня.
        const fromSky = depth <= 0 ? sky : depth < 3 ? sky * (1 - depth * 0.35) : 0;
        if (fromSky > l) l = fromSky;
      }
    }
    const lp = l / 255;

    let r: number;
    let g: number;
    let b: number;

    if (m === MAT.AIR) {
      let r0: number;
      let g0: number;
      let b0: number;
      if (caveAir) {
        // Свет в пещере свой: от огня и лавы, а без них — темнота.
        const k = 0.25 + 0.75 * lp;
        r0 = CAVE_AIR[0] * k;
        g0 = CAVE_AIR[1] * k;
        b0 = CAVE_AIR[2] * k;
      } else {
        // Небо: смесь ночного и дневного по текущему свету.
        r0 = SKY_NIGHT[0] + (SKY_DAY[0] - SKY_NIGHT[0]) * lp;
        g0 = SKY_NIGHT[1] + (SKY_DAY[1] - SKY_NIGHT[1]) * lp;
        b0 = SKY_NIGHT[2] + (SKY_DAY[2] - SKY_NIGHT[2]) * lp;
      }
      const o = i * 4;
      out[o] = r0;
      out[o + 1] = g0;
      out[o + 2] = b0;
      out[o + 3] = 255;
      continue;
    }

    const def = MATERIALS[m];
    const jitter =
      def.variance === 0
        ? 0
        : ((((hash2d(i % w, (i / w) | 0) >>> 8) & 0xff) / 255 - 0.5) * 2 * def.variance);

    // Освещённость: даже в темноте материал не проваливается в чёрный квадрат.
    const shade = 0.18 + 0.82 * lp;
    r = (def.color[0] + jitter) * shade;
    g = (def.color[1] + jitter) * shade;
    b = (def.color[2] + jitter) * shade;

    if (opts.thermal) {
      const dt = temp[i] - ambient[i];
      if (dt > 40) {
        const k = Math.min(1, (dt - 40) / 400);
        r += (255 - r) * k;
        g += (170 - g) * k * 0.8;
        b += (60 - b) * k * 0.6;
        const glow = k * k * 0.6;
        r += (255 - r) * glow;
        g += (255 - g) * glow;
        b += (230 - b) * glow;
      } else if (dt < -8) {
        const k = Math.min(1, (-dt - 8) / 60);
        r += (150 - r) * k * 0.6;
        g += (200 - g) * k * 0.5;
        b += (255 - b) * k;
      }
    }

    const o = i * 4;
    out[o] = r < 0 ? 0 : r > 255 ? 255 : r;
    out[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    out[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    out[o + 3] = 255;
  }

  return out;
}

export function createRGBABuffer(grid: Grid): Uint8Array {
  return new Uint8Array(grid.w * grid.h * 4);
}

/**
 * Рисует живность поверх мира.
 *
 * Организмы не клетки, а существа поверх сетки, поэтому рисуются квадратиком
 * со «глазом» в сторону движения — так видно, кто куда идёт. Цвет вида задан
 * в его описании, размер тоже.
 */
export function drawFauna(
  rgba: Uint8Array,
  width: number,
  height: number,
  fauna: {
    count: number;
    species: Uint8Array;
    x: Float32Array;
    y: Float32Array;
  },
  speciesColor: (id: number) => [number, number, number],
  speciesSize: (id: number) => number,
): void {
  for (let i = 0; i < fauna.count; i++) {
    const id = fauna.species[i];
    if (id === 0) continue;
    const size = speciesSize(id);
    const [r, g, b] = speciesColor(id);
    const cx = Math.round(fauna.x[i]);
    const cy = Math.round(fauna.y[i]);

    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const px = cx + dx - ((size / 2) | 0);
        const py = cy + dy - ((size / 2) | 0);
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const o = (py * width + px) * 4;
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = 255;
      }
    }
  }
}


/**
 * Рисует тело: сегменты и связи между ними.
 *
 * Пока это скелет, а не существо: так видно, что физика работает —
 * связи натянуты, конечности на месте, тело лежит, а не развалилось.
 */
export function drawBody(
  rgba: Uint8Array,
  width: number,
  height: number,
  body: {
    x: Float32Array;
    y: Float32Array;
  },
  segmentCount: number,
  links: Array<{ id: number; parent: number }>,
  color: [number, number, number],
): void {
  const put = (px: number, py: number, r: number, c: [number, number, number]): void => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = Math.round(px) + dx;
        const y = Math.round(py) + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const o = (y * width + x) * 4;
        rgba[o] = c[0];
        rgba[o + 1] = c[1];
        rgba[o + 2] = c[2];
        rgba[o + 3] = 255;
      }
    }
  };

  // Сначала кости — тонкой линией между сегментами.
  for (const l of links) {
    const x0 = body.x[l.parent];
    const y0 = body.y[l.parent];
    const x1 = body.x[l.id];
    const y1 = body.y[l.id];
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      put(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0, [40, 30, 26]);
    }
  }

  for (let i = 0; i < segmentCount; i++) {
    put(body.x[i], body.y[i], 1, color);
  }
}
