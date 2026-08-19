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
// What each kind of part is worth. Read them through `from`, never directly:
// a kind added to the schema but forgotten here used to come back `undefined`,
// which turned the whole stat block into NaN and emptied the panel.
const from = (table, key) => table[key] ?? 0;

const HAND_BITE = {
  none: -0.06, ball: 0, claw: 0.12, pincer: 0.14, club: 0.06,
  fist: 0.07, spikes: 0.12, hook: 0.13, fingers: 0.02,
};
const EYE_SIGHT = {
  ball: 0, hole: -0.08, bead: -0.04, stalk: 0.1,
  compound: 0.14, lantern: 0.02, gash: -0.1,
};
const HAIR_DREAD = {
  none: -0.04, tendrils: 0.04, bristles: 0.08, antennae: 0.02, dreads: 0.06,
  crest: 0.1, fur: -0.02, quills: 0.09, fronds: 0.03,
};
const TOOTH_BITE = { fangs: 0, needles: 0.06, blocks: -0.04, tusks: 0.1 };
const NOSE_DREAD = { none: 0, bump: 0, beak: 0.03, snout: 0.02, holes: 0.01, trunk: 0.04, tusks: 0.09, pig: 0 };
// no hearing stat, so ears count towards the sense the creature does have
const EAR_SIGHT = { none: 0, flaps: 0.07, fins: 0.05, trumpets: 0.1, holes: 0.03 };

const LEG_SPEED = { stick: 0.06, thick: -0.04, bent: 0.12, stump: -0.12, frog: 0.1, peg: -0.06 };
const LEG_BALANCE = { stick: -0.04, thick: 0.08, bent: -0.02, stump: 0.12, frog: 0.05, peg: -0.1 };
const FOOT_BALANCE = { ball: 0, none: -0.1, splay: 0.12, hoof: -0.02, claws: 0.06, boot: 0.1 };
const FOOT_SPEED = { ball: 0, none: 0.04, splay: -0.05, hoof: 0.08, claws: 0.05, boot: -0.06 };

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

/** How many parts of one kind the player placed by hand (EDIT mode). */
const placedCount = (p, kind) => {
  let n = 0;
  for (const it of p.placed || []) if (it.k === kind) n++;
  return n;
};

/** True when the creature has any arm at all — grown or planted. */
const hasArms = (p) => p.armType !== 'none' || placedCount(p, 'arm') > 0;

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
  { id: 'manyEyed', label: 'MANY-EYED', when: (p) => p.eyeCount + placedCount(p, 'eye') >= 5, mods: { sight: 10, dread: 4 } },
  { id: 'blind', label: 'BLIND', when: (p) => p.eyeCount + placedCount(p, 'eye') === 0, mods: { sight: -28, dread: 6 } },
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
  { id: 'horned', label: 'HORNED', when: (p) => p.horns + placedCount(p, 'horn') >= 2, mods: { dread: 10, vigor: 4 } },
  { id: 'tendrilled', label: 'TENDRILLED', when: (p) => p.tendrils >= 6, mods: { sight: 6, speed: -4 } },
  { id: 'sporebearer', label: 'SPOREBEARER', when: (p) => p.spores >= 80, mods: { dread: 8, speed: -6 } },
  { id: 'warty', label: 'WARTY', when: (p) => p.warts + placedCount(p, 'wart') * 2 >= 14, mods: { vigor: 8, speed: -4 } },
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
    when: (p) => hasArms(p) && (p.handType === 'claw' || p.handType === 'pincer'),
    mods: { bite: 8, dread: 5 },
  },
  {
    id: 'armless',
    label: 'ARMLESS',
    when: (p) => !hasArms(p),
    mods: { speed: 6, vigor: -8, bite: -4 },
  },
  { id: 'stalkEyed', label: 'STALK-EYED', when: (p) => p.eyeStyle === 'stalk' && p.eyeCount + placedCount(p, 'eye') > 0, mods: { sight: 12, vigor: -5 } },
  { id: 'crested', label: 'CRESTED', when: (p) => p.hairType === 'crest', mods: { dread: 9, balance: -3 } },
  { id: 'bristled', label: 'BRISTLED', when: (p) => p.hairType === 'bristles' && p.tendrils >= 6, mods: { dread: 6, vigor: 3 } },
  { id: 'pinEyed', label: 'PIN-EYED', when: (p) => p.pupilShape === 'blind', mods: { sight: -14, dread: 8 } },
  { id: 'compound', label: 'COMPOUND-EYED', when: (p) => p.eyeStyle === 'compound' && p.eyeCount + placedCount(p, 'eye') > 0, mods: { sight: 14, dread: 5, balance: -4 } },
  { id: 'lantern', label: 'LANTERN-EYED', when: (p) => p.eyeStyle === 'lantern' && p.eyeCount + placedCount(p, 'eye') > 0, mods: { sight: 8, dread: 7 } },
  { id: 'tusked', label: 'TUSKED', when: (p) => p.toothType === 'tusks' && p.teethTop + p.teethBottom >= 4, mods: { bite: 12, dread: 6, speed: -4 } },
  { id: 'needled', label: 'NEEDLE-TOOTHED', when: (p) => p.toothType === 'needles' && p.teethTop + p.teethBottom >= 10, mods: { bite: 9, dread: 5 } },
  { id: 'eared', label: 'BIG-EARED', when: (p) => p.earType !== 'none' && p.earType !== 'holes' && p.earSize > 0.35, mods: { sight: 10, dread: -4 } },
  { id: 'furred', label: 'FURRED', when: (p) => p.hairType === 'fur' && p.tendrils >= 4, mods: { vigor: 6, speed: -3 } },
  { id: 'quilled', label: 'QUILLED', when: (p) => p.hairType === 'quills' && p.tendrils >= 5, mods: { dread: 10, vigor: 3 } },
  { id: 'trunked', label: 'TRUNKED', when: (p) => p.noseType === 'trunk', mods: { sight: 6, dread: 4, speed: -3 } },
  { id: 'stumpy', label: 'STUMPY', when: (p) => p.legType === 'stump', mods: { balance: 12, vigor: 5, speed: -10 } },
  { id: 'springy', label: 'SPRING-LEGGED', when: (p) => p.legType === 'bent', mods: { speed: 11, balance: -5 } },
  { id: 'footless', label: 'FOOTLESS', when: (p) => p.footType === 'none', mods: { balance: -12, speed: 5 } },
  { id: 'broadfoot', label: 'BROAD-FOOTED', when: (p) => p.footType === 'splay', mods: { balance: 11, speed: -4 } },
  { id: 'paunched', label: 'PAUNCHED', when: (p) => p.belly > 0.6, mods: { vigor: 8, speed: -6 } },
  { id: 'broadChest', label: 'BROAD-CHESTED', when: (p) => p.chestWide > 0.4, mods: { vigor: 9, balance: -3 } },
  { id: 'wasp', label: 'WASP-WAISTED', when: (p) => p.waistWide < -0.3, mods: { speed: 8, vigor: -5 } },
  { id: 'hooded', label: 'HOODED', when: (p) => p.eyeLid >= 0.6, mods: { dread: 6, sight: -6 } },
  { id: 'winged', label: 'WINGED', when: (p) => p.armType === 'wing', mods: { speed: 8, vigor: -4, dread: 3 } },
  { id: 'tentacled2', label: 'TENTACLE-ARMED', when: (p) => p.armType === 'tentacle', mods: { dread: 6, bite: 3, balance: -4 } },
  { id: 'branched', label: 'BRANCH-LIMBED', when: (p) => p.armType === 'branch', mods: { dread: 5, vigor: 3, speed: -3 } },
  { id: 'hookHanded', label: 'HOOK-HANDED', when: (p) => p.handType === 'hook' && hasArms(p), mods: { bite: 7, dread: 4 } },
  { id: 'maceFisted', label: 'MACE-FISTED', when: (p) => p.handType === 'spikes' && hasArms(p), mods: { bite: 8, vigor: 3, speed: -3 } },
  { id: 'leaper', label: 'LEAPER', when: (p) => p.legType === 'frog', mods: { speed: 9, balance: -4 } },
  { id: 'pegLegged', label: 'PEG-LEGGED', when: (p) => p.legType === 'peg', mods: { dread: 4, balance: -8, speed: -3 } },
  { id: 'taloned', label: 'TALONED', when: (p) => p.footType === 'claws', mods: { dread: 5, bite: 4 } },
  {
    id: 'manyArmed',
    label: 'MANY-ARMED',
    when: (p) => (p.armType === 'none' ? 0 : 2) + placedCount(p, 'arm') >= 4,
    mods: { vigor: 6, dread: 4, balance: -4 },
  },
];

/**
 * params -> { values, traits, power }.
 * `values` are 1..99 per stat, `traits` carry their own modifiers, `power` is
 * the flat average — a single number for future matchmaking.
 */
export function computeStats(p) {
  const mass = norm(p.headWidth * p.headHeight * p.headDepth, 0.2, 3.0);
  const teeth = norm(p.teethTop + p.teethBottom, 0, 28);
  // hand-placed parts count: an extra eye sees, an extra horn scares
  const eyes = norm(p.eyeCount + placedCount(p, 'eye'), 0, 8);
  const horns = norm(p.horns + placedCount(p, 'horn'), 0, 8);
  const warts = norm(p.warts + placedCount(p, 'wart') * 2, 0, 40);
  const dark = 1 - luminance(p.skinColor);

  // Base stats in 0..1, before traits.
  const base = {
    vigor:
      0.42 * mass +
      0.24 * nk(p, 'bodyWidth') +
      0.14 * nk(p, 'boxiness') +
      0.12 * warts +
      0.08 * nk(p, 'jaw') +
      0.1 * nk(p, 'belly') +
      0.08 * Math.max(0, p.chestWide),
    bite:
      (0.4 * teeth + 0.24 * nk(p, 'toothSize') + 0.22 * nk(p, 'mouthWidth') + 0.14 * nk(p, 'toothJag')) *
      (p.teethTop + p.teethBottom > 0 ? 1 : 0.3) +
      from(HAND_BITE, p.handType) * (hasArms(p) ? 1 : 0) +
      from(TOOTH_BITE, p.toothType) * (p.teethTop + p.teethBottom > 0 ? 1 : 0),
    speed:
      0.44 * nk(p, 'legLen') +
      0.22 * (1 - mass) +
      0.18 * (1 - nk(p, 'headRatio')) +
      0.16 * (1 - nk(p, 'bodyWidth')) +
      from(LEG_SPEED, p.legType) +
      from(FOOT_SPEED, p.footType),
    sight:
      0.4 * eyes +
      0.24 * nk(p, 'eyeSize') +
      0.2 * nk(p, 'eyeBulge') +
      0.16 * nk(p, 'eyeSpread') -
      0.12 * nk(p, 'eyeLid') +
      from(EYE_SIGHT, p.eyeStyle) +
      from(EAR_SIGHT, p.earType) * (0.5 + nk(p, 'earSize') * 0.8) +
      0.04 * placedCount(p, 'ear'),
    dread:
      0.24 * teeth +
      0.2 * horns +
      0.14 * nk(p, 'tendrils') +
      0.14 * nk(p, 'spores') +
      0.14 * nk(p, 'lumps') +
      0.14 * dark +
      from(HAIR_DREAD, p.hairType) +
      from(NOSE_DREAD, p.noseType) +
      0.03 * placedCount(p, 'hair') +
      0.02 * placedCount(p, 'nose') +
      0.1 * nk(p, 'bodyLumps') +
      0.06 * nk(p, 'bodyBox'),
    balance:
      0.34 * nk(p, 'stance') +
      0.3 * (1 - nk(p, 'headRatio')) +
      0.2 * (1 - nk(p, 'legLen')) +
      0.16 * nk(p, 'bodyWidth') +
      from(LEG_BALANCE, p.legType) +
      from(FOOT_BALANCE, p.footType),
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
