import { makeRng } from '../lib/noise.js';
import { computeStats } from './stats.js';

// Every freak gets a name, and the name comes out of the same place the body
// does: the seed names the syllables, the loudest thing about the build names
// the epithet. Computed, never stored — so it costs the share link nothing and
// two people opening the same link meet the same GRUBMOK THE LOPSIDED.
//
// The rng here is its own stream (seed xor a constant), NOT the creature's
// build stream: drawing name syllables from that one would shift every part
// built after them and change how existing seeds look.

// Onsets and cores picked to sound like something coughed up rather than like
// fantasy elves: hard clusters, low vowels, the odd wet ending.
const ONSET = [
  'GR', 'THR', 'ZG', 'MOR', 'BL', 'SKR', 'DR', 'GL', 'KR', 'VR',
  'SN', 'FL', 'GOR', 'ZH', 'QU', 'B', 'SL', 'PL', 'HR', 'WUR',
];
const CORE = [
  'UB', 'OG', 'IB', 'UG', 'ORB', 'UZZ', 'OB', 'EG', 'AB', 'OD',
  'UM', 'IG', 'OT', 'UNK', 'OMP', 'ULCH', 'EEB', 'OOG', 'AGG', 'IBB',
];
const TAIL = [
  '', '', '', '',   // most names just stop
  'US', 'ER', 'LE', 'O', 'A', 'ITE', 'OX', 'EL',
];

/** The seed's own name, without the epithet: GRUBMOK, THROG, SNULCHER... */
export function baseName(seed) {
  const rng = makeRng((seed >>> 0) ^ 0x6e616d65);
  let name = ONSET[Math.floor(rng() * ONSET.length)] + CORE[Math.floor(rng() * CORE.length)];
  // a second syllable on about half of them, so lengths vary
  if (rng() < 0.5) name += ONSET[Math.floor(rng() * ONSET.length)] + CORE[Math.floor(rng() * CORE.length)];
  name += TAIL[Math.floor(rng() * TAIL.length)];
  return name;
}

/**
 * Full name with an epithet: the epithet is the build talking, so it comes
 * from the traits — the loud features — and falls back to the archetype when
 * the build has nothing loud about it. Which trait gets the honour is the
 * seed's choice, so a freak with three traits does not always lead with the
 * first one in the table.
 */
export function nameOf(params) {
  const rng = makeRng((params.seed >>> 0) ^ 0x65706974);
  const { traits, archetype } = computeStats(params);
  const epithet = traits.length
    ? traits[Math.floor(rng() * traits.length)].label
    : archetype;
  return `${baseName(params.seed)} THE ${epithet}`;
}
