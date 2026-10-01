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
  species: [],
  bySpeciesId: new Map(),
  fauna: [],
  /** Существо: тело, физиология и мысли. Приходит отдельным запросом. */
  creature: null,
  /** Текущий свет неба: без него в чанках замерзает день и ночь. */
  skyLight: 255,
  /** Уровень поверхности по столбцам: выше него — небо. */
  surfaceY: null,
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
  journal: document.getElementById('journal'),
  faunaStats: document.getElementById('fauna-stats'),
  faunaEvents: document.getElementById('fauna-events'),
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

  // Сначала идёт живность, за ней — данные мира
  const faunaCount = payload[0] | (payload[1] << 8);
  const faunaBytes = 4 + faunaCount * 8;
  const fauna = [];
  if (faunaCount > 0) {
    const fv = new DataView(payload.buffer, payload.byteOffset, faunaBytes);
    for (let k = 0; k < faunaCount; k++) {
      const o = 4 + k * 8;
      fauna.push({
        species: payload[o],
        x: fv.getUint16(o + 1, true),
        y: fv.getUint16(o + 3, true),
        hp: payload[o + 5],
        act: payload[o + 6],
      });
    }
  }

  return { type, tick, width, height, payload: payload.subarray(faunaBytes), fauna };
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
  const height = state.height;
  const n = width * height;

  // Уровень поверхности: спящие чанки не обновляют свет, и без этого
  // на экране получались прямоугольники чужого времени суток.
  if (!state.surfaceY || state.surfaceY.length !== width) {
    state.surfaceY = new Int16Array(width);
  }
  const surfaceY = state.surfaceY;
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height && mat[y * width + x] === 0) y++;
    surfaceY[x] = y;
  }
  const sky = state.skyLight;

  for (let i = 0; i < n; i++) {
    const m = mat[i];
    let l = light[i];

    let r;
    let g;
    let b;

    if (m === 0) {
      // Небо над поверхностью всегда текущее; воздух в пещерах — это
      // темнота под землёй, и небом его красить нельзя.
      const x = i % width;
      const y = (i / width) | 0;
      const lp = l / 255;
      if (y < surfaceY[x]) {
        l = sky;
        const lps = l / 255;
        r = SKY_NIGHT[0] + (SKY_DAY[0] - SKY_NIGHT[0]) * lps;
        g = SKY_NIGHT[1] + (SKY_DAY[1] - SKY_NIGHT[1]) * lps;
        b = SKY_NIGHT[2] + (SKY_DAY[2] - SKY_NIGHT[2]) * lps;
      } else {
        const k = 0.25 + 0.75 * lp;
        r = 26 * k;
        g = 22 * k;
        b = 20 * k;
      }
    } else {
      const x = i % width;
      const y = (i / width) | 0;
      const depth = y - surfaceY[x];
      const fromSky = depth <= 0 ? sky : depth < 3 ? sky * (1 - depth * 0.35) : 0;
      if (fromSky > l) l = fromSky;
      const lp = l / 255;
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
  drawFauna();
  drawCreature();
}

/**
 * Существо рисуется иначе, чем звери: его надо узнавать мгновенно.
 *
 * Скелет из шестнадцати точек, тёплый контур вокруг тела и стрелка над
 * головой. Звери — маленькие квадратики, существо — крупнее и с меткой,
 * чтобы не приходилось искать его глазами по всему миру.
 */
/** Живность рисуется поверх мира: организмы не клетки, а существа. */
function drawFauna() {
  for (const f of state.fauna) {
    const def = state.bySpeciesId.get(f.species);
    if (!def) continue;
    const size = def.size;
    const half = (size / 2) | 0;
    const fx = Math.round(f.x);
    const fy = Math.round(f.y);
    // Тёмная подложка: отделяет зверя от фона. Ночью ничего не
    // подсвечиваем — в темноте и должно быть темно.
    ctx.fillStyle = 'rgba(20, 16, 14, 0.8)';
    ctx.fillRect(fx - half - 1, fy - half - 1, size + 2, size + 2);
    ctx.fillStyle = `rgb(${def.color[0]},${def.color[1]},${def.color[2]})`;
    ctx.fillRect(fx - half, fy - half, size, size);
    // глазик: сразу видно, что это зверь, а не пиксель мира
    ctx.fillStyle = '#101014';
    ctx.fillRect(fx + half - 1, fy - half, 1, 1);
  }
}

function drawCreature() {
  const c = state.creature;
  if (!c || !c.body) return;

  const x = Math.round(c.body.x);
  const y = Math.round(c.body.y);
  const alive = c.alive;
  const pts = c.segments || [];
  if (pts.length === 0) return;

  // Тело: тёмный контур и светлые точки сегментов. Без свечения —
  // оно забивало карту и мешало смотреть на мир.
  ctx.strokeStyle = alive ? 'rgba(30, 22, 18, 0.9)' : 'rgba(60, 24, 24, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const seg of pts) {
    const px = Math.round(seg.x);
    const py = Math.round(seg.y);
    ctx.moveTo(px, py);
    ctx.lineTo(px + 0.1, py + 0.1);
  }
  ctx.stroke();

  ctx.fillStyle = alive ? '#ffe9c0' : '#b06a6a';
  for (const seg of pts) ctx.fillRect(Math.round(seg.x) - 1, Math.round(seg.y) - 1, 3, 3);

  // Голова ярче: видно, куда оно смотрит.
  if (pts.length > 3) {
    ctx.fillStyle = alive ? '#ffffff' : '#d08080';
    ctx.beginPath();
    ctx.arc(Math.round(pts[3].x), Math.round(pts[3].y), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Небольшая метка над головой: найти взглядом, но не отвлекать.
  const top = Math.min(...pts.map((p) => p.y)) - 6;
  ctx.fillStyle = alive ? 'rgba(255, 212, 121, 0.85)' : 'rgba(192, 80, 80, 0.85)';
  ctx.beginPath();
  ctx.moveTo(x, top + 3);
  ctx.lineTo(x - 3, top - 2);
  ctx.lineTo(x + 3, top - 2);
  ctx.closePath();
  ctx.fill();
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
    state.fauna = frame.fauna;

    state.needsRedraw = true;
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
  // Тик 0 — полдень, поэтому к фазе суток прибавляем 12 часов.
  const totalMinutes = Math.floor(((timeOfDay * 24 + 12) % 24) * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function refreshMeta() {
  try {
    const meta = await (await fetch('/api/meta')).json();
    state.paused = meta.paused;
    state.debugTools = meta.debugTools;
    if (typeof meta.skyLight === 'number') {
      if (state.skyLight !== meta.skyLight) state.needsRedraw = true;
      state.skyLight = meta.skyLight;
    }
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

async function refreshJournal() {
  try {
    const data = await (await fetch('/api/journal')).json();
    const items = data.discoveries
      .slice(0, 14)
      .map((d) => {
        const mins = Math.floor(d.tick / 3600);
        return `<div class="disc"><span class="t">${mins}м</span> ${d.text}</div>`;
      })
      .join('');
    el.journal.innerHTML =
      `<div class="disc total">всего: ${data.total}</div>` + (items || '<div class="disc">пока пусто</div>');
  } catch {
    /* следующий тик догонит */
  } finally {
    setTimeout(refreshJournal, 3000);
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

    const faunaRows = state.species
      .map((sp) => ({ sp, n: stats.bySpecies?.[sp.key] ?? 0 }))
      .sort((a, b) => b.n - a.n)
      .map(({ sp, n }) => `<dt>${sp.name}</dt><dd>${n}</dd>`)
      .join('');
    el.faunaStats.innerHTML = faunaRows || '<dt>пусто</dt><dd>0</dd>';
    const ev = stats.faunaEvents ?? {};
    el.faunaEvents.innerHTML =
      `<dt>родилось</dt><dd>${ev.born ?? 0}</dd>` +
      `<dt>погибло</dt><dd>${ev.died ?? 0}</dd>` +
      `<dt>съедено</dt><dd>${ev.eaten ?? 0}</dd>` +
      `<dt>утонуло</dt><dd>${ev.drowned ?? 0}</dd>` +
      `<dt>сгорело</dt><dd>${ev.burned ?? 0}</dd>` +
      `<dt>от старости</dt><dd>${ev.old ?? 0}</dd>`;

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
/** Лента мыслей: то, ради чего всё затевалось. */
const thoughtLog = [];

/** Панель существа: состояние, мысль и обучение. */
function updateCreaturePanel() {
  const box = document.getElementById('creature');
  if (!box) return;
  const c = state.creature;
  if (!c) {
    box.innerHTML = '<b>существа нет</b>';
    return;
  }
  const p = c.physiology || {};
  const brain = c.brain || {};
  const bar = (v, good) => {
    const w = Math.max(0, Math.min(100, Math.round(v * 100)));
    const color = good ? '#7fc47f' : '#d08a5a';
    return `<span style="display:inline-block;width:60px;height:6px;background:#2a2622;vertical-align:middle"><span style="display:block;width:${w}%;height:6px;background:${color}"></span></span>`;
  };
  box.innerHTML =
    `<div class="cthought${c.alive ? '' : ' cdead'}">«${c.thought}»</div>` +
    `<div class="crow"><b>${c.alive ? 'живо' : 'мертво'}</b> · поколение ${c.generation}</div>` +
    `<div class="crow">кровь ${(p.blood ?? 0).toFixed(1)} л ${bar((p.blood ?? 0) / 5, (p.blood ?? 0) > 3)}</div>` +
    `<div class="crow">кислород ${Math.round(p.oxygen ?? 0)}% ${bar((p.oxygen ?? 0) / 100, (p.oxygen ?? 0) > 80)}</div>` +
    `<div class="crow">вода ${Math.round((1 - (p.thirst ?? 0)) * 100)}% ${bar(1 - (p.thirst ?? 0), (p.thirst ?? 0) < 0.5)}</div>` +
    `<div class="crow">еда ${Math.round((1 - (p.hunger ?? 0)) * 100)}% ${bar(1 - (p.hunger ?? 0), (p.hunger ?? 0) < 0.6)}</div>` +
    `<div class="crow">темп ${(p.coreTemp ?? 0).toFixed(1)}° · пульс ${Math.round(p.heartRate ?? 0)}</div>` +
    `<div class="crow" style="opacity:.65;font-size:11px">${c.innerState || ''}</div>` +
    `<div class="crow" style="opacity:.65;font-size:11px;margin-top:4px">обучений ${brain.updates ?? 0} · откатов ${brain.rollbacks ?? 0} · состояний ${brain.visitedStates ?? 0}</div>`;
}

// ------------------------------------------------------- силы наблюдателя

/**
 * Наблюдатель смотрит и распоряжается только жизнью: создать существо,
 * населить мир, сменить погоду, вернуть всё к началу. Карту не трогает —
 * редактирования мира здесь нет.
 */
async function observerAction(url, body, label) {
  const status = document.getElementById('observer-status');
  if (status) status.textContent = `${label}…`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === null ? '{}' : JSON.stringify(body),
    });
    const d = await res.json();
    if (status) {
      status.textContent = d.ok
        ? `${label}: ${d.spawned ?? d.name ?? d.generation ?? 'готово'}`
        : `${label}: ${d.error}`;
    }
    await refreshMeta();
    await pollCreature();
  } catch (err) {
    if (status) status.textContent = `${label}: не вышло (${err.message})`;
  }
}

function wireObserver() {
  const revive = document.getElementById('btn-revive');
  const spawn = document.getElementById('btn-spawn');
  const weather = document.getElementById('btn-weather');
  const reset = document.getElementById('btn-reset');
  const species = document.getElementById('spawn-species');
  const count = document.getElementById('spawn-count');
  const kind = document.getElementById('weather-kind');
  if (!revive) return;

  // Список видов берём у мира: наблюдатель населяет, но не выдумывает.
  fetch('/api/species')
    .then((r) => r.json())
    .then((d) => {
      if (!species) return;
      species.innerHTML = (d.species || [])
        .map((sp) => `<option value="${sp.key}">${sp.name}</option>`)
        .join('');
    })
    .catch(() => {});

  revive.addEventListener('click', () => {
    const c = state.creature;
    const label = c && c.alive ? 'Существо уже живо — создаю заново' : 'Создаю существо';
    observerAction('/api/revive', {}, label);
  });
  spawn?.addEventListener('click', () =>
    observerAction(
      '/api/fauna/spawn',
      { species: species?.value, count: Number(count?.value ?? 1) },
      'Создаю живых',
    ),
  );
  weather?.addEventListener('click', () =>
    observerAction('/api/weather', { kind: kind?.value }, 'Меняю погоду'),
  );
  reset?.addEventListener('click', () => {
    if (!confirm('Вернуть мир к исходному состоянию? Всё живое начнётся заново.')) return;
    observerAction('/api/world/reset', {}, 'Возвращаю мир к исходному');
  });
}

setInterval(sendPoints, 33);

/** Существо приходит отдельным запросом: в бинарном кадре его нет. */
async function pollCreature() {
  try {
    const res = await fetch('/api/creature');
    if (!res.ok) {
      state.creature = null;
      return;
    }
    const d = await res.json();
    state.creature = {
      body: d.body,
      alive: d.alive,
      segments: d.segments || [],
      thought: d.thought || '',
      generation: d.generation,
      physiology: d.physiology,
      brain: d.brain,
    };
    state.needsRedraw = true;
    // Пишем в ленту, только когда мысль сменилась: иначе она забьёт всё.
    if (d.thought && thoughtLog[thoughtLog.length - 1] !== d.thought) {
      thoughtLog.push(d.thought);
      if (thoughtLog.length > 40) thoughtLog.shift();
      const tl = document.getElementById('thoughts');
      if (tl) {
        tl.innerHTML = thoughtLog
          .slice()
          .reverse()
          .map((t, i) => `<div style="opacity:${i === 0 ? 1 : Math.max(0.25, 1 - i * 0.06)}">${t}</div>`)
          .join('');
      }
    }
    updateCreaturePanel();
  } catch {
    /* следующий опрос покажет потерю связи */
  }
}
setInterval(pollCreature, 500);
pollCreature();

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
  const [list, speciesList] = await Promise.all([
    fetch('/api/materials').then((r) => r.json()),
    fetch('/api/species').then((r) => r.json()),
  ]);
  state.materials = list.materials;
  state.byId = new Map(state.materials.map((m) => [m.id, m]));
  state.species = speciesList.species;
  state.bySpeciesId = new Map(state.species.map((sp) => [sp.id, sp]));
  state.brush = Number(el.brush.value);
  buildPalette();
  pump();
  refreshMeta();
  refreshStats();
  refreshJournal();
  requestAnimationFrame(frameLoop);
}

start().catch((err) => setLink(false, `ошибка запуска: ${err.message}`));

// Силы наблюдателя подключаются сразу при загрузке страницы.
wireObserver();
