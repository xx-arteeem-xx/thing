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
}

/** Ночное и дневное небо. */
const SKY_NIGHT: [number, number, number] = [10, 13, 26];
const SKY_DAY: [number, number, number] = [92, 138, 198];

export function renderRGBA(grid: Grid, out: Uint8Array, opts: RenderOptions): Uint8Array {
  const { w, h } = grid;
  const mat = grid.mat;
  const temp = grid.temp;
  const light = grid.light;
  const ambient = opts.ambient;
  const n = w * h;

  for (let i = 0; i < n; i++) {
    const m = mat[i];
    const l = light[i];
    const lp = l / 255;

    let r: number;
    let g: number;
    let b: number;

    if (m === MAT.AIR) {
      // Небо: смесь ночного и дневного по текущему свету.
      r = SKY_NIGHT[0] + (SKY_DAY[0] - SKY_NIGHT[0]) * lp;
      g = SKY_NIGHT[1] + (SKY_DAY[1] - SKY_NIGHT[1]) * lp;
      b = SKY_NIGHT[2] + (SKY_DAY[2] - SKY_NIGHT[2]) * lp;
      const o = i * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
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
