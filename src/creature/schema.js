// The single source of truth about a creature.
// Defaults, the UI panel, the randomizer and link validation are all derived
// from this schema. Adding a new parameter = adding one line here.

import { makeRng } from '../lib/noise.js';

export const SKIN_COLORS = [
  // Twelve colours meant a dozen creatures in a row could share a skin and read
  // as a set rather than as strangers. Thirty-four, spread over the whole wheel
  // and over three levels of brightness, so a random pair rarely matches — and
  // every one still sits in the same sour, unhealthy register the toon ramp was
  // built for. Nothing clean, nothing pastel-pretty, nothing pure grey.
  '#5aa9e6', // acid blue
  '#2f7fbf', // deeper acid blue
  '#8fd4f5', // sickly sky
  '#f3e0b5', // cream
  '#d8b98a', // old paper
  '#e8642c', // orange
  '#ff8f3c', // hot orange
  '#b34a17', // rust
  '#8ec63f', // toxic green
  '#4f9330', // moss
  '#c8e04a', // bile
  '#b9a3e3', // lavender
  '#8b6fd0', // violet
  '#c0392b', // blood red
  '#8c1f1a', // dried blood
  '#f0564a', // raw
  '#f28fb2', // pink
  '#d4577f', // gum
  '#7ecbc4', // teal
  '#3f9a92', // deep teal
  '#a8e6cf', // mint rot
  '#cfc3a4', // bone
  '#9a9376', // grey bone
  '#6b4f9e', // purple
  '#452f6d', // bruise
  '#3f5d76', // murky blue
  '#26404f', // deep murk
  '#9c6b4f', // meat
  '#6e4433', // liver
  '#d9c24a', // jaundice
  '#a6b31f', // pond
  '#e0d5c8', // ash
  '#5c6b3f', // swamp
  '#c97b2e', // amber grub
];

// A sclera can be anything from a boiled egg to a lit lantern to a hole full of
// ink. The randomizer picks whichever end stands apart from the skin.
export const EYE_COLORS = [
  '#fdf6e3', '#ffffff', '#f5e050', '#ffb03b', '#e94f37', '#ff6f9c',
  '#9ef0a0', '#5ee0c8', '#8fd4f5', '#d8c7ef', '#c9a0ff', '#f0c9a0',
  '#1a1420', '#2a1a2e', '#0f1d24', '#3c1d1d',
];

// Mostly dark, but not only: against a black sclera a black pupil is no pupil,
// and the randomizer picks whichever end contrasts — with the eye AND with the
// skin, since half the eye kinds show no sclera at all.
export const PUPIL_COLORS = [
  '#0d0a12', '#2b0f1a', '#3a0d0d', '#0a2a1a', '#5a1020',
  '#101820', '#1c0f26', '#241a08', '#06110d', '#2e2416',
  '#f6f0dc', '#f5e050', '#e94f37', '#7ef0ff', '#b6ff5a',
];

export const LIP_COLORS = [
  '#7a2036', '#3a1020', '#c04a5f', '#1a0d14', '#8f3f1f', '#2d5a3a',
  '#5c1f4a', '#a8324e', '#20303a', '#6b4a12', '#3d2a5c', '#912d2d',
  '#c96a3a', '#40603a', '#7d5a86', '#12191f',
];

export const BG_COLORS = [
  '#07060b', '#0b0a10', '#120b16', '#0a1014', '#161016',
  '#0d0f08', '#100a0a', '#080d12', '#141018', '#0a0c0c',
];
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

// perceived brightness of a #rrggbb string, 0..1
const luma = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) / 255;
};

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
  // The skull used to be one shape all the way up — a cone, a ball or a box.
  // These three widen or pinch it at brow, eye and jaw height independently,
  // which is what makes a silhouette instead of a solid.
  // No `random` on any of the six width bands, here or on the torso: the
  // default roll already spans the whole declared range in one draw. Writing a
  // second one by hand is how all six ended up drawing (rng*2-1)*0.6 against a
  // range of [-0.5, 0.7] — sanitize clamps what overshoots, so 7.5% of every
  // population sat on exactly the narrowest setting while the top tenth of the
  // slider was never generated at all.
  range('browWide', 'head', 'brow width', -0.5, 0.7, 0),
  range('midWide', 'head', 'temple width', -0.5, 0.7, 0),
  range('chinWide', 'head', 'jaw width', -0.5, 0.7, 0),
  range('lumps', 'head', 'lumps', 0, 0.35, 0.08),
  // a freak is rarely symmetric and rarely undamaged
  range('lopsided', 'head', 'lopsidedness', 0, 1, 0, { random: (rng) => (rng() < 0.3 ? 0 : rng() * 0.9) }),
  range('wear', 'head', 'wear', 0, 1, 0, { random: (rng) => (rng() < 0.35 ? 0 : rng() * 0.9) }),
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
    { value: 'compound', label: 'compound' },
    { value: 'lantern', label: 'lantern' },
    { value: 'gash', label: 'gash' },
    { value: 'pit', label: 'pit' },
    { value: 'bulb', label: 'bulb' },
    { value: 'cluster', label: 'cluster' },
    { value: 'visor', label: 'visor' },
    { value: 'crystal', label: 'crystal' },
    { value: 'ring', label: 'ring' },
    { value: 'bloom', label: 'bloom' },
    { value: 'button', label: 'button' },
    { value: 'slot', label: 'slot' },
    { value: 'dome', label: 'dome' },
  ], 'ball', {
    random: (rng) => weighted(rng, [
      ['ball', 5], ['hole', 3], ['bead', 3], ['stalk', 2],
      ['compound', 3], ['lantern', 2], ['gash', 2],
      ['pit', 3], ['bulb', 3], ['cluster', 2], ['visor', 2],
      ['crystal', 3], ['ring', 2], ['bloom', 2], ['button', 2], ['slot', 2], ['dome', 3],
    ]),
  }),
  select('pupilShape', 'eyes', 'pupil shape', [
    { value: 'round', label: 'round' },
    { value: 'slit', label: 'slit' },
    { value: 'goat', label: 'goat' },
    { value: 'cross', label: 'cross' },
    { value: 'ring', label: 'ring' },
    { value: 'square', label: 'square' },
    { value: 'double', label: 'double' },
    { value: 'blind', label: 'blind' },
  ], 'round', {
    random: (rng) => weighted(rng, [
      ['round', 5], ['slit', 3], ['goat', 2], ['cross', 2],
      ['ring', 2], ['square', 2], ['double', 2], ['blind', 1],
    ]),
  }),
  range('eyeSize', 'eyes', 'size', 0.05, 0.4, 0.16),
  range('eyeSpread', 'eyes', 'spread', 0.1, 1.0, 0.42),
  range('eyeY', 'eyes', 'height', -0.4, 0.8, 0.28),
  // Most eyes are not golf balls stuck on a face: bias the roll towards flat
  // and sunken, and leave the popping ones as the loud end.
  range('eyeBulge', 'eyes', 'bulge', 0, 1, 0.5, {
    random: (rng) => weighted(rng, [[0.08, 3], [0.3, 4], [0.55, 3], [0.85, 2]]) + rng() * 0.12,
  }),
  range('pupilSize', 'eyes', 'pupil', 0.12, 0.95, 0.42),
  range('eyeTilt', 'eyes', 'tilt', -0.6, 0.6, 0),
  range('eyeLid', 'eyes', 'eyelid', 0, 1, 0, { random: (rng) => (rng() < 0.45 ? 0 : rng() * 0.85) }),
  // one slider for all the ways two eyes on one face refuse to match
  range('eyeJitter', 'eyes', 'eye mismatch', 0, 1, 0, { random: (rng) => rng() * 0.9 }),
  color('eyeColor', 'eyes', 'sclera', EYE_COLORS, '#fdf6e3'),
  color('pupilColor', 'eyes', 'pupil hue', PUPIL_COLORS, '#0d0a12'),

  // --- MAW ---------------------------------------------------------------
  range('mouthY', 'mouth', 'height', -0.85, 0.15, -0.42),
  range('mouthWidth', 'mouth', 'width', 0.08, 0.85, 0.4, { random: (rng) => 0.22 + rng() * 0.55 }),
  range('mouthOpen', 'mouth', 'opening', 0.02, 0.6, 0.18, { random: (rng) => 0.08 + rng() * 0.42 }),
  int('teethTop', 'mouth', 'top teeth', 0, 14, 8),
  int('teethBottom', 'mouth', 'bottom teeth', 0, 14, 6),
  select('mawShape', 'mouth', 'shape', [
    { value: 'oval', label: 'oval' },
    { value: 'grin', label: 'grin' },
    { value: 'frown', label: 'frown' },
    { value: 'snarl', label: 'snarl' },
    { value: 'slit', label: 'slit' },
    { value: 'zigzag', label: 'zigzag' },
    { value: 'keyhole', label: 'keyhole' },
    { value: 'crescent', label: 'crescent' },
    { value: 'gape', label: 'gape' },
    { value: 'crooked', label: 'crooked' },
    { value: 'beak', label: 'beak' },
  ], 'oval', {
    random: (rng) => weighted(rng, [
      ['oval', 3], ['grin', 3], ['frown', 3], ['snarl', 3], ['slit', 2],
      ['zigzag', 2], ['keyhole', 2], ['crescent', 2], ['gape', 2],
      ['crooked', 2], ['beak', 2],
    ]),
  }),
  select('toothType', 'mouth', 'teeth', [
    { value: 'fangs', label: 'fangs' },
    { value: 'needles', label: 'needles' },
    { value: 'blocks', label: 'blocks' },
    { value: 'tusks', label: 'tusks' },
    { value: 'saw', label: 'saw blades' },
    { value: 'chisels', label: 'chisels' },
    { value: 'pegs', label: 'pegs' },
    { value: 'molars', label: 'molars' },
    { value: 'hooks', label: 'hooks' },
    { value: 'shards', label: 'shards' },
    { value: 'spines', label: 'spines' },
    { value: 'plates', label: 'plates' },
    { value: 'combs', label: 'comb' },
    { value: 'barbs', label: 'barbs' },
  ], 'fangs', {
    random: (rng) => weighted(rng, [
      ['fangs', 4], ['needles', 3], ['blocks', 3], ['tusks', 2],
      ['saw', 3], ['chisels', 2], ['pegs', 2], ['molars', 2], ['hooks', 2],
      ['shards', 2], ['spines', 2], ['plates', 2], ['combs', 2], ['barbs', 2],
    ]),
  }),
  range('toothSize', 'mouth', 'tooth length', 0.2, 1.4, 0.7, {
    random: (rng) => weighted(rng, [[0.25, 3], [0.5, 4], [0.85, 3], [1.25, 2]]) + rng() * 0.15,
  }),
  // how unlike each other the teeth in one mouth are
  range('toothVary', 'mouth', 'tooth mismatch', 0, 1, 0.25, { random: (rng) => 0.2 + rng() * 0.8 }),
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
    { value: 'trunk', label: 'trunk' },
    { value: 'tusks', label: 'tusks' },
    { value: 'pig', label: 'disc' },
    { value: 'hook', label: 'hook' },
    { value: 'blob', label: 'blob' },
    { value: 'ridge', label: 'ridge' },
    { value: 'slits', label: 'gills' },
    { value: 'button', label: 'button' },
    { value: 'horn', label: 'nose horn' },
    { value: 'star', label: 'rosette' },
    { value: 'plate', label: 'plate' },
    { value: 'double', label: 'twin bumps' },
    { value: 'straw', label: 'straw' },
  ], 'bump', {
    random: (rng) => weighted(rng, [
      ['none', 1], ['bump', 4], ['beak', 3], ['snout', 3],
      ['holes', 2], ['trunk', 2], ['tusks', 2], ['pig', 2],
      ['hook', 3], ['blob', 3], ['ridge', 2], ['slits', 2], ['button', 2],
      ['horn', 2], ['star', 2], ['plate', 2], ['double', 2], ['straw', 2],
    ]),
  }),
  range('noseSize', 'nose', 'nose size', 0.04, 0.35, 0.13, {
    random: (rng) => 0.05 + rng() * rng() * 0.3,   // small most of the time, occasionally a snout
  }),
  range('noseY', 'nose', 'nose height', -0.4, 0.45, -0.05),
  select('earType', 'nose', 'ears', [
    { value: 'none', label: 'none' },
    { value: 'flaps', label: 'flaps' },
    { value: 'fins', label: 'fins' },
    { value: 'trumpets', label: 'trumpets' },
    { value: 'holes', label: 'holes' },
    { value: 'cups', label: 'cups' },
    { value: 'leaf', label: 'leaves' },
    { value: 'bat', label: 'bat' },
    { value: 'droop', label: 'lobes' },
    { value: 'stub', label: 'stubs' },
    { value: 'tube', label: 'tubes' },
    { value: 'frills', label: 'frills' },
    { value: 'spines', label: 'spines' },
    { value: 'curl', label: 'curls' },
    { value: 'fan', label: 'fans' },
  ], 'none', {
    random: (rng) => weighted(rng, [
      ['none', 3], ['flaps', 3], ['fins', 3], ['trumpets', 2], ['holes', 2],
      ['cups', 2], ['leaf', 2], ['bat', 2], ['droop', 2], ['stub', 2],
      ['tube', 2], ['frills', 2], ['spines', 2], ['curl', 2], ['fan', 2],
    ]),
  }),
  range('earSize', 'nose', 'ear size', 0.08, 0.6, 0.25),
  range('earY', 'nose', 'ear height', -0.4, 0.6, 0.15),
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
    { value: 'fur', label: 'fur' },
    { value: 'quills', label: 'quills' },
    { value: 'fronds', label: 'fronds' },
    { value: 'spikes', label: 'spikes' },
    { value: 'barbs', label: 'barbs' },
    { value: 'coral', label: 'coral' },
    { value: 'mane', label: 'mane' },
    { value: 'whiskers', label: 'whiskers' },
    { value: 'moss', label: 'moss' },
    { value: 'feelers', label: 'feelers' },
    { value: 'veil', label: 'veil' },
    { value: 'fans', label: 'sails' },
    { value: 'thorns', label: 'thorns' },
  ], 'tendrils', {
    random: (rng) => weighted(rng, [
      ['none', 3], ['tendrils', 3], ['bristles', 3], ['antennae', 2],
      ['dreads', 2], ['crest', 2], ['fur', 3], ['quills', 3], ['fronds', 2],
      ['spikes', 3], ['barbs', 2], ['coral', 2], ['mane', 3],
      ['whiskers', 2], ['moss', 2], ['feelers', 2], ['veil', 2], ['fans', 2], ['thorns', 3],
    ]),
  }),
  int('tendrils', 'growths', 'hair count', 0, 14, 0, { random: (rng) => weighted(rng, [[0, 3], [4, 3], [8, 3], [14, 2]]) }),
  range('tendrilLen', 'growths', 'hair length', 0.15, 1.2, 0.45),
  // What floats around a freak rather than growing out of it. `spores` kept its
  // key so old links still open with the cloud they were saved with.
  select('aura', 'growths', 'aura', [
    { value: 'spores', label: 'spore cloud' },
    { value: 'ring', label: 'orbit ring' },
    { value: 'bubbles', label: 'rising motes' },
    { value: 'swarm', label: 'swarm' },
    { value: 'halo', label: 'halo of shards' },
  ], 'spores', {
    random: (rng) => weighted(rng, [['spores', 3], ['ring', 3], ['bubbles', 3], ['swarm', 2], ['halo', 2]]),
  }),
  int('spores', 'growths', 'aura count', 0, 220, 0, {
    random: (rng) => weighted(rng, [[0, 3], [24, 2], [60, 3], [120, 2], [220, 1]]),
  }),
  range('auraSize', 'growths', 'aura size', 0, 1, 0.35, { random: (rng) => rng() }),

  // --- BODY --------------------------------------------------------------
  range('headRatio', 'body', 'head share', 0.5, 0.88, 0.7),
  // The torso is a surface of its own now, not a primitive — these are its
  // silhouette, the same three-band idea the skull uses.
  range('chestWide', 'body', 'chest width', -0.6, 0.8, 0),
  range('waistWide', 'body', 'waist width', -0.6, 0.8, 0),
  range('hipWide', 'body', 'hip width', -0.6, 0.8, 0),
  range('bodyBox', 'body', 'boxiness', 0, 1, 0.1, { random: (rng) => rng() * rng() }),
  range('bodyLumps', 'body', 'lumps', 0, 0.4, 0.05, { random: (rng) => rng() * 0.35 }),
  range('belly', 'body', 'belly', 0, 1, 0.15, { random: (rng) => rng() * 0.9 }),
  range('bodyWidth', 'body', 'body width', 0.3, 1.3, 0.7),
  range('limbThick', 'body', 'limb width', 0.3, 1.4, 0.7),
  select('armType', 'body', 'arms', [
    { value: 'none', label: 'none' },
    { value: 'stub', label: 'stubs' },
    { value: 'stick', label: 'sticks' },
    { value: 'noodle', label: 'noodles' },
    { value: 'mantis', label: 'mantis' },
    { value: 'tentacle', label: 'tentacles' },
    { value: 'wing', label: 'wings' },
    { value: 'branch', label: 'branches' },
  ], 'stick', {
    random: (rng) => weighted(rng, [
      ['none', 1], ['stub', 3], ['stick', 4], ['noodle', 3], ['mantis', 3],
      ['tentacle', 2], ['wing', 2], ['branch', 2],
    ]),
  }),
  select('handType', 'body', 'hands', [
    { value: 'none', label: 'none' },
    { value: 'ball', label: 'ball' },
    { value: 'claw', label: 'claws' },
    { value: 'pincer', label: 'pincer' },
    { value: 'club', label: 'club' },
    { value: 'fist', label: 'fist' },
    { value: 'spikes', label: 'spiked ball' },
    { value: 'hook', label: 'hook' },
    { value: 'fingers', label: 'fingers' },
  ], 'ball', {
    random: (rng) => weighted(rng, [
      ['none', 1], ['ball', 4], ['claw', 3], ['pincer', 2], ['club', 2],
      ['fist', 2], ['spikes', 2], ['hook', 2], ['fingers', 3],
    ]),
  }),
  range('armLen', 'body', 'arm length', 0.2, 1.5, 1.0),
  range('armLift', 'body', 'arm lift', -1, 1, 0, { random: (rng) => rng() * 2 - 1 }),
  range('asymmetry', 'body', 'arm mismatch', 0, 1, 0, { random: (rng) => (rng() < 0.35 ? 0 : rng() * 0.9) }),
  select('legType', 'body', 'legs', [
    { value: 'stick', label: 'sticks' },
    { value: 'thick', label: 'thick' },
    { value: 'bent', label: 'bent' },
    { value: 'stump', label: 'stumps' },
    { value: 'frog', label: 'frog' },
    { value: 'peg', label: 'pegs' },
  ], 'stick', {
    random: (rng) => weighted(rng, [
      ['stick', 3], ['thick', 3], ['bent', 3], ['stump', 2], ['frog', 2], ['peg', 2],
    ]),
  }),
  select('footType', 'body', 'feet', [
    { value: 'ball', label: 'ball' },
    { value: 'none', label: 'none' },
    { value: 'splay', label: 'splayed' },
    { value: 'hoof', label: 'hoof' },
    { value: 'claws', label: 'claws' },
    { value: 'boot', label: 'blocks' },
  ], 'ball', {
    random: (rng) => weighted(rng, [
      ['ball', 3], ['none', 2], ['splay', 3], ['hoof', 2], ['claws', 2], ['boot', 2],
    ]),
  }),
  range('legLen', 'body', 'leg length', 0.2, 1.5, 0.8),
  range('stance', 'body', 'stance', 0, 1, 0.45),

  // --- STYLE -------------------------------------------------------------
  color('skinColor', 'style', 'skin', SKIN_COLORS, '#5aa9e6'),
  range('sheen', 'style', 'wet sheen', 0, 1, 0, { random: (rng) => (rng() < 0.5 ? 0 : rng()) }),
  range('glow', 'style', 'glow', 0, 1, 0, { random: (rng) => (rng() < 0.55 ? 0 : rng() * 0.9) }),
  range('bodyTint', 'style', 'body shade', 0, 0.7, 0.25),
  // Hands, feet and ears in a deeper shade of the same skin. Not a second
  // colour — a second tone — which is what stops a freak reading as one flat
  // silhouette without turning it into a paint job.
  range('trim', 'style', 'tip shade', 0, 0.75, 0.35, { random: (rng) => rng() * 0.7 }),
  range('outline', 'style', 'outline', 0, 0.12, 0.05, { random: (rng) => 0.03 + rng() * 0.05 }),
  // The pixel effect is the whole look, but it is also the one thing that
  // hides what the generator is doing — you cannot judge a new ear at a
  // hundred and ninety pixels across. Off, the scene renders above the display
  // and is scaled back down, which antialiases it for free: the WebGL context's
  // own `antialias` flag is fixed when the canvas is created and cannot be
  // turned on later without throwing the context away.
  //
  // Never rolled off: RANDOM is for creatures, not for how they are drawn.
  select('pixelate', 'style', 'pixel effect', [
    { value: 'on', label: 'on' },
    { value: 'off', label: 'off (smooth)' },
  ], 'on', { random: () => 'on' }),
  int('pixelSize', 'style', 'pixel size', 1, 8, 4, { random: () => 4 }),
  int('toonSteps', 'style', 'tone steps', 2, 5, 3, { random: () => 3 }),
  color('bgColor', 'style', 'background', BG_COLORS, '#0b0a10', { random: () => '#0b0a10' }),
];

export const PARAM_BY_KEY = Object.fromEntries(PARAMS.map((p) => [p.key, p]));

// Parts the player put on the skull by hand (EDIT mode). Not a PARAMS entry —
// it is a list, not a slider — but it lives in the same parameter set, rides
// the same share links, and RESET clears it with everything else.
export const PLACED_KINDS = ['eye', 'horn', 'wart'];
export const PLACED_MAX = 24;

export const DEFAULTS = Object.freeze({
  seed: 1337,
  placed: Object.freeze([]),
  ...Object.fromEntries(PARAMS.map((p) => [p.key, p.def])),
});

const clampNum = (p, v) => Math.min(p.max, Math.max(p.min, v));

/** Coerces an arbitrary object into a valid parameter set. */
export function sanitize(input) {
  const out = { ...DEFAULTS };
  if (!input || typeof input !== 'object') return out;

  const seed = Number(input.seed);
  if (Number.isFinite(seed)) out.seed = Math.abs(Math.floor(seed)) % 0xffffffff;

  if (Array.isArray(input.placed)) {
    const num = (v, lim, dflt = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(lim, Math.max(-lim, n)) : dflt;
    };
    out.placed = input.placed.slice(0, PLACED_MAX).flatMap((it) => {
      if (!it || !PLACED_KINDS.includes(it.k)) return [];
      return [{
        k: it.k,
        x: num(it.x, 4),
        y: num(it.y, 4),
        z: num(it.z, 4),
        s: Math.min(2.5, Math.max(0.3, num(it.s, 2.5, 1) || 1)),
      }];
    });
  }

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

  // A skull much taller or wider than it is deep is a blade seen edge-on. The
  // three dimensions are independent sliders, so nothing stopped a roll landing
  // at the top of two and the bottom of the third; depth is brought back up to
  // meet the others. Only RANDOM is nudged — set the sliders by hand and you
  // get exactly what you set, blade included.
  out.headDepth = Math.max(out.headDepth, Math.max(out.headWidth, out.headHeight) / 2.1);

  // An eye only reads as an eye if it stands apart from what surrounds it. The
  // sclera is picked before the skin is (parameters are rolled in panel order),
  // so the two are reconciled here: a pale eyeball on a pale face is a bump
  // with a dot on it, not a face looking at you. Same again for the pupil,
  // which otherwise vanishes into a dark sclera.
  const apart = (a, b, gap, palette) => {
    if (Math.abs(luma(a) - luma(b)) >= gap) return a;
    const far = palette.filter((c) => Math.abs(luma(c) - luma(b)) > gap * 1.3);
    return far.length ? far[Math.floor(rng() * far.length) % far.length] : a;
  };
  out.eyeColor = apart(out.eyeColor, out.skinColor, 0.22, EYE_COLORS);

  // The pupil was reconciled against the sclera alone — and half the eye kinds
  // have no sclera worth speaking of. A `hole` is a socket cut into the face
  // and a `gash` is a slit in it; on those the pupil sits on a shade of the
  // SKIN, so a pale pupil on a pale freak is a blank stare with nothing in it.
  //
  // What it has to stand apart from is whatever is actually behind it, and
  // nothing else. Demanding it clear both the eye and the skin has no answer
  // at all when those two sit at opposite ends of the ramp.
  const sunken = out.eyeStyle === 'hole' || out.eyeStyle === 'gash';
  const behind = sunken ? luma(out.skinColor) * 0.5 : luma(out.eyeColor);
  // A pupil is a hole in a face, so it goes DARK by preference and only turns
  // to the lit end when what is behind it is already dark.
  if (Math.abs(luma(out.pupilColor) - behind) < 0.2) {
    const away = PUPIL_COLORS.filter((c) => Math.abs(luma(c) - behind) > 0.26);
    const dark = away.filter((c) => luma(c) < behind);
    const from = dark.length ? dark : away;
    if (from.length) out.pupilColor = from[Math.floor(rng() * from.length) % from.length];
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
