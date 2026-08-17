// The single source of truth about a creature.
// Defaults, the UI panel, the randomizer and link validation are all derived
// from this schema. Adding a new parameter = adding one line here.

import { makeRng } from '../lib/noise.js';

export const SKIN_COLORS = [
  '#5aa9e6', // acid blue
  '#f3e0b5', // cream
  '#e8642c', // orange
  '#8ec63f', // toxic green
  '#b9a3e3', // lavender
  '#c0392b', // blood red
  '#f28fb2', // pink
  '#7ecbc4', // teal
  '#cfc3a4', // bone
  '#6b4f9e', // purple
  '#3f5d76', // murky blue
  '#9c6b4f', // meat
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

// Weighted pick: a list of [value, weight]
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
  { id: 'head', label: 'SKULL', open: true },
  { id: 'eyes', label: 'EYES', open: true },
  { id: 'mouth', label: 'MAW', open: true },
  { id: 'nose', label: 'NOSE & BROW', open: false },
  { id: 'growths', label: 'GROWTHS', open: false },
  { id: 'body', label: 'BODY', open: false },
  { id: 'style', label: 'STYLE', open: false },
];

export const PARAMS = [
  // --- SKULL -------------------------------------------------------------
  // Random dimensions lean towards a big head: a narrow skull in this style
  // reads as a twig rather than a freak.
  range('headWidth', 'head', 'width', 0.55, 1.5, 1.0, { random: (rng) => 0.75 + rng() * 0.7 }),
  range('headHeight', 'head', 'height', 0.7, 1.9, 1.15, { random: (rng) => 0.85 + rng() * 0.9 }),
  range('headDepth', 'head', 'depth', 0.45, 1.2, 0.85, { random: (rng) => 0.6 + rng() * 0.5 }),
  range('boxiness', 'head', 'boxiness', 0, 1, 0.15),
  range('taper', 'head', 'taper', -0.75, 0.75, 0, { random: (rng) => (rng() * 2 - 1) * 0.7 }),
  range('jaw', 'head', 'jaw', 0, 0.8, 0.15),
  range('lumps', 'head', 'lumps', 0, 0.35, 0.08),
  range('lumpScale', 'head', 'lump scale', 0.7, 6, 2.2),
  range('speckle', 'head', 'skin speckle', 0, 1, 0.25),
  range('profile', 'head', 'profile lean', -0.45, 0.45, 0),

  // --- EYES --------------------------------------------------------------
  int('eyeCount', 'eyes', 'count', 0, 8, 2, {
    random: (rng) => weighted(rng, [[1, 2], [2, 6], [3, 2], [4, 2], [5, 1], [6, 1], [7, 1], [8, 1]]),
  }),
  select('eyeLayout', 'eyes', 'layout', [
    { value: 'row', label: 'row' },
    { value: 'ring', label: 'ring' },
    { value: 'cluster', label: 'cluster' },
    { value: 'column', label: 'column' },
    { value: 'scatter', label: 'scatter' },
  ], 'row'),
  select('eyeStyle', 'eyes', 'type', [
    { value: 'ball', label: 'ball' },
    { value: 'hole', label: 'hole' },
    { value: 'bead', label: 'bead' },
    { value: 'stalk', label: 'on stalks' },
  ], 'ball', {
    random: (rng) => weighted(rng, [['ball', 5], ['hole', 3], ['bead', 3], ['stalk', 2]]),
  }),
  select('pupilShape', 'eyes', 'pupil shape', [
    { value: 'round', label: 'round' },
    { value: 'slit', label: 'slit' },
    { value: 'goat', label: 'goat' },
    { value: 'cross', label: 'cross' },
    { value: 'ring', label: 'ring' },
    { value: 'blind', label: 'blind' },
  ], 'round', {
    random: (rng) => weighted(rng, [['round', 5], ['slit', 3], ['goat', 2], ['cross', 2], ['ring', 2], ['blind', 1]]),
  }),
  range('eyeSize', 'eyes', 'size', 0.05, 0.4, 0.16),
  range('eyeSpread', 'eyes', 'spread', 0.1, 1.0, 0.42),
  range('eyeY', 'eyes', 'height', -0.4, 0.8, 0.28),
  range('eyeBulge', 'eyes', 'bulge', 0, 1, 0.5),
  range('pupilSize', 'eyes', 'pupil', 0.12, 0.95, 0.42),
  range('eyeTilt', 'eyes', 'tilt', -0.6, 0.6, 0),
  range('eyeLid', 'eyes', 'eyelid', 0, 1, 0, { random: (rng) => (rng() < 0.45 ? 0 : rng() * 0.85) }),
  range('eyeJitter', 'eyes', 'size jitter', 0, 1, 0, { random: (rng) => rng() * 0.8 }),
  color('eyeColor', 'eyes', 'sclera', EYE_COLORS, '#fdf6e3'),
  color('pupilColor', 'eyes', 'pupil hue', PUPIL_COLORS, '#0d0a12'),

  // --- MAW ---------------------------------------------------------------
  range('mouthY', 'mouth', 'height', -0.85, 0.15, -0.42),
  range('mouthWidth', 'mouth', 'width', 0.08, 0.85, 0.4, { random: (rng) => 0.22 + rng() * 0.55 }),
  range('mouthOpen', 'mouth', 'opening', 0.02, 0.6, 0.18, { random: (rng) => 0.08 + rng() * 0.42 }),
  int('teethTop', 'mouth', 'top teeth', 0, 14, 8),
  int('teethBottom', 'mouth', 'bottom teeth', 0, 14, 6),
  range('toothSize', 'mouth', 'tooth length', 0.2, 1.4, 0.7),
  range('toothJag', 'mouth', 'fanginess', 0, 1, 0.35),
  range('toothGap', 'mouth', 'gaps', 0, 0.6, 0.1),
  range('lips', 'mouth', 'lips', 0, 0.5, 0.16),
  color('lipColor', 'mouth', 'lip color', LIP_COLORS, '#7a2036'),

  // --- NOSE & BROW -------------------------------------------------------
  select('noseType', 'nose', 'nose', [
    { value: 'none', label: 'none' },
    { value: 'bump', label: 'bump' },
    { value: 'beak', label: 'beak' },
    { value: 'snout', label: 'snout' },
    { value: 'holes', label: 'nostrils' },
  ], 'bump'),
  range('noseSize', 'nose', 'nose size', 0.04, 0.35, 0.13),
  range('noseY', 'nose', 'nose height', -0.4, 0.45, -0.05),
  range('brow', 'nose', 'brow ridge', 0, 1, 0.35),
  range('browDroop', 'nose', 'brow droop', 0, 1, 0.3),

  // --- GROWTHS -----------------------------------------------------------
  int('warts', 'growths', 'warts', 0, 40, 0, { random: (rng) => weighted(rng, [[0, 4], [6, 3], [14, 2], [28, 1]]) }),
  range('wartSize', 'growths', 'wart size', 0.02, 0.16, 0.06),
  int('horns', 'growths', 'horns', 0, 8, 0, { random: (rng) => weighted(rng, [[0, 5], [2, 3], [4, 2], [6, 1]]) }),
  range('hornLen', 'growths', 'horn length', 0.1, 0.9, 0.35),
  // `tendrils` / `tendrilLen` keep their keys — renaming them would break every
  // link shared so far — but they now mean "how much hair" of whatever kind.
  select('hairType', 'growths', 'hair', [
    { value: 'none', label: 'none' },
    { value: 'tendrils', label: 'tendrils' },
    { value: 'bristles', label: 'bristles' },
    { value: 'antennae', label: 'antennae' },
    { value: 'dreads', label: 'dreads' },
    { value: 'crest', label: 'crest' },
  ], 'tendrils', {
    random: (rng) => weighted(rng, [['none', 3], ['tendrils', 3], ['bristles', 3], ['antennae', 2], ['dreads', 2], ['crest', 2]]),
  }),
  int('tendrils', 'growths', 'hair count', 0, 14, 0, { random: (rng) => weighted(rng, [[0, 3], [4, 3], [8, 3], [14, 2]]) }),
  range('tendrilLen', 'growths', 'hair length', 0.15, 1.2, 0.45),
  int('spores', 'growths', 'spore cloud', 0, 220, 0, { random: (rng) => weighted(rng, [[0, 6], [60, 2], [140, 1], [220, 1]]) }),

  // --- BODY --------------------------------------------------------------
  range('headRatio', 'body', 'head share', 0.5, 0.88, 0.7),
  range('bodyWidth', 'body', 'body width', 0.3, 1.3, 0.7),
  range('limbThick', 'body', 'limb width', 0.3, 1.4, 0.7),
  select('armType', 'body', 'arms', [
    { value: 'none', label: 'none' },
    { value: 'stub', label: 'stubs' },
    { value: 'stick', label: 'sticks' },
    { value: 'noodle', label: 'noodles' },
    { value: 'mantis', label: 'mantis' },
  ], 'stick', {
    random: (rng) => weighted(rng, [['none', 1], ['stub', 3], ['stick', 4], ['noodle', 3], ['mantis', 3]]),
  }),
  select('handType', 'body', 'hands', [
    { value: 'none', label: 'none' },
    { value: 'ball', label: 'ball' },
    { value: 'claw', label: 'claws' },
    { value: 'pincer', label: 'pincer' },
    { value: 'club', label: 'club' },
  ], 'ball', {
    random: (rng) => weighted(rng, [['none', 1], ['ball', 4], ['claw', 3], ['pincer', 2], ['club', 2]]),
  }),
  range('armLen', 'body', 'arm length', 0.2, 1.5, 1.0),
  range('armLift', 'body', 'arm lift', -1, 1, 0, { random: (rng) => rng() * 2 - 1 }),
  range('asymmetry', 'body', 'lopsidedness', 0, 1, 0, { random: (rng) => (rng() < 0.35 ? 0 : rng() * 0.9) }),
  range('legLen', 'body', 'leg length', 0.2, 1.5, 0.8),
  range('stance', 'body', 'stance', 0, 1, 0.45),

  // --- STYLE -------------------------------------------------------------
  color('skinColor', 'style', 'skin', SKIN_COLORS, '#5aa9e6'),
  range('bodyTint', 'style', 'body shade', 0, 0.7, 0.25),
  range('outline', 'style', 'outline', 0, 0.12, 0.05, { random: (rng) => 0.03 + rng() * 0.05 }),
  int('pixelSize', 'style', 'pixel size', 1, 8, 4, { random: () => 4 }),
  int('toonSteps', 'style', 'tone steps', 2, 5, 3, { random: () => 3 }),
  color('bgColor', 'style', 'background', BG_COLORS, '#0b0a10', { random: () => '#0b0a10' }),
];

export const PARAM_BY_KEY = Object.fromEntries(PARAMS.map((p) => [p.key, p]));

export const DEFAULTS = Object.freeze({
  seed: 1337,
  ...Object.fromEntries(PARAMS.map((p) => [p.key, p.def])),
});

const clampNum = (p, v) => Math.min(p.max, Math.max(p.min, v));

/** Coerces an arbitrary object into a valid parameter set. */
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

/** A whole random creature from a seed. One seed = the same freak every time. */
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

  // A couple of nudges that keep a random freak a readable character instead
  // of a cloud of geometry: teeth have to fit the maw, the pupil the eye.
  const teethRoom = Math.round(4 + out.mouthWidth * 18);
  out.teethTop = Math.min(out.teethTop, teethRoom);
  out.teethBottom = Math.min(out.teethBottom, teethRoom);
  out.eyeSize = Math.min(out.eyeSize, 0.1 + 0.5 / Math.max(1, out.eyeCount));

  return sanitize(out);
}

export function randomSeed() {
  return Math.floor(Math.random() * 0xffffff);
}
