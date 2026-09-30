/**
 * Отрисовка мира в RGBA.
 *
 * Используется и headless-скриптом (PNG для проверки глазами), и, при желании,
 * сервером. Браузер рисует тем же алгоритмом, поэтому важно, чтобы формула
 * цвета жила в одном месте — здесь.
 */
import { hash2d } from '../../core/src/rng.ts';
import type { Grid } from './grid.ts';
import { MAT, MATERIALS } from './materials.ts';

export interface RenderOptions {
  ambient: number;
  /** Подсветка температурой: горячее — к оранжевому, холодное — к синему. */
  thermal: boolean;
}

const DEFAULTS: RenderOptions = { ambient: 20, thermal: true };

export function renderRGBA(
  grid: Grid,
  out: Uint8Array,
  opts: RenderOptions = DEFAULTS,
): Uint8Array {
  const { w, h } = grid;
  const mat = grid.mat;
  const temp = grid.temp;
  const n = w * h;

  for (let i = 0; i < n; i++) {
    const m = mat[i];
    const def = MATERIALS[m];
    const v = hash2d(i % grid.w, (i / grid.w) | 0);
    // Разброс оттенка: ±variance, стабильный по позиции (не мерцает).
    const jitter = def.variance === 0 ? 0 : (((v >>> 8) & 0xff) / 255 - 0.5) * 2 * def.variance;

    let r = def.color[0] + jitter;
    let g = def.color[1] + jitter;
    let b = def.color[2] + jitter;

    if (opts.thermal && m !== MAT.AIR) {
      const t = temp[i];
      const dt = t - opts.ambient;
      if (dt > 40) {
        const k = Math.min(1, (dt - 40) / 400);
        r += (255 - r) * k;
        g += (170 - g) * k * 0.8;
        b += (60 - b) * k * 0.6;
        // Свечение: горячее подмешивает белый в центр
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
