// Stats are a pure function of the parameters: the same creature always rolls
// the same numbers, on any machine, without touching the mesh. Gameplay can
// call computeStats(params) on a saved creature and never load three.js.
//
// The design goal is trade-offs, not a score. Every creature spends the same
// budget of points (BUDGET below), so pushing one stat up always pushes the
// others down and no anatomy can produce a strictly better freak. A boulder of
// a skull buys VIGOR and pays for it in SPEED and BALANCE; stilt legs do the
// opposite. The loud features (horns, spores, a maw full of fangs) grant traits
// whose modifiers shift points between stats rather than adding to the pool.

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

// Every creature spends the same pool of points, so a build is about *where*
// the points go, never about how many you managed to collect. Raising one stat
// necessarily lowers the others.
export const BUDGET = 300; // 6 stats, so an even creature sits at 50 each
export const STAT_MIN = 5;
export const STAT_MAX = 95;

/** The name of the stat a creature leans into — flavour for future gameplay. */
export const ARCHETYPES = {
  vigor: 'BRUTE',
  bite: 'DEVOURER',
  speed: 'SKITTERER',
  sight: 'WATCHER',
  dread: 'HORROR',
  balance: 'PILLAR',
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// How the newer part types tilt the raw stats before the budget is applied.
const HAND_BITE = { none: -0.06, ball: 0, claw: 0.12, pincer: 0.14, club: 0.06 };
const EYE_SIGHT = { ball: 0, hole: -0.08, bead: -0.04, stalk: 0.1 };
const HAIR_DREAD = { none: -0.04, tendrils: 0.04, bristles: 0.08, antennae: 0.02, dreads: 0.06, crest: 0.1 };

/**
 * Scales raw stats so they sum to exactly BUDGET while every value stays in
 * [STAT_MIN, STAT_MAX]. Clamping steals points from the pool, so the leftover
 * is redistributed over the stats that still have headroom (water filling),
 * and the final rounding uses largest remainders to land on the budget exactly.
 */
function fitBudget(raw) {
  const keys = Object.keys(raw);
  const total = keys.reduce((s, k) => s + raw[k], 0) || 1;
  const v = {};
  for (const k of keys) v[k] = (raw[k] / total) * BUDGET;

  for (let pass = 0; pass < 16; pass++) {
    let sum = 0;
    for (const k of keys) {
      v[k] = Math.min(STAT_MAX, Math.max(STAT_MIN, v[k]));
      sum += v[k];
    }
    const deficit = BUDGET - sum;
    if (Math.abs(deficit) < 1e-6) break;

    // headroom in the direction we need to move
    const free = keys.filter((k) => (deficit > 0 ? v[k] < STAT_MAX : v[k] > STAT_MIN));
    if (!free.length) break;
    const room = free.reduce((s, k) => s + (deficit > 0 ? STAT_MAX - v[k] : v[k] - STAT_MIN), 0) || 1;
    for (const k of free) {
      const share = (deficit > 0 ? STAT_MAX - v[k] : v[k] - STAT_MIN) / room;
      v[k] += deficit * share;
    }
  }

  // integer values that still add up to BUDGET
  const out = {};
  let spent = 0;
  for (const k of keys) {
    out[k] = Math.floor(v[k]);
    spent += out[k];
  }
  const order = keys
    .map((k) => ({ k, frac: v[k] - Math.floor(v[k]) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; spent < BUDGET && i < order.length * 2; i++) {
    const k = order[i % order.length].k;
    if (out[k] < STAT_MAX) { out[k] += 1; spent += 1; }
  }
  return out;
}

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
  {
    id: 'clawed',
    label: 'CLAWED',
    when: (p) => p.armType !== 'none' && (p.handType === 'claw' || p.handType === 'pincer'),
    mods: { bite: 8, dread: 5 },
  },
  {
    id: 'armless',
    label: 'ARMLESS',
    when: (p) => p.armType === 'none',
    mods: { speed: 6, vigor: -8, bite: -4 },
  },
  { id: 'stalkEyed', label: 'STALK-EYED', when: (p) => p.eyeStyle === 'stalk' && p.eyeCount > 0, mods: { sight: 12, vigor: -5 } },
  { id: 'crested', label: 'CRESTED', when: (p) => p.hairType === 'crest', mods: { dread: 9, balance: -3 } },
  { id: 'bristled', label: 'BRISTLED', when: (p) => p.hairType === 'bristles' && p.tendrils >= 6, mods: { dread: 6, vigor: 3 } },
  { id: 'pinEyed', label: 'PIN-EYED', when: (p) => p.pupilShape === 'blind', mods: { sight: -14, dread: 8 } },
  { id: 'hooded', label: 'HOODED', when: (p) => p.eyeLid >= 0.6, mods: { dread: 6, sight: -6 } },
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
      (p.teethTop + p.teethBottom > 0 ? 1 : 0.3) +
      HAND_BITE[p.handType] * (p.armType === 'none' ? 0 : 1),
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
      0.12 * nk(p, 'eyeLid') +
      EYE_SIGHT[p.eyeStyle],
    dread:
      0.24 * teeth +
      0.2 * nk(p, 'horns') +
      0.14 * nk(p, 'tendrils') +
      0.14 * nk(p, 'spores') +
      0.14 * nk(p, 'lumps') +
      0.14 * dark +
      HAIR_DREAD[p.hairType],
    balance:
      0.34 * nk(p, 'stance') +
      0.3 * (1 - nk(p, 'headRatio')) +
      0.2 * (1 - nk(p, 'legLen')) +
      0.16 * nk(p, 'bodyWidth'),
  };

  const traits = TRAITS.filter((t) => t.when(p));

  const raw = {};
  for (const { key } of STATS) {
    let v = 6 + clamp01(base[key]) * 88;
    for (const t of traits) v += t.mods[key] || 0;
    raw[key] = Math.max(1, v);
  }

  const values = fitBudget(raw);
  const list = STAT_KEYS.map((k) => values[k]);
  const spread = (Math.max(...list) - Math.min(...list)) / (STAT_MAX - STAT_MIN);
  const archetype = ARCHETYPES[STAT_KEYS.reduce((a, b) => (values[b] > values[a] ? b : a))];

  return { values, raw, traits, budget: BUDGET, spread, archetype };
}

/** "sight +10, dread +4" — for trait tooltips. */
export function describeMods(mods) {
  return Object.entries(mods)
    .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`)
    .join(', ');
}
