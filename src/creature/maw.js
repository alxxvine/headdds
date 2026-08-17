// The maw was an ellipse, always, and there is only so much menace in an oval.
// A mouth reads as angry or stupid or hungry long before you notice what is in
// it — a straight line with the corners pulled down is a different creature
// from the same head wearing a grin.
//
// So the shape is two curves rather than a radius: `up(u)` and `down(u)` give
// the top and bottom rim at u across the mouth, u running -1 at the left corner
// to +1 at the right, in units of the maw's own half-height. Everything that
// touches the mouth reads them — the lips, the cavity and both rows of teeth —
// so a tooth is planted on the rim it actually grows out of, whatever that rim
// is doing.
//
// The two curves must meet at the corners (up(±1) === down(±1)) or the mouth
// has a gap in it.

const clamp1 = (u) => Math.min(1, Math.max(-1, u));
/** the plain ellipse's own half-height at u */
const arc = (u) => Math.sqrt(Math.max(0, 1 - clamp1(u) * clamp1(u)));
/** a triangle wave over u, dying at the corners so the rim still closes */
const saw = (u, n) => (1 - Math.abs((((u + 1) * n) % 2) - 1)) * 2 - 1;
/** a dip centred on u = 0 */
const notch = (u, w) => Math.exp(-((u / w) * (u / w)));

export const MAW_SHAPES = [
  'oval', 'grin', 'frown', 'snarl', 'slit',
  'zigzag', 'keyhole', 'crescent', 'gape', 'crooked', 'beak',
];

/**
 * The two rim curves for a kind of maw. Pure functions of u — no rng, no
 * geometry — so the teeth and the decals can each ask for the same rim without
 * having to agree on anything else.
 */
export function mawProfile(kind) {
  switch (kind) {
    case 'grin':
      // corners hauled up: the mouth of something pleased with itself
      return { up: (u) => arc(u) * 0.9 + u * u * 0.55, down: (u) => -arc(u) * 0.7 + u * u * 0.55 };
    case 'frown':
      // and hauled down, which is the whole of an angry face
      return { up: (u) => arc(u) * 0.7 - u * u * 0.55, down: (u) => -arc(u) * 0.9 - u * u * 0.55 };
    case 'snarl':
      // upper lip peeled back off the middle teeth, corners down
      return {
        up: (u) => arc(u) * (0.55 + 0.5 * notch(u, 0.42)) - u * u * 0.3,
        down: (u) => -arc(u) * 0.85 - u * u * 0.3,
      };
    case 'slit':
      // barely open, and all the wider for it
      return { up: (u) => arc(u) * 0.26, down: (u) => -arc(u) * 0.26 };
    case 'zigzag':
      // a torn rim, not a cut one
      return {
        up: (u) => arc(u) * (0.75 + 0.35 * saw(u, 3.5)),
        down: (u) => -arc(u) * (0.75 + 0.35 * saw(u + 0.3, 3.5)),
      };
    case 'keyhole':
      // shallow above, deep below: a jaw hanging open
      return { up: (u) => arc(u) * 0.4, down: (u) => -arc(u) * 1.35 };
    case 'crescent':
      // a thin arc bending down across the face
      return {
        up: (u) => arc(u) * 0.5 - (1 - u * u) * 0.55,
        down: (u) => -arc(u) * 0.5 - (1 - u * u) * 0.55,
      };
    case 'gape':
      // round and wide, a hole rather than a mouth
      return { up: (u) => arc(u) * 1.3, down: (u) => -arc(u) * 1.3 };
    case 'crooked':
      // one corner higher than the other, all on its own
      return { up: (u) => arc(u) * 0.95 + u * 0.5, down: (u) => -arc(u) * 0.95 + u * 0.5 };
    case 'beak':
      // straight edges to a point at each corner
      return { up: (u) => 1 - Math.abs(clamp1(u)), down: (u) => -(1 - Math.abs(clamp1(u))) };
    default:
      return { up: arc, down: (u) => -arc(u) };
  }
}

/**
 * The profile as a closed rim in unit coordinates, for `decalGeometry`.
 * The upper curve is walked right to left over the first half of the turn and
 * the lower one back again, so the loop closes at the two corners.
 */
export function mawRim(profile) {
  return (a) => {
    const u = Math.cos(a);
    return [u, Math.sin(a) >= 0 ? profile.up(u) : profile.down(u)];
  };
}

/** How far the profile reaches above and below the centre line, over all u. */
export function mawExtent(profile) {
  let hi = 0;
  let lo = 0;
  for (let i = 0; i <= 40; i++) {
    const u = -1 + (i / 40) * 2;
    hi = Math.max(hi, profile.up(u), profile.down(u));
    lo = Math.min(lo, profile.up(u), profile.down(u));
  }
  return { hi, lo };
}
