// Единственный источник правды о персонаже.
// Из этой схемы собираются: дефолты, UI-панель, рандомайзер и валидация ссылок.
// Добавить новый параметр = добавить одну строку сюда.

import { makeRng } from '../lib/noise.js';

export const SKIN_COLORS = [
  '#5aa9e6', // кислотный синий
  '#f3e0b5', // сливочный
  '#e8642c', // оранжевый
  '#8ec63f', // ядовито-зелёный
  '#b9a3e3', // лавандовый
  '#c0392b', // кроваво-красный
  '#f28fb2', // розовый
  '#7ecbc4', // бирюзовый
  '#cfc3a4', // костяной
  '#6b4f9e', // фиолетовый
  '#3f5d76', // грязно-синий
  '#9c6b4f', // мясной
];

export const EYE_COLORS = ['#fdf6e3', '#f5e050', '#e94f37', '#9ef0a0', '#ffffff', '#d8c7ef', '#1a1420'];
export const PUPIL_COLORS = ['#0d0a12', '#2b0f1a', '#3a0d0d', '#0a2a1a', '#5a1020'];
export const LIP_COLORS = ['#7a2036', '#3a1020', '#c04a5f', '#1a0d14', '#8f3f1f', '#2d5a3a'];
export const BG_COLORS = ['#07060b', '#0b0a10', '#120b16', '#0a1014', '#161016'];

const range = (key, group, label, min, max, def, extra = {}) => ({
  key, group, label, type: 'range', min, max, step: (max - min) / 100, def, ...extra,
});
const int = (key, group, label, min, max, def, extra = {}) => ({
  key, group, label, type: 'int', min, max, step: 1, def, ...extra,
});
const select = (key, group, label, options, def, extra = {}) => ({
  key, group, label, type: 'select', options, def, ...extra,
});
const color = (key, group, label, palette, def, extra = {}) => ({
  key, group, label, type: 'color', palette, def, ...extra,
});

// Взвешенный выбор: список [значение, вес]
const weighted = (rng, pairs) => {
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rng() * total;
  for (const [value, w] of pairs) {
    r -= w;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
};
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

export const GROUPS = [
  { id: 'head', label: 'ЧЕРЕП', open: true },
  { id: 'eyes', label: 'ГЛАЗА', open: true },
  { id: 'mouth', label: 'ПАСТЬ', open: true },
  { id: 'nose', label: 'НОС И ЛОБ', open: false },
  { id: 'growths', label: 'НАРОСТЫ', open: false },
  { id: 'body', label: 'ТЕЛО', open: false },
  { id: 'style', label: 'СТИЛЬ', open: false },
];

export const PARAMS = [
  // --- ЧЕРЕП -------------------------------------------------------------
  // случайные габариты смещены к «крупной голове»: узкий череп в этом стиле
  // выглядит не уродцем, а веточкой
  range('headWidth', 'head', 'ширина', 0.55, 1.5, 1.0, { random: (rng) => 0.75 + rng() * 0.7 }),
  range('headHeight', 'head', 'высота', 0.7, 1.9, 1.15, { random: (rng) => 0.85 + rng() * 0.9 }),
  range('headDepth', 'head', 'глубина', 0.45, 1.2, 0.85, { random: (rng) => 0.6 + rng() * 0.5 }),
  range('boxiness', 'head', 'коробчатость', 0, 1, 0.15),
  range('taper', 'head', 'конусность', -0.75, 0.75, 0, { random: (rng) => (rng() * 2 - 1) * 0.7 }),
  range('jaw', 'head', 'челюсть', 0, 0.8, 0.15),
  range('lumps', 'head', 'бугристость', 0, 0.35, 0.08),
  range('lumpScale', 'head', 'размер бугров', 0.7, 6, 2.2),
  range('speckle', 'head', 'рябь кожи', 0, 1, 0.25),
  range('profile', 'head', 'профиль лоб/челюсть', -0.45, 0.45, 0),

  // --- ГЛАЗА -------------------------------------------------------------
  int('eyeCount', 'eyes', 'количество', 0, 8, 2, {
    random: (rng) => weighted(rng, [[1, 2], [2, 6], [3, 2], [4, 2], [5, 1], [6, 1], [7, 1], [8, 1]]),
  }),
  select('eyeLayout', 'eyes', 'раскладка', [
    { value: 'row', label: 'ряд' },
    { value: 'ring', label: 'кольцо' },
    { value: 'cluster', label: 'куча' },
    { value: 'column', label: 'столбик' },
    { value: 'scatter', label: 'вразнобой' },
  ], 'row'),
  select('eyeStyle', 'eyes', 'тип', [
    { value: 'ball', label: 'шар' },
    { value: 'hole', label: 'дыра' },
    { value: 'bead', label: 'бусина' },
  ], 'ball'),
  range('eyeSize', 'eyes', 'размер', 0.05, 0.4, 0.16),
  range('eyeSpread', 'eyes', 'разлёт', 0.1, 1.0, 0.42),
  range('eyeY', 'eyes', 'высота', -0.4, 0.8, 0.28),
  range('eyeBulge', 'eyes', 'выпученность', 0, 1, 0.5),
  range('pupilSize', 'eyes', 'зрачок', 0.12, 0.95, 0.42),
  range('eyeTilt', 'eyes', 'наклон', -0.6, 0.6, 0),
  color('eyeColor', 'eyes', 'белок', EYE_COLORS, '#fdf6e3'),
  color('pupilColor', 'eyes', 'зрачок', PUPIL_COLORS, '#0d0a12'),

  // --- ПАСТЬ -------------------------------------------------------------
  range('mouthY', 'mouth', 'высота', -0.85, 0.15, -0.42),
  range('mouthWidth', 'mouth', 'ширина', 0.08, 0.85, 0.4, { random: (rng) => 0.22 + rng() * 0.55 }),
  range('mouthOpen', 'mouth', 'раскрытие', 0.02, 0.6, 0.18, { random: (rng) => 0.08 + rng() * 0.42 }),
  int('teethTop', 'mouth', 'зубы сверху', 0, 14, 8),
  int('teethBottom', 'mouth', 'зубы снизу', 0, 14, 6),
  range('toothSize', 'mouth', 'длина зубов', 0.2, 1.4, 0.7),
  range('toothJag', 'mouth', 'клыкастость', 0, 1, 0.35),
  range('toothGap', 'mouth', 'щербатость', 0, 0.6, 0.1),
  range('lips', 'mouth', 'губы', 0, 0.5, 0.16),
  color('lipColor', 'mouth', 'цвет губ', LIP_COLORS, '#7a2036'),

  // --- НОС И ЛОБ ---------------------------------------------------------
  select('noseType', 'nose', 'нос', [
    { value: 'none', label: 'нет' },
    { value: 'bump', label: 'шишка' },
    { value: 'beak', label: 'клюв' },
    { value: 'snout', label: 'рыло' },
    { value: 'holes', label: 'ноздри' },
  ], 'bump'),
  range('noseSize', 'nose', 'размер носа', 0.04, 0.35, 0.13),
  range('noseY', 'nose', 'высота носа', -0.4, 0.45, -0.05),
  range('brow', 'nose', 'бровные дуги', 0, 1, 0.35),
  range('browDroop', 'nose', 'нависание', 0, 1, 0.3),

  // --- НАРОСТЫ -----------------------------------------------------------
  int('warts', 'growths', 'бородавки', 0, 40, 0, { random: (rng) => weighted(rng, [[0, 4], [6, 3], [14, 2], [28, 1]]) }),
  range('wartSize', 'growths', 'размер бородавок', 0.02, 0.16, 0.06),
  int('horns', 'growths', 'рога', 0, 8, 0, { random: (rng) => weighted(rng, [[0, 5], [2, 3], [4, 2], [6, 1]]) }),
  range('hornLen', 'growths', 'длина рогов', 0.1, 0.9, 0.35),
  int('tendrils', 'growths', 'щупальца', 0, 14, 0, { random: (rng) => weighted(rng, [[0, 5], [4, 2], [8, 2], [14, 1]]) }),
  range('tendrilLen', 'growths', 'длина щупалец', 0.15, 1.2, 0.45),
  int('spores', 'growths', 'облако спор', 0, 220, 0, { random: (rng) => weighted(rng, [[0, 6], [60, 2], [140, 1], [220, 1]]) }),

  // --- ТЕЛО --------------------------------------------------------------
  range('headRatio', 'body', 'доля головы', 0.5, 0.88, 0.7),
  range('bodyWidth', 'body', 'ширина тела', 0.3, 1.3, 0.7),
  range('limbThick', 'body', 'толщина конечностей', 0.3, 1.4, 0.7),
  range('armLen', 'body', 'длина рук', 0.2, 1.5, 1.0),
  range('legLen', 'body', 'длина ног', 0.2, 1.5, 0.8),
  range('stance', 'body', 'постановка ног', 0, 1, 0.45),

  // --- СТИЛЬ -------------------------------------------------------------
  color('skinColor', 'style', 'кожа', SKIN_COLORS, '#5aa9e6'),
  range('bodyTint', 'style', 'тело темнее', 0, 0.7, 0.25),
  range('outline', 'style', 'контур', 0, 0.12, 0.05, { random: (rng) => 0.03 + rng() * 0.05 }),
  int('pixelSize', 'style', 'размер пикселя', 1, 8, 4, { random: () => 4 }),
  int('toonSteps', 'style', 'ступени тона', 2, 5, 3, { random: () => 3 }),
  color('bgColor', 'style', 'фон', BG_COLORS, '#0b0a10', { random: () => '#0b0a10' }),
];

export const PARAM_BY_KEY = Object.fromEntries(PARAMS.map((p) => [p.key, p]));

export const DEFAULTS = Object.freeze({
  seed: 1337,
  ...Object.fromEntries(PARAMS.map((p) => [p.key, p.def])),
});

const clampNum = (p, v) => Math.min(p.max, Math.max(p.min, v));

/** Приводит произвольный объект к валидному набору параметров. */
export function sanitize(input) {
  const out = { ...DEFAULTS };
  if (!input || typeof input !== 'object') return out;

  const seed = Number(input.seed);
  if (Number.isFinite(seed)) out.seed = Math.abs(Math.floor(seed)) % 0xffffffff;

  for (const p of PARAMS) {
    const v = input[p.key];
    if (v === undefined || v === null) continue;
    if (p.type === 'range' && Number.isFinite(Number(v))) out[p.key] = clampNum(p, Number(v));
    if (p.type === 'int' && Number.isFinite(Number(v))) out[p.key] = Math.round(clampNum(p, Number(v)));
    if (p.type === 'select' && p.options.some((o) => o.value === v)) out[p.key] = v;
    if (p.type === 'color' && typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out[p.key] = v;
  }
  return out;
}

/** Полный случайный персонаж от seed. Один seed = один и тот же уродец. */
export function randomize(seed) {
  const rng = makeRng((seed >>> 0) ^ 0x9e3779b9);
  const out = { seed: seed >>> 0 };

  for (const p of PARAMS) {
    if (p.random) {
      out[p.key] = p.random(rng, out);
    } else if (p.type === 'range') {
      out[p.key] = p.min + rng() * (p.max - p.min);
    } else if (p.type === 'int') {
      out[p.key] = p.min + Math.floor(rng() * (p.max - p.min + 1));
    } else if (p.type === 'select') {
      out[p.key] = pick(rng, p.options).value;
    } else if (p.type === 'color') {
      out[p.key] = pick(rng, p.palette);
    }
  }

  // Пара правок, чтобы случайный уродец оставался читаемым персонажем,
  // а не облаком геометрии: зубы должны влезать в пасть, зрачок — в глаз.
  const teethRoom = Math.round(4 + out.mouthWidth * 18);
  out.teethTop = Math.min(out.teethTop, teethRoom);
  out.teethBottom = Math.min(out.teethBottom, teethRoom);
  out.eyeSize = Math.min(out.eyeSize, 0.1 + 0.5 / Math.max(1, out.eyeCount));

  return sanitize(out);
}

export function randomSeed() {
  return Math.floor(Math.random() * 0xffffff);
}
