/**
 * Окно наблюдателя.
 *
 * Ничего не решает и не хранит состояние мира: получает кадры (кейфрейм или
 * патч изменившихся чанков), рисует их и, в отладочном режиме, отправляет
 * правки кистью. Если закрыть вкладку — мир продолжит жить на сервере.
 */

const FRAME_MAGIC = 0x31524656;
const FT = { KEYFRAME: 0, PATCH: 1, NOCHANGE: 2 };
const CHUNK = 16;

const WEATHER_NAME = ['ясно', 'дождь', 'снег', 'гроза'];
const SKY_NIGHT = [10, 13, 26];
const SKY_DAY = [92, 138, 198];

const state = {
  width: 0,
  height: 0,
  mat: null,
  temp: null,
  light: null,
  since: -1,
  materials: [],
  byId: new Map(),
  selected: 10,
  brush: 4,
  paused: false,
  debugTools: true,
  hasKeyframe: false,
  needsRedraw: true,
  rawMode: typeof DecompressionStream === 'undefined',
  pending: [],
  inFlight: false,
};

const el = {
  canvas: document.getElementById('view'),
  materials: document.getElementById('materials'),
  brush: document.getElementById('brush'),
  brushValue: document.getElementById('brush-value'),
  metrics: document.getElementById('metrics'),
  worldStats: document.getElementById('world-stats'),
  materialStats: document.getElementById('material-stats'),
  hover: document.getElementById('hover'),
  linkDot: document.getElementById('link-dot'),
  linkState: document.getElementById('link-state'),
  btnPause: document.getElementById('btn-pause'),
  btnStep: document.getElementById('btn-step'),
  btnStep60: document.getElementById('btn-step60'),
  btnSave: document.getElementById('btn-save'),
  btnLoad: document.getElementById('btn-load'),
};

const ctx = el.canvas.getContext('2d', { alpha: false });
let imageData = null;
let rgba = null;

// ------------------------------------------------------------------ утилиты

function hash2d(x, y) {
  let h = (Math.imul(x, 0x1f1f1f1f) ^ Math.imul(y, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function setLink(ok, text) {
  el.linkDot.className = `dot ${ok ? 'ok' : 'bad'}`;
  el.linkState.textContent = text;
}

// ------------------------------------------------------------ разбор кадров

async function decodeFrame(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== FRAME_MAGIC) throw new Error('чужой формат кадра');
  const type = view.getUint8(5);
  const compression = view.getUint8(6);
  const tick = view.getUint32(8, true);
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const payloadLen = view.getUint32(16, true);

  let payload = new Uint8Array(buffer, 20, payloadLen);
  if (compression === 1) payload = await inflate(payload);
  return { type, tick, width, height, payload };
}

function allocate(width, height) {
  state.width = width;
  state.height = height;
  state.mat = new Uint8Array(width * height);
  state.temp = new Int16Array(width * height);
  state.light = new Uint8Array(width * height);
  el.canvas.width = width;
  el.canvas.height = height;
  imageData = ctx.createImageData(width, height);
  rgba = imageData.data;
}

function applyKeyframe(frame) {
  if (!state.mat || state.width !== frame.width || state.height !== frame.height) {
    allocate(frame.width, frame.height);
  }
  const cells = frame.width * frame.height;
  const p = frame.payload;
  state.mat.set(p.subarray(0, cells), 0);

  const dv = new DataView(p.buffer, p.byteOffset + cells, cells * 2);
  for (let i = 0; i < cells; i++) state.temp[i] = dv.getInt16(i * 2, true);

  state.light.set(p.subarray(cells + cells * 2, cells * 3 + cells * 2), 0);
  state.hasKeyframe = true;
}

function applyPatch(frame) {
  if (!state.hasKeyframe) return false;
  const p = frame.payload;
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const count = dv.getUint32(0, true);
  let o = 4;
  const cells = CHUNK * CHUNK;
  const tempBytes = cells * 2;

  for (let k = 0; k < count; k++) {
    const cx = dv.getUint16(o, true);
    const cy = dv.getUint16(o + 2, true);
    o += 4;

    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;

    for (let ly = 0; ly < CHUNK; ly++) {
      const y = y0 + ly;
      if (y >= state.height) {
        o += CHUNK;
        continue;
      }
      const row = y * state.width;
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx;
        const m = p[o++];
        if (x < state.width) state.mat[row + x] = m;
      }
    }

    for (let ly = 0; ly < CHUNK; ly++) {
      const y = y0 + ly;
      if (y >= state.height) {
        o += tempBytes;
        continue;
      }
      const row = y * state.width;
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx;
        const t = dv.getInt16(o, true);
        o += 2;
        if (x < state.width) state.temp[row + x] = t;
      }
    }

    for (let ly = 0; ly < CHUNK; ly++) {
      const y = y0 + ly;
      if (y >= state.height) {
        o += CHUNK;
        continue;
      }
      const row = y * state.width;
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx;
        const l = p[o++];
        if (x < state.width) state.light[row + x] = l;
      }
    }
  }
  return true;
}

// ------------------------------------------------------------------ отрисовка

function render() {
  if (!state.mat || !state.needsRedraw) return;
  state.needsRedraw = false;

  const { width, mat, temp, light, byId } = state;
  const n = width * state.height;

  for (let i = 0; i < n; i++) {
    const m = mat[i];
    const lp = light[i] / 255;

    let r;
    let g;
    let b;

    if (m === 0) {
      r = SKY_NIGHT[0] + (SKY_DAY[0] - SKY_NIGHT[0]) * lp;
      g = SKY_NIGHT[1] + (SKY_DAY[1] - SKY_NIGHT[1]) * lp;
      b = SKY_NIGHT[2] + (SKY_DAY[2] - SKY_NIGHT[2]) * lp;
    } else {
      const def = byId.get(m);
      const base = def ? def.color : [255, 0, 255];
      const variance = def ? def.variance : 0;

      let jitter = 0;
      if (variance !== 0) {
        const v = hash2d(i % width, (i / width) | 0);
        jitter = ((((v >>> 8) & 0xff) / 255 - 0.5) * 2 * variance) | 0;
      }

      const shade = 0.18 + 0.82 * lp;
      r = (base[0] + jitter) * shade;
      g = (base[1] + jitter) * shade;
      b = (base[2] + jitter) * shade;

      if (def && def.glow > 0) {
        r = 255;
        g = 150 + jitter;
        b = 40;
      }
    }

    const o = i * 4;
    rgba[o] = r < 0 ? 0 : r > 255 ? 255 : r;
    rgba[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    rgba[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    rgba[o + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
}

// --------------------------------------------------------------- получение

async function pump() {
  try {
    const res = await fetch(`/api/frame?since=${state.since}${state.rawMode ? '&raw=1' : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const frame = await decodeFrame(await res.arrayBuffer());

    if (frame.type === FT.KEYFRAME) applyKeyframe(frame);
    else if (frame.type === FT.PATCH) {
      if (!applyPatch(frame)) state.since = -1;
    }

    if (frame.type !== FT.NOCHANGE) state.needsRedraw = true;
    state.since = frame.tick;
    setLink(true, 'живёт');
  } catch (err) {
    setLink(false, `нет связи: ${err.message}`);
    state.since = -1;
  } finally {
    setTimeout(pump, 50);
  }
}

function clockText(timeOfDay) {
  const totalMinutes = Math.floor(timeOfDay * 24 * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function refreshMeta() {
  try {
    const meta = await (await fetch('/api/meta')).json();
    state.paused = meta.paused;
    state.debugTools = meta.debugTools;
    document.body.classList.toggle('debug-off', !meta.debugTools);
    el.btnPause.textContent = meta.paused ? 'Продолжить' : 'Пауза';
    el.metrics.innerHTML =
      `<span>тик <b>${meta.tick}</b></span>` +
      `<span>темп <b>${meta.tps}</b>/с</span>` +
      `<span>время <b>${clockText(meta.timeOfDay)}</b></span>` +
      `<span>погода <b>${WEATHER_NAME[meta.weather] ?? meta.weather}</b></span>` +
      `<span>${meta.paused ? '<b>пауза</b>' : 'идёт'}</span>` +
      `<span>${meta.thermalIdle ? 'тепло: покой' : 'тепло: активно'}</span>` +
      `<span>${Math.floor(meta.uptimeSec / 60)} мин</span>`;
  } catch {
    /* связь уже показана в pump */
  } finally {
    setTimeout(refreshMeta, 1000);
  }
}

async function refreshStats() {
  try {
    const [stats, meta] = await Promise.all([
      fetch('/api/stats').then((r) => r.json()),
      fetch('/api/meta').then((r) => r.json()),
    ]);
    el.worldStats.innerHTML =
      `<dt>тик</dt><dd>${stats.tick}</dd>` +
      `<dt>клеток</dt><dd>${stats.cells.toLocaleString('ru-RU')}</dd>` +
      `<dt>растений</dt><dd>${stats.plants.toLocaleString('ru-RU')}</dd>` +
      `<dt>горячих</dt><dd>${stats.hotCells.toLocaleString('ru-RU')}</dd>` +
      `<dt>свет неба</dt><dd>${stats.skyLight}</dd>` +
      `<dt>размер</dt><dd>${meta.width}×${meta.height}</dd>`;

    const rows = state.materials
      .map((m) => ({ m, n: stats.byMaterial[m.key] ?? 0 }))
      .filter((e) => e.n > 0)
      .sort((a, b) => b.n - a.n)
      .map(({ m, n }) => `<dt>${m.name}</dt><dd>${n.toLocaleString('ru-RU')}</dd>`)
      .join('');
    el.materialStats.innerHTML = rows;

    for (const node of el.materials.children) {
      const id = Number(node.dataset.id);
      const m = state.byId.get(id);
      const out = node.querySelector('.count');
      if (out && m) out.textContent = (stats.byMaterial[m.key] ?? 0).toLocaleString('ru-RU');
    }
  } catch {
    /* следующий тик догонит */
  } finally {
    setTimeout(refreshStats, 1000);
  }
}

// ------------------------------------------------------------------ кисти

async function sendPoints() {
  if (state.inFlight || state.pending.length === 0) return;
  const actions = state.pending;
  state.pending = [];
  state.inFlight = true;
  try {
    const groups = new Map();
    for (const a of actions) {
      const key = `${a.kind}:${a.mat ?? ''}`;
      if (!groups.has(key)) groups.set(key, { kind: a.kind, mat: a.mat, points: [] });
      groups.get(key).points.push({ x: a.x, y: a.y });
    }
    for (const group of groups.values()) {
      const path = group.kind === 'heat' || group.kind === 'cool' ? '/api/heat' : '/api/paint';
      const body =
        group.kind === 'heat'
          ? { points: group.points, r: state.brush, delta: 120 }
          : group.kind === 'cool'
            ? { points: group.points, r: state.brush, delta: -120 }
            : { points: group.points, r: state.brush, mat: group.mat };
      await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
  } catch {
    /* следующий кадр покажет потерю связи */
  } finally {
    state.inFlight = false;
  }
}
setInterval(sendPoints, 33);

function canvasToWorld(ev) {
  const rect = el.canvas.getBoundingClientRect();
  const x = Math.floor(((ev.clientX - rect.left) / rect.width) * state.width);
  const y = Math.floor(((ev.clientY - rect.top) / rect.height) * state.height);
  return { x, y };
}

let drawing = null;

el.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

el.canvas.addEventListener('pointerdown', (ev) => {
  const { x, y } = canvasToWorld(ev);
  el.canvas.setPointerCapture(ev.pointerId);

  if (ev.button === 1) {
    selectMaterial(state.mat[y * state.width + x]);
    ev.preventDefault();
    return;
  }
  if (ev.button === 2) drawing = { kind: 'paint', mat: 0 };
  else if (ev.shiftKey) drawing = { kind: 'heat' };
  else if (ev.ctrlKey || ev.metaKey) drawing = { kind: 'cool' };
  else drawing = { kind: 'paint', mat: state.selected };

  state.pending.push({ ...drawing, x, y });
});

el.canvas.addEventListener('pointermove', (ev) => {
  const { x, y } = canvasToWorld(ev);
  updateHover(x, y);
  if (drawing && state.debugTools) state.pending.push({ ...drawing, x, y });
});

el.canvas.addEventListener('pointerup', (ev) => {
  drawing = null;
  if (el.canvas.hasPointerCapture(ev.pointerId)) el.canvas.releasePointerCapture(ev.pointerId);
});
el.canvas.addEventListener('pointercancel', () => {
  drawing = null;
});
el.canvas.addEventListener('pointerleave', () => {
  el.hover.textContent = '—';
});

function updateHover(x, y) {
  if (!state.mat) return;
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) {
    el.hover.textContent = '—';
    return;
  }
  const i = y * state.width + x;
  const def = state.byId.get(state.mat[i]);
  el.hover.textContent = `x ${x} y ${y} · ${def ? def.name : '?'} · ${state.temp[i]}°C · свет ${state.light[i]}`;
}

// ------------------------------------------------------------------- панель

function selectMaterial(id) {
  state.selected = id;
  for (const node of el.materials.children) {
    node.classList.toggle('active', Number(node.dataset.id) === id);
  }
}

function buildPalette() {
  el.materials.innerHTML = '';
  for (const m of state.materials) {
    const div = document.createElement('div');
    div.className = 'mat';
    div.dataset.id = String(m.id);
    div.innerHTML =
      `<span class="swatch" style="background: rgb(${m.color[0]},${m.color[1]},${m.color[2]})"></span>` +
      `<span>${m.name}</span><span class="count"></span>`;
    div.addEventListener('click', () => selectMaterial(m.id));
    el.materials.appendChild(div);
  }
  const initial = state.materials.some((m) => m.id === state.selected)
    ? state.selected
    : state.materials[0].id;
  selectMaterial(initial);
}

el.brush.addEventListener('input', () => {
  state.brush = Number(el.brush.value);
  el.brushValue.textContent = el.brush.value;
});

el.btnPause.addEventListener('click', async () => {
  await fetch(state.paused ? '/api/resume' : '/api/pause', { method: 'POST' });
  refreshMeta();
});

el.btnStep.addEventListener('click', () => fetch('/api/step', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n":1}' }));
el.btnStep60.addEventListener('click', () => fetch('/api/step', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n":60}' }));
el.btnSave.addEventListener('click', async () => {
  const r = await (await fetch('/api/snapshot', { method: 'POST' })).json();
  el.btnSave.textContent = r.ok ? `Сохранено (${(r.bytes / 1024) | 0} КБ)` : 'Ошибка';
  setTimeout(() => (el.btnSave.textContent = 'Снапшот'), 1500);
});
el.btnLoad.addEventListener('click', async () => {
  const r = await (await fetch('/api/load', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
  state.since = -1;
  el.btnLoad.textContent = r.ok ? 'Загружено' : 'Нет снапшотов';
  setTimeout(() => (el.btnLoad.textContent = 'Загрузить'), 1500);
});

// ------------------------------------------------------------------- старт

function frameLoop() {
  render();
  requestAnimationFrame(frameLoop);
}

async function start() {
  const list = await (await fetch('/api/materials')).json();
  state.materials = list.materials;
  state.byId = new Map(state.materials.map((m) => [m.id, m]));
  state.brush = Number(el.brush.value);
  buildPalette();
  pump();
  refreshMeta();
  refreshStats();
  requestAnimationFrame(frameLoop);
}

start().catch((err) => setLink(false, `ошибка запуска: ${err.message}`));
