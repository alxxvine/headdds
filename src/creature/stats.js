// Stats are a pure function of the parameters: the same creature always rolls
// the same numbers, on any machine, without touching the mesh. Gameplay can
// call computeStats(params) on a saved creature and never load three.js.
//
// The design goal is trade-offs, not a score. A boulder of a skull buys VIGOR
// and pays for it in SPEED and BALANCE; stilt legs do the opposite. Every
// slider should move at least one stat, and the loud ones (horns, spores,
// a maw full of fangs) also grant a trait with its own modifiers.

import { PARAM_BY_KEY } from './schema.js';

export const STATS = [
  { key: 'vigor', label: 'VIGOR', hint: 'mass, armour, how much punishment it soaks' },
  { key: 'bite', label: 'BITE', hint: 'teeth and maw — raw damage' },
  { key: 'speed', label: 'SPEED', hint: 'legs versus the weight of the head' },
  { key: 'sight', label: 'SIGHT', hint: 'eyes: count, size, how far they see' },
  { key: 'dread', label: 'DREAD', hint: 'horns, spores, fangs — how badly it scares' },
  { key: 'balance', label: 'BALANCE', hint: 'stance versus a top-heavy skull' },
];

export const STAT_KEYS = STATS.map((s) => s.key);

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const clampStat = (v) => Math.min(99, Math.max(1, Math.round(v)));

/** Normalizes a parameter to 0..1 using the range declared in the schema. */
function nk(p, key) {
  const def = PARAM_BY_KEY[key];
  if (!def || def.min === undefined) return 0;
  return clamp01((p[key] - def.min) / (def.max - def.min));
}

const norm = (v, a, b) => clamp01((v - a) / (b - a));

/** Rough perceived brightness of a #rrggbb colour, 0..1. */
function luminance(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return 0.5;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Traits are the loud features. Each one is a readable label plus the flat
// modifiers it applies on top of the base stats — that is where "this
// particular growth does something" lives.
export const TRAITS = [
  { id: 'manyEyed', label: 'MANY-EYED', when: (p) => p.eyeCount >= 5, mods: { sight: 10, dread: 4 } },
  { id: 'blind', label: 'BLIND', when: (p) => p.eyeCount === 0, mods: { sight: -28, dread: 6 } },
  { id: 'gapingMaw', label: 'GAPING MAW', when: (p) => p.mouthWidth >= 0.62, mods: { bite: 8, vigor: -4 } },
  {
    id: 'fanged',
    label: 'FANGED',
    when: (p) => p.toothJag >= 0.7 && p.teethTop + p.teethBottom >= 8,
    mods: { bite: 10, dread: 6 },
  },
  {
    id: 'toothless',
    label: 'TOOTHLESS',
    when: (p) => p.teethTop + p.teethBottom === 0,
    mods: { bite: -22, dread: -8 },
  },
  { id: 'horned', label: 'HORNED', when: (p) => p.horns >= 2, mods: { dread: 10, vigor: 4 } },
  { id: 'tendrilled', label: 'TENDRILLED', when: (p) => p.tendrils >= 6, mods: { sight: 6, speed: -4 } },
  { id: 'sporebearer', label: 'SPOREBEARER', when: (p) => p.spores >= 80, mods: { dread: 8, speed: -6 } },
  { id: 'warty', label: 'WARTY', when: (p) => p.warts >= 14, mods: { vigor: 8, speed: -4 } },
  { id: 'boulder', label: 'BOULDER', when: (p) => p.boxiness >= 0.7, mods: { vigor: 10, speed: -8, balance: 5 } },
  {
    id: 'topHeavy',
    label: 'TOP-HEAVY',
    when: (p) => p.headRatio >= 0.8,
    mods: { vigor: 6, balance: -12, speed: -5 },
  },
  { id: 'stiltLegged', label: 'STILT-LEGGED', when: (p) => p.legLen >= 1.15, mods: { speed: 10, balance: -8 } },
  { id: 'squat', label: 'SQUAT', when: (p) => p.legLen <= 0.5, mods: { speed: -8, balance: 8 } },
  {
    id: 'lopsided',
    label: 'LOPSIDED',
    when: (p) => Math.abs(p.eyeTilt) >= 0.4 || p.eyeLayout === 'scatter',
    mods: { dread: 5, balance: -5 },
  },
  { id: 'lumpen', label: 'LUMPEN', when: (p) => p.lumps >= 0.24, mods: { vigor: 5, dread: 4, sight: -3 } },
];

/**
 * params -> { values, traits, power }.
 * `values` are 1..99 per stat, `traits` carry their own modifiers, `power` is
 * the flat average — a single number for future matchmaking.
 */
export function computeStats(p) {
  const mass = norm(p.headWidth * p.headHeight * p.headDepth, 0.2, 3.0);
  const teeth = norm(p.teethTop + p.teethBottom, 0, 28);
  const eyes = norm(p.eyeCount, 0, 8);
  const dark = 1 - luminance(p.skinColor);

  // Base stats in 0..1, before traits.
  const base = {
    vigor:
      0.42 * mass +
      0.24 * nk(p, 'bodyWidth') +
      0.14 * nk(p, 'boxiness') +
      0.12 * nk(p, 'warts') +
      0.08 * nk(p, 'jaw'),
    bite:
      (0.4 * teeth + 0.24 * nk(p, 'toothSize') + 0.22 * nk(p, 'mouthWidth') + 0.14 * nk(p, 'toothJag')) *
      (p.teethTop + p.teethBottom > 0 ? 1 : 0.3),
    speed:
      0.44 * nk(p, 'legLen') +
      0.22 * (1 - mass) +
      0.18 * (1 - nk(p, 'headRatio')) +
      0.16 * (1 - nk(p, 'bodyWidth')),
    sight:
      0.4 * eyes +
      0.24 * nk(p, 'eyeSize') +
      0.2 * nk(p, 'eyeBulge') +
      0.16 * nk(p, 'eyeSpread') -
      (p.eyeStyle === 'hole' ? 0.08 : p.eyeStyle === 'bead' ? 0.04 : 0),
    dread:
      0.24 * teeth +
      0.2 * nk(p, 'horns') +
      0.14 * nk(p, 'tendrils') +
      0.14 * nk(p, 'spores') +
      0.14 * nk(p, 'lumps') +
      0.14 * dark,
    balance:
      0.34 * nk(p, 'stance') +
      0.3 * (1 - nk(p, 'headRatio')) +
      0.2 * (1 - nk(p, 'legLen')) +
      0.16 * nk(p, 'bodyWidth'),
  };

  const traits = TRAITS.filter((t) => t.when(p));

  const values = {};
  for (const { key } of STATS) {
    let v = 6 + clamp01(base[key]) * 88;
    for (const t of traits) v += t.mods[key] || 0;
    values[key] = clampStat(v);
  }

  const power = Math.round(STAT_KEYS.reduce((s, k) => s + values[k], 0) / STAT_KEYS.length);
  return { values, traits, power };
}

/** "sight +10, dread +4" — for trait tooltips. */
export function describeMods(mods) {
  return Object.entries(mods)
    .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`)
    .join(', ');
}
