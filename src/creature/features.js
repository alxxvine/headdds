import * as THREE from 'three';
import { headPoint, headHalfWidth } from './head.js';
import { surfaceAt, surfaceByDir, surfaceRadial, patchFrame, orientTo, orientUpright, decalGeometry, bandGeometry, snapToMesh } from './surface.js';
import { withOutline } from './materials.js';
import { warpGeometry, warpRoll } from './warp.js';
import { addHair } from './hair.js';
import { addEars } from './ears.js';
import { addAura } from './aura.js';
import { mawProfile, mawExtent } from './maw.js';

// Feature sizes are expressed in "head units" so that an eye stays an eye
// both on a squashed pancake and on a long cucumber.
export const headUnit = (p) => (p.headWidth + p.headHeight) * 0.5;

/**
 * Where the big features sit on the face, in the frontal coordinates every
 * placement uses. Eyes, nose and maw are built by three separate functions and
 * each used to place itself as if it were alone on the skull, which is how a
 * nose ends up inside the maw and an eye ends up wearing the nose. They all
 * read these limits now, so they agree.
 *
 * The overlaps are not forbidden outright — a freak whose eye crowds its nose
 * is a good freak — only kept from landing one part fully inside another.
 */
// How far each kind of nose reaches below its own centre, in noseSize, taking
// the worst case of the proportion roll `addNose` makes — the rest of the face
// is placed before that roll happens, so the worst case is what it has to dodge.
// How far below its own planting height each kind of nose actually reaches, in
// nose-sizes. Measured off built creatures (tools/nose-reach.mjs) rather than
// reasoned about: every kind here was under-reserved, some of them by a factor
// of three, and the face was handing the mouth's room to a nose that then sat
// in it. A trunk is the one exception — it hangs over the mouth by design, and
// its number is a placement, not a clearance.
const NOSE_REACH = {
  none: 0, holes: 0.8, slits: 1.0, button: 1.0, beak: 2.35, pig: 2.25,
  plate: 1.35, star: 1.15, double: 1.4, snout: 2.85, tusks: 0.4, straw: 1.6,
  horn: 1.4, ridge: 2.0, hook: 2.05, blob: 3.05, bump: 3.4, trunk: 2.6,
};

/**
 * Where the mouth actually goes, kept inside the head.
 *
 * The maw is a decal projected onto the skull by raycast, so a mouth wider or
 * lower than the skull does not get clipped — it WRAPS. A mouth an eighth too
 * low came out with its dark interior hanging under the chin and its bottom
 * teeth outside the silhouette, and one too wide ran round the cheeks towards
 * the shoulders. Nothing had ever compared the mouth to the head it is cut in.
 *
 * `skew` is the lopsided roll. addMouth passes the one it drew; faceLimits
 * passes the worst it could draw, because everything it places has to clear a
 * mouth that has not been rolled yet.
 */
export function mawBox(p, skew = 0) {
  const profile = mawProfile(p.mawShape);
  const { hi, lo } = mawExtent(profile);
  // the lips are drawn a size larger than the cavity, and taller than wide
  const grow = 1 + Math.max(0, p.lips);
  const mx = skew * p.headWidth * 0.1;
  let mw = p.mouthWidth * p.headWidth;
  let mh = Math.max(0.03, p.mouthOpen * p.headHeight * 0.55);
  let my = p.mouthY * p.headHeight * 0.8 + skew * p.headHeight * 0.06;

  const chin = headPoint(p, _sd.set(0, -1, 0), _sp).y;
  const crown = headPoint(p, _sd.set(0, 1, 0), _sp).y;
  const edge = (p.headHeight + p.headWidth) * 0.06;   // a lip's worth of margin

  // Vertically: raise it off the chin, then give up opening if it still does
  // not fit between the chin and the crown.
  for (let k = 0; k < 8; k++) {
    const reach = mh * grow * 1.25;
    my = Math.max(my, chin + edge - lo * reach * 1.1);
    if (my + hi * reach <= crown - edge) break;
    mh *= 0.8;
  }

  // Across: the mouth may run right to the edge of the face but not round it —
  // and it is asked over its whole height, not only at its middle. A jaw
  // narrows towards the chin, so a mouth that fits at its centre line still
  // wraps at its bottom corner.
  for (let k = 0; k < 10; k++) {
    const reach = mh * grow * 1.25;
    let half = Infinity;
    for (let i = 0; i <= 6; i++) {
      const y = my + lo * reach + ((hi - lo) * reach * i) / 6;
      const q = silhouetteAt(p, y);
      if (q > 0) half = Math.min(half, q);
    }
    if (!Number.isFinite(half) || Math.abs(mx) + mw * grow <= half * 0.92) break;
    mw *= 0.87;
  }

  return { mx, my, mw, mh, profile, hi, lo };
}

export function faceLimits(p) {
  const S = headUnit(p);
  // the top rim of the maw, opening included
  // The top of the maw is where its own profile reaches, not where an ellipse
  // would: a grin throws its corners half a mouth-height higher than the oval
  // it replaced, and everything above has to know.
  const box = mawBox(p, p.lopsided);
  const mouthTop = box.my + box.mh * (1 + Math.max(0, p.lips)) * 1.25 * Math.max(1, box.hi) * 1.05;
  // A nose is measured in head units, which say nothing about how wide the
  // skull is where the nose goes. On a narrow face the top of the slider put a
  // bulb half a head across on it — not a nose but a stain with a black arc
  // round the top of it, which is the outline doing its job on something that
  // should never have been that big. Capped against the face it is on.
  let noseSize = p.noseSize * S;
  for (let k = 0; k < 3; k++) {
    const at = p.noseY * p.headHeight * 0.7;
    const half = silhouetteAt(p, at);
    if (half <= 0) break;
    noseSize = Math.min(noseSize, half * 0.42);
  }
  // How tall the nose really is, rather than how tall a ball of `noseSize`
  // would be. `addNose` scales its mesh by a roll of up to 1.6 on top of the
  // per-kind proportions, so the thing that got built was two to two and a half
  // times the size these limits were reserving for it — which is why 44% of
  // nosed creatures had nose geometry sitting inside the lip ring and one in
  // seven had it inside the maw itself. The worst case of the roll is what the
  // rest of the face has to dodge, because the rest of the face is placed
  // before the roll happens.
  let noseHalfH = noseSize * (NOSE_REACH[p.noseType] ?? 2.0);
  // A nose is lifted clear of the maw, and on a small head with a high mouth
  // that lift carried it clean off the top of the skull: a ninth of all
  // creatures reserved a band for the nose that ended above their own crown.
  // The nose then sat on the crown — and every eye with it, since the eyes are
  // placed above the nose, which is why a seven-eyed face came out blank with a
  // lump on top of its head. There is only so much face between the mouth and
  // the crown; a nose that does not fit in it is made to fit.
  const crownY = headPoint(p, _sd.set(0, 1, 0), _sp).y;
  const band = crownY - mouthTop;
  if (p.noseType !== 'none' && noseHalfH * 2.1 > band && band > 0) {
    const f = Math.max(0.25, band / (noseHalfH * 2.1));
    noseSize *= f;
    noseHalfH *= f;
  }
  const noseY = p.noseType === 'none' ? -99
    : Math.min(Math.max(p.noseY * p.headHeight * 0.7, mouthTop + noseHalfH * 1.05),
      crownY - noseHalfH * 1.05);
  return {
    S,
    mouthTop,
    noseSize,
    noseY,
    noseHalfH,
    // how much room the nose takes on the face, for whatever has to dodge it
    noseHalfW: noseSize * (p.noseType === 'pig' ? 2.1 : p.noseType === 'tusks' ? 1.6
      : p.noseType === 'snout' ? 1.6 : 1.6),
    noseTop: noseY + noseHalfH,
  };
}

// ----------------------------------------------------------------- EYES ----

function eyePositions(p, rng) {
  const n = p.eyeCount;
  if (n <= 0) return [];
  const sx = p.eyeSpread * p.headWidth;
  const cy = p.eyeY * p.headHeight * 0.7;
  if (n === 1) return [[0, cy]];

  const out = [];
  switch (p.eyeLayout) {
    case 'ring':
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.PI / 2;
        out.push([Math.cos(a) * sx, cy + Math.sin(a) * sx * 0.8]);
      }
      break;
    case 'column':
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) - 0.5;
        out.push([t * sx * 0.25, cy - t * sx * 1.7]);
      }
      break;
    case 'cluster':
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng());
        out.push([Math.cos(a) * r * sx, cy + Math.sin(a) * r * sx * 0.85]);
      }
      break;
    case 'scatter':
      for (let i = 0; i < n; i++) {
        out.push([(rng() * 2 - 1) * p.headWidth * 0.72, (rng() * 1.3 - 0.3) * p.headHeight * 0.6]);
      }
      break;
    default: // row
      for (let i = 0; i < n; i++) {
        const x = ((i / (n - 1)) * 2 - 1) * sx;
        out.push([x, cy + x * p.eyeTilt]);
      }
  }
  return out;
}

/**
 * The pupil, sitting on the front of an eyeball of radius `size`.
 * Shapes are built from primitives rather than textures: at this resolution a
 * squashed capsule reads as a slit and a torus reads as a ring.
 */
// the pupil helper has no rng of its own and does not need a good one: this is
// only here to keep a square pupil from sitting perfectly straight
let rollState = 1;
const rngRoll = () => { rollState = (rollState * 48271) % 2147483647; return rollState / 2147483647; };

const FORWARD = new THREE.Vector3(0, 0, 1);
const _fd = new THREE.Vector3();
const _fs = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _thit = { point: new THREE.Vector3(), normal: new THREE.Vector3() };
const _tseat = { point: new THREE.Vector3(), normal: new THREE.Vector3() };
const _sd = new THREE.Vector3();
const _sp = new THREE.Vector3();
/** see headHalfWidth — the outline of the skull at a height, solved exactly */
const silhouetteAt = headHalfWidth;

/**
 * How far a feature may stand off the skin before it is standing off the HEAD.
 * Near the shoulder or the crown the normal points out and up, so an eye
 * pushed out by its own bulge climbs into the part of the skull that is
 * narrowing — and lands beside the outline rather than on it. Walked back
 * until the thing at the end of it is still over the head.
 */
function seatOut(p, hit, dist, radius) {
  let d = Math.max(0, dist);
  for (let k = 0; k < 8; k++) {
    // the FRONT of it: the pupil rides a radius further out again, and that is
    // the part a player sees standing beside the head instead of on it
    const at = d + radius;
    const half = silhouetteAt(p, hit.point.y + hit.normal.y * at);
    if (half > 0 && Math.abs(hit.point.x + hit.normal.x * at) <= half) break;
    if (d < 1e-4) break;
    d *= 0.5;
  }
  return dist < 0 ? dist : d;
}

// What an eye of each style actually covers on the face, as a multiple of the
// `size` it is planned at, across and down. The styles were written one at a
// time and only some of them draw a ball of `size`: a visor is a band four
// times wider than the eye it stands for, a compound eye carries a rim half
// again its own radius, a slot is tall and narrow. Settling them all as if
// they were the same circle is why two visors could be planted a clear radius
// apart and still come out as one bar across the face.
// Third number: how far the style stands the eye off the skin, again in
// `size`. Near the shoulder of a skull the normal is mostly sideways, so
// standing an eye off the skin walks it towards the edge — an eye settled
// safely inside the outline and then pushed half its own radius outwards ends
// up hanging over it. The room the settler leaves carries this too.
// Third number: how far the style REACHES OUT from the skin — the front of the
// eye, not the middle of it. It used to be the stand-off alone, and the
// stand-off is the smaller half of the story: a ball style is pushed out 0.15
// and then draws a radius of its own on top, so it reaches 1.4 while the
// settler was reserving 0.15. Near the shoulder of the skull the normal is
// mostly sideways, so that whole reach is horizontal, and an eye settled inside
// the outline was standing a size and a half past it. All three numbers are
// measured off built creatures (tools/eye-extent.mjs), not declared.
const EYE_FOOTPRINT = {
  ball: [1.05, 1.1, 1.4], gash: [1.2, 0.45, 0.65],
  hole: [1.05, 1.2, 0.5], bead: [1.25, 1.25, 0.55], stalk: [1.35, 1.35, 1.4],
  compound: [1.5, 1.5, 0.95], pit: [1.2, 1.2, 0.9], bulb: [1.2, 1.2, 1.6],
  cluster: [1.35, 1.25, 0.6], visor: [2.4, 0.85, 0.7], crystal: [1.1, 1.1, 1.2],
  ring: [1.15, 1.15, 0.45], bloom: [1.25, 1.25, 0.7], button: [1.05, 1.05, 1.25],
  slot: [0.7, 1.45, 0.2], dome: [1.15, 1.15, 1.0], lantern: [1.2, 1.2, 0.9],
};

const _fu = new THREE.Vector3();
const _fv = new THREE.Vector3();
const _fq = new THREE.Vector3();
const _fx = new THREE.Vector3();

const HEAD_R = new WeakMap();

/**
 * The skull's own radius, averaged over the sphere, worked out once per
 * creature. `headUnit` is the average of two SLIDERS and says nothing about the
 * shape they produced; this is the thing a part should be measured against when
 * the question is "is that too big for this head".
 */
export function headRadius(p) {
  let r = HEAD_R.get(p);
  if (r !== undefined) return r;
  r = 0;
  for (let k = 0; k < 32; k++) {
    const a = Math.acos(1 - (2 * (k + 0.5)) / 32);
    const b = k * 2.39996;
    headPoint(p, _fd.set(Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)), _fs);
    r += _fs.length();
  }
  r /= 32;
  HEAD_R.set(p, r);
  return r;
}

/**
 * The depth of the skin at a frontal point, or null if the head is not there.
 * Solved on the star-shaped surface by bisection rather than by a raycast, so
 * it can be asked thousands of times without a BVH.
 */
function skinDepth(p, x, y) {
  const outside = (t) => {
    _fx.set(x, y, t);
    if (_fx.lengthSq() < 1e-9) return false;
    _fd.copy(_fx).normalize();
    headPoint(p, _fd, _fs);
    return _fx.lengthSq() > _fs.lengthSq();
  };
  if (outside(0)) return null;
  let lo = 0;
  let hi = 8;
  if (!outside(hi)) return hi;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (outside(mid)) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Is there head UNDER this eye?
 *
 * Not "is it inside the head" — a bulging eye is outside the skin all the way
 * round on purpose, that is what bulging is. What it may not be is over the
 * EDGE. So from each point of the circle where the eye meets the skin we march
 * inward along the eye's own axis and ask whether we ever enter the skull. Over
 * the middle of a face you enter it at once; over the temple of a narrow skull
 * you march past the side of the head and never do, and that is the eye
 * standing in the air that the settler's flat arithmetic cannot see. The
 * settler solves the frontal plane, and the frontal plane has no answer to
 * "does the skin fall away behind this".
 *
 * Returns the share of that circle with nothing beneath it, 0 to 1.
 */
function unsupported(p, e, headMesh) {
  if (skinDepth(p, e.x, e.y) === null) return 1;
  // The very frame the eye will be built in — the same raycast, so the disc
  // this tests is the disc that gets drawn. Asking the analytic surface instead
  // sounds tidier and measures a different object: the analytic normal is a
  // finite difference across a noise field and comes out ROUGHER than the mesh
  // it stands for, which made this worse rather than better when tried.
  const s = surfaceAt(headMesh, p, e.x, e.y);
  const n = s.normal;
  _fu.set(Math.abs(n.y) > 0.9 ? 1 : 0, Math.abs(n.y) > 0.9 ? 0 : 1, 0).cross(n).normalize();
  _fv.crossVectors(n, _fu).normalize();
  // The ring is taken at the ROOT, on the skin, not at the eyeball's centre.
  // Where the centre ends up is the style's business — some styles sink their
  // ball into the skull and some stand it a radius proud — and none of that
  // changes the question, which is whether the patch of skull the eye is
  // planted on is big enough to hold it.
  // ...with the ink around it. An outline shell is drawn a little proud of the
  // part it rings, and a rim of black standing beside the head is exactly as
  // wrong as an eyeball would be.
  const rx = e.rx * 1.12;
  const ry = e.ry * 1.12;
  const reach = Math.max(rx, ry) * 2.2;
  let out = 0;
  const RING = 8;
  const STEP = 6;
  for (let i = 0; i < RING; i++) {
    const t = (i / RING) * Math.PI * 2;
    const ax = Math.cos(t) * rx;
    const ay = Math.sin(t) * ry;
    _fq.set(s.point.x + _fu.x * ax + _fv.x * ay,
      s.point.y + _fu.y * ax + _fv.y * ay,
      s.point.z + _fu.z * ax + _fv.z * ay);
    let held = false;
    for (let k = 0; k <= STEP; k++) {
      _fx.copy(_fq).addScaledVector(n, -reach * (k / STEP));
      if (_fx.lengthSq() < 1e-9) { held = true; break; }
      _fd.copy(_fx).normalize();
      headPoint(p, _fd, _fs);
      if (_fx.lengthSq() <= _fs.lengthSq()) { held = true; break; }
    }
    if (!held) out++;
  }
  return out / RING;
}

/**
 * Nudges the planned eyes until no two are inside one another and none hangs
 * off the edge of the skull.
 *
 * The layouts each solve their own shape and stop there: a `ring` of two puts
 * both eyes on the midline, `cluster` and `scatter` draw positions at random
 * with no spacing rule at all, and every one of them is free to place an eye
 * at a full head-width from the centre where the skull is nowhere near that
 * wide. Relaxation rather than a redesign of the layouts, because the layout
 * is what the player asked for and this only has to make it possible.
 */
function settleEyes(p, plan, L, clear, headMesh) {
  if (plan.length === 0) return;

  // the crown and the chin, so nothing is planted in the air above the head
  const crown = headPoint(p, _sd.set(0, 1, 0), _sp).y;
  const chin = headPoint(p, _sd.set(0, -1, 0), _sp).y;

  // Where an eye is allowed to be, given its size: a band of heights under the
  // crown and a half-width at that height. Stored on the eye, because the
  // pushing below has to know which way there is room to push.
  const bounds = (e) => {
    // The floor keeps an eye out of the mouth; the ceiling keeps it under the
    // crown. On a narrow skull with big eyes the floor comes out ABOVE the
    // ceiling — the clearance the face wants is more than the face has — and
    // the two fought every pass, with the ceiling winning. A ceiling is the
    // same height for every eye, so both eyes of a pair landed on it, and no
    // amount of pushing or shrinking could separate two points being reset to
    // the same place. When there is not enough room the floor is the one that
    // gives, all the way back to the bare top of the mouth.
    // Nine tenths of the eye's own height is not the eye's own height, and the
    // tenth that was left over is the top of the eyeball standing above the
    // crown — which is exactly what "the eyes climb out of the head" looks like
    // from the front.
    e.top = crown - e.ry * 1.05;
    let low = e.floor;
    if (low > e.top - e.ry * 2) low = e.bare;
    e.low = Math.min(Math.max(low, chin + e.ry * 1.05), e.top);

    // The outline over the eye's whole height, not just at its middle: a skull
    // with a shoulder in it can be twice as wide at an eye's centre as it is at
    // the eye's top, and an eye measured only at its centre sits half on the
    // head and half beside it.
    // ...and asked at the eye's actual top and bottom, not three quarters of the
    // way there, because the corner that ends up over nothing is the corner.
    const y = THREE.MathUtils.clamp(e.y, e.low, e.top);
    let half = silhouetteAt(p, y);
    for (const k of [-1, -0.6, 0.6, 1]) {
      const q = silhouetteAt(p, y + e.ry * k);
      if (q > 0) half = Math.min(half, q + e.ry * 0.2);
    }
    // The reserve grows towards the sides, because the eye is not left where
    // this puts it: it is planted on the skin and then pushed OUT along the
    // surface normal by its own bulge, and near the shoulder of the skull that
    // normal is mostly horizontal.
    const lean = half > 0 ? Math.min(1, Math.abs(e.x) / half) : 0;
    e.room = half <= 0 ? 0 : Math.max(0, half - e.rx * 0.55 - e.stand * lean * 0.6);
  };

  const inside = (e) => {
    bounds(e);
    e.y = THREE.MathUtils.clamp(e.y, e.low, e.top);
    e.x = THREE.MathUtils.clamp(e.x, -e.room, e.room);
  };

  // How far two eyes are into one another, as a fraction — measured on the
  // ellipse each one actually covers rather than on a circle neither of them is.
  const bite = (A, B) => {
    const d = Math.hypot((A.x - B.x) / (A.rx + B.rx), (A.y - B.y) / (A.ry + B.ry));
    return d < 1 ? 1 - d : 0;
  };

  const worstPair = () => {
    let worst = 0;
    for (let a = 0; a < plan.length; a++) {
      for (let b = a + 1; b < plan.length; b++) worst = Math.max(worst, bite(plan[a], plan[b]));
    }
    return worst;
  };

  // An eye planted on a crown too narrow to hold it slides down the skull
  // until there is head under it. Without this the ceiling gathers every eye
  // that started high onto one line across the top of the skull, where there
  // is the least room of anywhere on the face — and a row of four then had
  // nowhere to go but into each other, however small they were shrunk.
  const settleDown = (e) => {
    for (let k = 0; k < 14; k++) {
      bounds(e);
      if (e.room >= e.rx * 1.25 || e.y <= e.low + 1e-6) break;
      e.y = Math.max(e.low, e.y - e.ry * 0.35);
    }
  };

  const relax = () => {
    for (const e of plan) { settleDown(e); inside(e); }
    for (let pass = 0; pass < 14; pass++) {
      let moved = 0;
      for (let a = 0; a < plan.length; a++) {
        for (let b = a + 1; b < plan.length; b++) {
          const A = plan[a];
          const B = plan[b];
          // A fifth more than the two radii, because this is solved in the
          // FLAT frontal frame the layouts are written in and the eyes are
          // then planted on a curved skull, where that frame is compressed —
          // two eyes a clear radius apart on paper come out touching on the
          // side of a round head.
          const rx = (A.rx + B.rx) * 1.22;
          const ry = (A.ry + B.ry) * 1.22;
          let d = Math.hypot((B.x - A.x) / rx, (B.y - A.y) / ry);
          if (d >= 1) continue;
          let ux;
          let uy;
          if (d < 0.25) {
            // All but on top of one another — which a `ring` of two on the
            // midline always is. The line between two nearly coincident points
            // is noise, and following it walked pair after pair straight into
            // the ceiling: a face has far more room across than up, and both
            // eyes came back off the clamp onto the same spot. So near-merged
            // pairs are separated along whichever axis actually has room,
            // alternating sides so three eyes on one place do not all leave
            // together.
            const across = Math.min(A.room, B.room) * 2 >= (A.top - A.low) + (B.top - B.low);
            const sign = (a + b) % 2 ? -1 : 1;
            ux = across ? sign : 0;
            uy = across ? 0 : sign;
            d = 0;
          } else {
            ux = (B.x - A.x) / rx / d; uy = (B.y - A.y) / ry / d;
          }
          const step = (1 - d) / 2;
          A.x -= ux * rx * step; A.y -= uy * ry * step;
          B.x += ux * rx * step; B.y += uy * ry * step;
          moved++;
        }
      }
      // the mouth and the nose were dodged before the push and have to stay
      // dodged after it, and nothing may be shoved off the skull
      for (const e of plan) inside(e);
      if (!moved) break;
    }
  };

  // How small an eye is allowed to get. Three shrinking loops run below and
  // they compose: at the end of all of them a seven-visor face had eyes at two
  // hundredths of the size it asked for, which is a creature with no eyes at
  // all — measured, and confirmed on the picture, which shows a blank face.
  // An eye that cannot be fitted is REMOVED instead. Six visors that read as
  // eyes beat seven that read as nothing.
  for (const e of plan) e.min = e.size * 0.42;

  /** shrink everything that still has room to shrink; false if none had */
  const shrink = (f) => {
    let any = false;
    for (const e of plan) {
      if (e.size <= e.min * 1.001) continue;
      const g = Math.max(f, e.min / e.size);
      e.size *= g;
      e.rx *= g;
      e.ry *= g;
      e.stand *= g;
      e.floor = Math.min(e.floor, e.bare + e.size * 1.5);
      any = true;
    }
    return any;
  };

  /** drop the eye that is deepest inside another one; false if only one left */
  const dropWorst = () => {
    if (plan.length <= 1) return false;
    let worst = -1;
    let victim = plan.length - 1;
    for (let a = 0; a < plan.length; a++) {
      for (let b = a + 1; b < plan.length; b++) {
        const v = bite(plan[a], plan[b]);
        if (v > worst) { worst = v; victim = b; }
      }
    }
    plan.splice(victim, 1);
    return true;
  };

  relax();
  // A ring of eight on a narrow skull has nowhere to go: the pushing runs into
  // the silhouette clamp and comes straight back. When there is genuinely no
  // room, the eyes give up size instead of staying merged — a face full of
  // small eyes is a design, two eyeballs inside one another is a defect.
  for (let attempt = 0; attempt < 20 && worstPair() > 0.02; attempt++) {
    if (!shrink(0.86) && !dropWorst()) break;
    relax();
  }

  // Everything above solves the frontal plane. The last thing to check is the
  // one thing the frontal plane cannot answer: whether the skull is actually
  // UNDER each eye. An eye out on the temple of a narrow head can be well
  // inside the outline and still have its outer half over nothing, and that is
  // what "the eyes climb out of the head" is when you turn the creature.
  //
  // The cure is the obvious one — walk the eye back towards the middle of the
  // face until there is head beneath it. It runs once, after the layout has
  // settled, because it is the expensive test and because moving an eye here
  // can only reduce how far out it is, which no earlier rule minds.
  const midY = (crown + chin) * 0.5;
  for (const e of plan) {
    // An eye near the middle of a face cannot be over an edge, and the test is
    // the expensive one — so it is only asked of the eyes that could fail it.
    bounds(e);
    if (Math.abs(e.x) < e.room * 0.45 && Math.abs(e.y - midY) < (e.top - e.low) * 0.35) continue;
    for (let k = 0; k < 10 && unsupported(p, e, headMesh) > 0.02; k++) {
      // Move it in first. If moving it in is not enough — an eye can be wider
      // than the whole side of the head it is on, and then no place on that
      // head holds it — it gives up size as well. Alternating the two converges
      // where either alone circles.
      e.x *= 0.82;
      e.y = midY + (e.y - midY) * 0.88;
      e.y = Math.max(e.y, Math.min(e.bare, e.top));
      if (k >= 2 && e.size > e.min * 1.001) {
        const g = Math.max(0.88, e.min / e.size);
        e.size *= g;
        e.rx *= g;
        e.ry *= g;
        e.stand *= g;
      }
      inside(e);
    }
  }

  // ...and if the layout STILL cannot be made to work, it is abandoned. Four
  // visor bands on a narrow crown do not fit in any arrangement, and shrinking
  // them does not help while they are all pinned to the same line of skull.
  // A row of small eyes across the widest part of the face is not the layout
  // the player picked; two eyeballs inside one another is not a creature.
  if (worstPair() > 0.02) {
    const lo = Math.min(...plan.map((e) => e.low));
    const hi = Math.max(...plan.map((e) => e.top));
    let bestY = lo;
    let bestRoom = 0;
    for (let i = 0; i <= 24; i++) {
      const probe = { ...plan[0], x: 0, y: lo + ((hi - lo) * i) / 24 };
      bounds(probe);
      if (probe.room > bestRoom) { bestRoom = probe.room; bestY = probe.y; }
    }
    const span = () => plan.reduce((t, e) => t + e.rx * 2.44, 0);
    // ...and a row that still does not fit loses eyes rather than keeping all
    // of them at a size that draws no pixels.
    for (let k = 0; k < 24 && span() > bestRoom * 2; k++) {
      if (!shrink(0.86) && !dropWorst()) break;
    }
    let cursor = -span() / 2;
    for (const e of plan) {
      e.x = cursor + e.rx * 1.22;
      e.y = bestY;
      cursor += e.rx * 2.44;
    }
  }
}

/**
 * `deep` is how far out of the eye the pupil rides, as a share of the eye's
 * size. It defaults to the front of a ball, because most styles draw one. A
 * style that draws no ball has to say so: `button` is a patch sewn flat onto
 * the skin, and giving its pupil a ball's depth left a dot hanging four fifths
 * of an eye in front of the face with nothing behind it — invisible head-on and
 * plain the moment the creature turns.
 */
function addPupil(pivot, p, mats, size, deep = 0.82) {
  if (p.pupilShape === 'blind') return;

  const r = size * 0.52 * p.pupilSize + size * 0.08;
  // Far enough out to BREAK the ball it is set in. At four fifths of the way
  // out a small pupil clears the surface by a thousandth of a head — which is
  // less than a pixel at the size this renders at, so the eye came out as a
  // plain dark ball and a face with seven of them as a face with seven holes
  // punched in it. Nine creatures in a hundred had the pupil buried outright.
  // The deeper the pupil, the more of it shows: a cap of about nine tenths of
  // its own radius, whatever the sliders say.
  const z = deep > 0.5 ? Math.max(size * deep, size - r * 0.45) : size * deep;
  const put = (geo, rot) => {
    const m = new THREE.Mesh(geo, mats.pupil);
    m.position.set(0, 0, z);
    if (rot !== undefined) m.rotation.z = rot;
    pivot.add(m);
    return m;
  };

  if (p.pupilShape === 'slit' || p.pupilShape === 'goat') {
    const bar = new THREE.CapsuleGeometry(r * 0.42, size * 1.15, 2, 6);
    const m = put(bar, p.pupilShape === 'goat' ? Math.PI / 2 : 0);
    m.scale.z = 0.4;
    return;
  }
  if (p.pupilShape === 'cross') {
    const bar = new THREE.CapsuleGeometry(r * 0.34, size * 1.1, 2, 6);
    put(bar, 0).scale.z = 0.4;
    put(bar, Math.PI / 2).scale.z = 0.4;
    return;
  }
  if (p.pupilShape === 'ring') {
    const ring = new THREE.TorusGeometry(r * 0.9, r * 0.32, 5, 12);
    put(ring).scale.z = 0.5;
    return;
  }
  if (p.pupilShape === 'square') {
    put(new THREE.BoxGeometry(r * 1.5, r * 1.5, r * 0.5), (rngRoll() - 0.5) * 0.5);
    return;
  }
  if (p.pupilShape === 'double') {
    // two of them, side by side — the eye never quite looks at you
    for (const dx of [-1, 1]) {
      const m = put(new THREE.SphereGeometry(r * 0.62, 8, 6));
      m.position.x = dx * r * 0.7;
      m.position.z = z * 0.97;
    }
    return;
  }
  put(new THREE.SphereGeometry(r, 10, 8));
}

/** A heavy lid dropping over the top of the eye. */
function addLid(pivot, p, mats, size, S) {
  if (p.eyeLid <= 0.02) return;
  // A cap around the eyeball's own +Y pole, reaching 0.42pi (75.6 degrees) down
  // from it, then tipped forward over the front of the ball.
  const lidGeo = new THREE.SphereGeometry(size * 1.06, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
  const lid = new THREE.Mesh(lidGeo, mats.skin);
  // How far the cap is tipped is the whole of what the slider means, and it was
  // running backwards — and off the end. At `eyeLid` barely above zero the cap
  // was tipped 88 degrees, which points its pole STRAIGHT AT THE CAMERA: the
  // rim came round to 163 degrees from the top of the ball and the lid covered
  // the entire eye, in skin colour, so the creature read as having two blank
  // lumps where its eyes are. A full lid, meanwhile, tipped only 14 degrees and
  // came out as the light hood that no lid at all should have been.
  //
  // Now the tip runs the right way and stops where a lid stops. At the bottom
  // of the slider the cap is tucked back behind the crown of the eye and shows
  // as a thin hood; at the top it reaches a little past the eye's middle, which
  // is heavy-lidded and still an eye.
  lid.rotation.x = Math.PI * (-0.1 + 0.26 * p.eyeLid);
  withOutline(pivot, lid, lidGeo, p.outline * 0.35 * S, mats.outline);
}

/**
 * Every eye lives in its own pivot group: the eyeball, its outline shell, the
 * pupil and the lid are children, so blinking and looking around move them
 * together. The outline is a separate mesh (see withOutline), so animating a
 * bare eyeball would leave its own outline behind.
 * Stalk eyes get a second pivot at the root of the stalk for the animator.
 * Returns the pivots so the animator can drive them.
 */
export function addEyes(parent, headMesh, p, mats, rng) {
  const L = faceLimits(p);
  const S = L.S;
  const headR = headRadius(p);
  const baseSize = p.eyeSize * S;
  // Keep eyes off the two things already on the face. "cluster" and "scatter"
  // otherwise plant an eyeball straight into the teeth on a regular basis, and
  // a low eye near the midline ends up sitting on the nose.
  // The clearance has to cover the eye's own radius, not just its centre: a
  // margin of less than one radius leaves the bottom of the eyeball sitting in
  // the teeth, which is what it looked like. Jitter can grow an eye by half
  // again, so the margin carries that too.
  const clear = baseSize * (1.35 + p.eyeJitter * 0.4);

  // Every eye is settled BEFORE any of them is built: its slot, its own size,
  // its own jitter and the slide that lopsidedness gives it. The layouts place
  // each eye without reference to the others or to the edge of the skull, so
  // half of all faces came out with two eyeballs inside one another and a fifth
  // with an eye sliced flat on the silhouette — and neither can be seen from
  // inside the loop that builds them one at a time.
  const plan = eyePositions(p, rng).map(([x, y]) => {
    // The floor is the mouth and the nose — the things an eye may not be
    // pushed down onto. It used to be the eye's OWN height, which meant an eye
    // the layout had put high on the skull could never be moved down again:
    // two eyes stacked on a narrow crown had the head's width against them
    // sideways and their own starting height against them downwards, so they
    // stayed inside one another however small they were shrunk.
    let floor = L.mouthTop + clear;
    const onMidline = Math.abs(x) < L.noseHalfW + baseSize * 0.55;
    if (onMidline) floor = Math.max(floor, L.noseTop + clear * 0.75);
    const out = Math.max(y, floor);
    // ...and the bare top of the mouth, so the clearance can be recomputed from
    // whatever the eye's size ends up being rather than from the size it was
    // planned at. An eye that gives up half its radius needs half the room.
    const bare = onMidline ? Math.max(L.mouthTop, L.noseTop) : L.mouthTop;
    // No two eyes on one face are quite the same once mismatch is up — not just
    // in size, but in how far each one stands out and how wide its pupil is.
    const size = baseSize * (1 + (rng() * 2 - 1) * p.eyeJitter * 0.55);
    const bulge = THREE.MathUtils.clamp(p.eyeBulge + (rng() * 2 - 1) * p.eyeJitter * 0.35, 0, 1);
    const pupilSize = THREE.MathUtils.clamp(p.pupilSize * (1 + (rng() * 2 - 1) * p.eyeJitter * 0.5), 0.08, 0.98);
    const [fx, fy, fs] = EYE_FOOTPRINT[p.eyeStyle] ?? [1, 1, 0.15];
    return {
      // lopsidedness slides each eye off its neat layout slot
      x: x + (rng() * 2 - 1) * p.lopsided * p.headWidth * 0.16,
      y: out + (rng() * 2 - 1) * p.lopsided * p.headHeight * 0.13,
      size,
      rx: size * fx,
      ry: size * fy,
      stand: size * fs,
      bulge,
      pupilSize,
      floor,
      bare,
    };
  });
  settleEyes(p, plan, L, clear, headMesh);

  const eyes = [];

  for (const e of plan) {
    const { size, x, y, bulge } = e;
    const q = { ...p, eyeBulge: bulge, pupilSize: e.pupilSize };
    const hit = surfaceAt(headMesh, p, x, y);
    const pivot = new THREE.Group();
    // where settleEyes decided this eye goes, kept so tools/face-sweep.mjs can
    // tell a layout that could not be settled from a style that moved the ball
    // afterwards
    pivot.userData.eyePlan = { x, y, size };
    let stalk = null;

    if (p.eyeStyle === 'hole') {
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size, ry: size * 1.15, offset: 0.01, rings: 2, segs: 16,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));

      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, seatOut(p, hit, size * 0.18, size)), hit.normal);
      pivot.add(new THREE.Mesh(new THREE.SphereGeometry(size * 0.34 * (0.5 + q.pupilSize), 8, 6), mats.eye));
    } else if (p.eyeStyle === 'bead') {
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.25, ry: size * 1.25, offset: 0.008, rings: 2, segs: 16,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));

      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, seatOut(p, hit, size * 0.3 * bulge, size * 0.55)), hit.normal);
      const beadGeo = new THREE.SphereGeometry(size * 0.55, 10, 8);
      withOutline(pivot, new THREE.Mesh(beadGeo, mats.pupil), beadGeo, p.outline * 0.6 * S, mats.outline);
    } else if (p.eyeStyle === 'stalk') {
      // The eyeball rides at the end of a stalk growing out of the skull —
      // FORWARD, not along the skin. A stalk that followed the normal carried
      // its eye a whole head-width sideways off the temple, which is where the
      // eyes hanging past the silhouette were coming from: the eye was settled
      // on the skin and then walked off the edge of the head by its own stalk.
      //
      // Short and thick, too. At the resolution this renders at a thin stalk is
      // half a pixel wide and disappears, and what is left is an eyeball
      // floating in front of the face with a black gap behind it.
      let len = size * (1.15 + bulge * 1.35);
      const grow = _sd.copy(hit.normal).add(FORWARD).add(FORWARD).normalize().clone();
      // and walked back until the ball at the end of it is still over the head.
      // The settler reserves room for a stalk of average reach; this is the one
      // that got the reach it actually rolled.
      for (let k = 0; k < 8; k++) {
        const by = hit.point.y + grow.y * len;
        const half = silhouetteAt(p, by);
        if (half > 0 && Math.abs(hit.point.x + grow.x * len) + size * 0.44 <= half) break;
        len *= 0.72;
      }
      stalk = new THREE.Group();
      orientTo(stalk, hit.point, grow);
      parent.add(stalk);

      const stalkGeo = new THREE.CylinderGeometry(size * 0.34, size * 0.46, len, 6);
      const tube = new THREE.Mesh(stalkGeo, mats.growth);
      tube.rotation.x = Math.PI / 2; // grow along the stalk's +Z
      tube.position.set(0, 0, len * 0.5);
      withOutline(stalk, tube, stalkGeo, p.outline * 0.4 * S, mats.outline);

      pivot.position.set(0, 0, len);
      stalk.add(pivot);

      const ballGeo = new THREE.SphereGeometry(size * 0.8, 12, 10);
      withOutline(pivot, new THREE.Mesh(ballGeo, mats.eye), ballGeo, p.outline * 0.6 * S, mats.outline);
      addPupil(pivot, q, mats, size * 0.8);
      addLid(pivot, q, mats, size * 0.8, S);

      eyes.push({ pivot, stalk, kind: 'stalk', base: pivot.position.clone(), size: size * 0.8 });
      continue;
    } else if (p.eyeStyle === 'compound') {
      // an insect's eye: a dark dome studded with facets, no pupil at all
      const rim = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.5, ry: size * 1.5, offset: 0.02, rings: 3, segs: 14,
      });
      parent.add(new THREE.Mesh(rim, mats.socket));
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, seatOut(p, hit, size * (bulge - 0.5), size)), hit.normal);
      const domeGeo = new THREE.SphereGeometry(size, 10, 8);
      withOutline(pivot, new THREE.Mesh(domeGeo, mats.pupil), domeGeo, p.outline * 0.7 * S, mats.outline);

      const facetGeo = new THREE.SphereGeometry(size * 0.26, 6, 5);
      const facets = new THREE.InstancedMesh(facetGeo, mats.eye, 14);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < 14; i++) {
        // a spiral over the front of the dome, so the facets never line up
        const k = (i + 0.5) / 14;
        const phi = Math.acos(1 - k * 0.75);
        const theta = i * 2.399; // the golden angle: an even scatter, no lattice
        m4.makeTranslation(
          Math.sin(phi) * Math.cos(theta) * size * 0.88,
          Math.sin(phi) * Math.sin(theta) * size * 0.88,
          Math.cos(phi) * size * 0.88,
        );
        facets.setMatrixAt(i, m4);
      }
      pivot.add(facets);
    } else if (p.eyeStyle === 'pit') {
      // a shaft into the skull with a spark at the bottom of it
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.2, ry: size * 1.2, offset: 0.006, rings: 3, segs: 16,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, -size * 0.5), hit.normal);
      const wellGeo = new THREE.SphereGeometry(size * 0.95, 10, 8);
      pivot.add(new THREE.Mesh(wellGeo, mats.cavity));
      const spark = new THREE.Mesh(new THREE.SphereGeometry(size * 0.24, 7, 6), mats.pupil);
      spark.position.z = size * 0.55;
      pivot.add(spark);
    } else if (p.eyeStyle === 'bulb') {
      // a fat lamp standing proud of the face on no stalk at all
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, seatOut(p, hit, size * 0.55, size * 1.15)), hit.normal);
      const bulbGeo = warpGeometry(new THREE.SphereGeometry(size * 1.15, 11, 9), rng(), warpRoll(p, rng, 0.5));
      withOutline(pivot, new THREE.Mesh(bulbGeo, mats.eye), bulbGeo, p.outline * 0.6 * S, mats.outline);
      addPupil(pivot, q, mats, size * 1.15);
    } else if (p.eyeStyle === 'cluster') {
      // several small eyes crowded into one socket, all looking slightly apart
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.35, ry: size * 1.25, offset: 0.008, rings: 3, segs: 16,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, seatOut(p, hit, size * 0.1, size)), hit.normal);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.5;
        const r = size * 0.42;
        const g = new THREE.SphereGeometry(r, 8, 6);
        const b = new THREE.Mesh(g, mats.eye);
        b.position.set(Math.cos(a) * size * 0.55, Math.sin(a) * size * 0.5, size * 0.1);
        withOutline(pivot, b, g, p.outline * 0.35 * S, mats.outline);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(r * 0.45, 6, 5), mats.pupil);
        dot.position.copy(b.position);
        dot.position.z += r * 0.75;
        pivot.add(dot);
      }
    } else if (p.eyeStyle === 'visor') {
      // one wide band across the face instead of an eye
      const band = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 2.4, ry: size * 0.62, offset: 0.01, rings: 2, segs: 20,
      });
      parent.add(new THREE.Mesh(band, mats.socket));
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, seatOut(p, hit, size * 0.12, size)), hit.normal);
      const glassGeo = new THREE.SphereGeometry(size, 11, 8);
      const glass = new THREE.Mesh(glassGeo, mats.eye);
      glass.scale.set(2.1, 0.5, 0.45);
      withOutline(pivot, glass, glassGeo, p.outline * 0.4 * S, mats.outline);
      addPupil(pivot, q, mats, size * 0.5);
    } else if (p.eyeStyle === 'crystal') {
      // a faceted lump of glass rather than a ball
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, seatOut(p, hit, size * (bulge - 0.35), size * 1.05)), hit.normal);
      const crysGeo = warpGeometry(new THREE.IcosahedronGeometry(size * 1.05, 0), rng(), warpRoll(p, rng, 0.5));
      withOutline(pivot, new THREE.Mesh(crysGeo, mats.eye), crysGeo, p.outline * 0.5 * S, mats.outline);
      addPupil(pivot, q, mats, size * 0.85);
    } else if (p.eyeStyle === 'ring') {
      // an annulus with the skull showing through the middle
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, seatOut(p, hit, size * 0.15, size)), hit.normal);
      const torGeo = new THREE.TorusGeometry(size * 0.78, size * 0.34, 6, 16);
      withOutline(pivot, new THREE.Mesh(torGeo, mats.eye), torGeo, p.outline * 0.4 * S, mats.outline);
      const hole = new THREE.Mesh(new THREE.SphereGeometry(size * 0.46, 8, 6), mats.pupil);
      hole.position.z = -size * 0.05;
      pivot.add(hole);
    } else if (p.eyeStyle === 'bloom') {
      // petals of eyelid around a small wet centre
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, seatOut(p, hit, size * 0.1, size)), hit.normal);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const g = new THREE.ConeGeometry(size * 0.3, size * 1.15, 4);
        const petal = new THREE.Mesh(g, mats.trim);
        petal.position.set(Math.cos(a) * size * 0.6, Math.sin(a) * size * 0.6, size * 0.1);
        petal.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(Math.cos(a), Math.sin(a), 0.55).normalize());
        withOutline(pivot, petal, g, p.outline * 0.3 * S, mats.outline);
      }
      const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.5, 8, 6), mats.eye);
      core.position.z = size * 0.2;
      pivot.add(core);
      addPupil(pivot, q, mats, size * 0.5);
    } else if (p.eyeStyle === 'button') {
      // flat and sewn on, with no depth to it at all
      const patch = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.05, ry: size * 1.05, offset: 0.012, rings: 2, segs: 16,
      });
      parent.add(new THREE.Mesh(patch, mats.eye));
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, size * 0.06), hit.normal);
      addPupil(pivot, q, mats, size * 0.9, 0.12);
    } else if (p.eyeStyle === 'slot') {
      // a rectangular window with something behind it
      const cut = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 0.55, ry: size * 1.4, offset: 0.008, rings: 2, segs: 12,
      });
      parent.add(new THREE.Mesh(cut, mats.cavity));
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, size * 0.02), hit.normal);
      const barGeo = new THREE.BoxGeometry(size * 0.42, size * 0.9, size * 0.3);
      withOutline(pivot, new THREE.Mesh(barGeo, mats.eye), barGeo, p.outline * 0.35 * S, mats.outline);
    } else if (p.eyeStyle === 'dome') {
      // a low glassy blister rather than a ball
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, -size * 0.25), hit.normal);
      const domeGeo = new THREE.SphereGeometry(size * 1.1, 12, 9);
      const dome = new THREE.Mesh(domeGeo, mats.eye);
      dome.scale.z = 0.45;
      withOutline(pivot, dome, domeGeo, p.outline * 0.5 * S, mats.outline);
      addPupil(pivot, q, mats, size * 0.7);
    } else if (p.eyeStyle === 'lantern') {
      // a glowing orb set back in a bony rim
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.15, ry: size * 1.15, offset: 0.008, rings: 2, segs: 16,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));

      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, seatOut(p, hit, size * 0.1, size)), hit.normal);
      const rimGeo = new THREE.TorusGeometry(size * 0.92, size * 0.2, 5, 14);
      withOutline(pivot, new THREE.Mesh(rimGeo, mats.growth), rimGeo, p.outline * 0.4 * S, mats.outline);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(size * 0.62, 10, 8), mats.eye);
      orb.position.z = -size * 0.1;
      pivot.add(orb);
      addPupil(pivot, q, mats, size * 0.62);
    } else if (p.eyeStyle === 'gash') {
      // no eyeball: a torn slit with something wet showing through it
      const slit = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.5, ry: size * 0.42, offset: 0.01, rings: 2, segs: 18,
      });
      parent.add(new THREE.Mesh(slit, mats.socket));

      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, size * 0.02), hit.normal);
      const barGeo = new THREE.CapsuleGeometry(size * 0.2, size * 1.9, 2, 6);
      const bar = new THREE.Mesh(barGeo, mats.eye);
      bar.rotation.z = Math.PI / 2;
      bar.scale.z = 0.35;
      pivot.add(bar);
      addPupil(pivot, q, mats, size * 0.45);
    } else {
      // A ring of darker skin around the eyeball. Without it a pale eye on a
      // pale face is a lump with a dot on it: the black outline is one pixel
      // wide at this resolution and cannot separate the two on its own. The
      // more the eye bulges, the wider the shadow it would cast.
      // A decal is a fan of concentric rings, each raycast onto the skull and
      // pushed out along its normal. Two rings is fine for a small patch and
      // useless for a wide one: the flat triangles between them cut inside the
      // curve of the skull and the middle of the ring is buried. Hence five
      // rings and a bigger lift.
      const r = size * (1.45 + bulge * 0.2);
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: r, ry: r, offset: 0.02, rings: 3, segs: 14,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));

      // ball: sunk into the socket by (1 - bulge)
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, size * (bulge - 0.62)), hit.normal);

      const ballGeo = new THREE.SphereGeometry(size, 12, 10);
      withOutline(pivot, new THREE.Mesh(ballGeo, mats.eye), ballGeo, p.outline * 0.7 * S, mats.outline);
      addPupil(pivot, q, mats, size);
      addLid(pivot, q, mats, size, S);
    }

    // However the style seated itself, an eye may not stand off the head like a
    // headlamp. Every style pushes its ball out by some multiple of its own
    // size, several of them scale that by `bulge`, and at the top of both
    // sliders the result was a lump two thirds of a head deep hanging off the
    // temple — which is the "eyes climbing out of the head" the audit was
    // about. Measured on what was actually built rather than predicted from
    // the numbers that built it, because a warp roll and an outline shell are
    // in the answer and not in the prediction.
    //
    // Sinking it back along its own normal is the whole correction: the eye
    // keeps its size and its socket and simply sits deeper, which is what a
    // less bulging eye looks like anyway.
    pivot.updateMatrixWorld(true);
    let far = 0;
    pivot.traverse((o) => {
      if (!o.isMesh || o.material?.side === THREE.BackSide) return;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 32));
      for (let k = 0; k < pos.count; k += step) {
        _fx.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
        if (_fx.lengthSq() < 1e-9) continue;
        _fd.copy(_fx).normalize();
        headPoint(p, _fd, _fs);
        far = Math.max(far, _fx.length() - _fs.length());
      }
    });
    const cap = headR * 0.32;
    if (far > cap) pivot.position.addScaledVector(hit.normal, -Math.min(far - cap, size * 1.2));

    parent.add(pivot);
    eyes.push({ pivot, stalk, kind: p.eyeStyle, base: pivot.position.clone(), size });
  }

  return eyes;
}

// ------------------------------------------------------------------ MAW ----

// How long each kind runs, against the plain fang. Applied before the cap that
// keeps a tooth inside the mouth it grows from, never after.
const TOOTH_LEN = {
  needles: 1.35, blocks: 0.55, tusks: 1.5, saw: 0.9, chisels: 0.6,
  pegs: 0.5, molars: 0.4, hooks: 1.15, shards: 0.7, spines: 1.7,
  plates: 0.55, combs: 0.95, barbs: 1.2,
};

function addTeeth(parent, headMesh, p, mats, rng, { mw, mh, my, mx = 0, side, count, profile, mawLift = 0.04 }) {
  if (count <= 0) return;
  const S = headUnit(p);
  const headR = headRadius(p);

  const seatFrame = patchFrame(headMesh, p, mx, my, Math.min(mw, mh) * 0.7);
  for (let i = 0; i < count; i++) {
    // wear knocks teeth out of the row
    if (rng() < p.wear * 0.35) continue;
    const t = ((i + 0.5) / count) * 2 - 1;
    const u = mx + t * mw * 0.94;
    // The rim of the maw at this point — whatever shape the maw is, that is
    // where the tooth grows. It used to be the ellipse's own edge, which meant
    // that the moment the mouth stopped being an ellipse the teeth stayed
    // behind on one.
    const edge = mh * (side > 0 ? profile.up(t * 0.94) : -profile.down(t * 0.94));
    // Seated in the maw's own frame on the skin — the same one the cavity band
    // is built in, so the row grows out of the rim it is drawn against rather
    // than off a frontal projection of it that walks inward at the corners.
    //
    // A step across the skin lands where the skin IS, and on a skull that
    // bulges under the corner of a mouth that is further out than the step
    // asked for: the last tooth of the row came out past the rim it grows
    // from, on bare cheek. So the step is pulled in until the tooth it seats
    // is inside the mouth.
    let across = t * mw * 0.94;
    let hit = seatFrame.at(across, side * Math.max(edge, mh * 0.12) * 0.94, _tseat);
    for (let k = 0; k < 3 && Math.abs(across) > 1e-4; k++) {
      const got = Math.abs(hit.point.x - mx) / Math.max(mw, 1e-6);
      if (got <= 0.9) break;
      across *= 0.9 / got;
      hit = seatFrame.at(across, side * Math.max(edge, mh * 0.12) * 0.94, _tseat);
    }

    // A tooth never fills its own slot. At the bottom of the gap slider the
    // blocks met edge to edge and the whole row rendered as one white bar with
    // a couple of seams in it — a mouthguard, not teeth. A sixth of the slot is
    // always air, whatever the slider says.
    let w = ((2 * mw) / count) * (1 - Math.max(0.17, p.toothGap)) * 0.92
      * (1 + (rng() * 2 - 1) * p.toothVary * 0.3);
    // A row of identical spikes is what makes a maw look stamped out. `vary`
    // spreads the lengths — at the top of the slider one mouth holds anything
    // from a stub to a fang three times its neighbour.
    const vary = 1 + (rng() * 2 - 1) * p.toothVary * 0.85;
    let len = mh * (0.7 + 1.7 * p.toothSize) * Math.max(0.18, vary);
    if (rng() < p.toothVary * 0.22) len *= 0.35; // and a few barely came through
    const tip = w * 0.5 * (1 - 0.9 * p.toothJag);

    // Nothing used to compare a tooth's length to the mouth it grows out of.
    // The maw is a decal on a solid skull rather than a hole, so a tooth longer
    // than the opening does not vanish behind a lip — it lies straight across
    // the chin, and at the top of the sliders across the whole face and out
    // through the silhouette. Three quarters of all creatures had one.
    //
    // A fang overhanging the far rim is the look; a rod crossing the face is
    // not. The cap is against the opening, with a floor against the head so a
    // nearly shut maw still gets teeth you can see.
    // Each kind has its own proportions, applied BEFORE the cap — a needle is
    // a third longer than a fang and a tusk half again, and applying those
    // afterwards let both walk straight back out through it.
    const kindLen = TOOTH_LEN[p.toothType] ?? 1;
    // The cap is against the opening AT THIS TOOTH, read off the profile —
    // not against the `mh` parameter. A slit's profile squeezes the visible
    // opening to a quarter of `mh`, and teeth capped by the parameter came out
    // ten times the height of the mouth they grew from: a beard of white
    // needles hanging under a shut mouth.
    const span = (profile.up(t * 0.94) - profile.down(t * 0.94)) * mh;
    len = Math.min(len * kindLen, Math.max(span * 1.35, mh * 0.4));
    // ...and against the HEAD, which the mouth's own opening says nothing about.
    // A `gape` is two and a half mouth-heights tall, so a cap of a third more
    // than the opening let one tooth come out longer than the skull's radius —
    // a bone rod out of the face, which is what it looked like.
    len = Math.min(len, headR * 0.45);
    // A tooth is a tooth, not a wall. One tooth in a row makes the slot the
    // whole mouth, and a saw blade cut to that slot filled the maw with a
    // single bone triangle — which read as a wedge of bare skin hanging into
    // the mouth, since bone and a pale skull share a colour. Two caps: never
    // wider than it is long, and never wider than a third of the mouth,
    // whatever the count slider says.
    // ...and `w` is a SLOT width the kinds cut radii from — a saw's radius is
    // 0.55*w, so its on-screen width is 1.1*w. Capping the slot at 0.3 of the
    // mouth keeps even a single tooth to a third of the maw.
    w = Math.min(w, Math.max(len * 1.1, mh * 0.5), mw * 0.3);

    // A tooth grows tip-first from the rim: whatever the kind, the narrow end
    // has to point into the maw, which flips with the row.
    let geo;
    let flat = 0.7;
    let curl = 0;
    // A cylinder's radiusTop is at its +Y end, and +Y is up in the frame the
    // tooth is planted in — so a tooth written wide-at-the-top is wide at the
    // top of BOTH rows, which on the bottom row means the fat end pointing into
    // the mouth and the point buried in the jaw. Only the fangs ever flipped;
    // needles and tusks grew upside down along the whole bottom row.
    const wideEnd = side > 0 ? 0 : 1;   // top row tapers downward, bottom up
    // Whatever the kind asks for, a tooth is at least this thick. The thin
    // kinds take a sixth of a slot, and a sixth of a slot in a small mouth is
    // one pixel at the resolution this renders at — a mouth full of needles
    // came out as a handful of white scratches. A needle that is two pixels
    // wide is still a needle.
    const thick = (r) => Math.max(r, S * 0.017);
    const taperTo = (fat, thin) => (wideEnd
      ? new THREE.CylinderGeometry(thick(thin), thick(fat), len, 5)
      : new THREE.CylinderGeometry(thick(fat), thick(thin), len, 5));

    switch (p.toothType) {
      case 'needles':
        // A sixth of the slot wide is a single pixel at the resolution this
        // renders at, and a row of them read as a barcode rather than as teeth.
        // A third is still a needle and is still there when the dust settles.
        geo = taperTo(w * 0.32, w * 0.12);
        flat = 1;
        break;
      case 'blocks':
        geo = new THREE.BoxGeometry(thick(w * 0.4) * 2, len, thick(w * 0.4) * 2);
        flat = 1;
        break;
      case 'tusks':
        // Tusks sweep up and out of the mouth — AT THE CORNERS, which is where
        // a boar keeps them. Written as one curl for the whole row, a centre
        // tusk swept across the middle of the face and read as a rod lying on
        // it: a tooth's curl and its reach both grow towards the corners, so
        // the middle of the row bites straight and only the corners climb.
        len *= 0.55 + 0.5 * Math.abs(t);   // before the geometry reads it
        geo = taperTo(w * 0.42, w * 0.1);
        flat = 0.9;
        curl = -side * (0.12 + 0.6 * Math.abs(t));
        break;
      case 'saw':
        // a flat triangular blade, edge-on to the face: a shark's row
        geo = taperTo(w * 0.55, w * 0.02);
        flat = 0.32;
        break;
      case 'chisels':
        // broad flat blades, square across the top
        geo = new THREE.BoxGeometry(thick(w * 0.46) * 2, len, thick(w * 0.15) * 2);
        flat = 1;
        break;
      case 'pegs':
        // blunt stubs, no point on them at all
        geo = new THREE.CylinderGeometry(thick(w * 0.38), thick(w * 0.38), len, 7);
        flat = 0.9;
        break;
      case 'molars':
        // low, wide and rounded: something that grinds rather than tears
        geo = new THREE.SphereGeometry(thick(w * 0.5), 7, 5);
        flat = 1;
        break;
      case 'hooks':
        // curved back into the throat, so nothing that goes in comes out
        geo = taperTo(w * 0.45, w * 0.06);
        curl = side * 0.85;
        flat = 0.6;
        break;
      case 'shards':
        // broken glass rather than teeth — no two the same, all angular
        geo = new THREE.IcosahedronGeometry(thick(w * 0.5), 0);
        flat = 0.55;
        break;
      case 'spines':
        // long thin quills, further out than a needle and half as thick
        geo = taperTo(w * 0.2, w * 0.03);
        flat = 1;
        break;
      case 'plates':
        // a solid wall with seams in it, like a beak cut into segments
        geo = new THREE.BoxGeometry(thick(w * 0.49) * 2, len, thick(w * 0.27) * 2);
        flat = 1;
        break;
      case 'combs':
        // a fringe rather than a row: very thin, very many, barely tapered
        geo = taperTo(w * 0.16, w * 0.08);
        flat = 1;
        break;
      case 'barbs':
        // a spike with the point swept back the wrong way
        geo = taperTo(w * 0.36, w * 0.05);
        curl = -side * 1.15;
        flat = 0.75;
        break;
      default: // fangs
        geo = taperTo(w * 0.5, tip);
    }

    // Planted upright rather than along the skin — see orientUpright. A tooth
    // grows out of the mouth's own vertical, and the only thing allowed to
    // lean it sideways is the splay below, which is symmetric about the middle
    // of the row the way a jaw is.
    const frame = new THREE.Group();
    // A tooth planted on the rim grows along the TANGENT plane there, and a
    // tangent line leaves a curved skull the instant it starts: the far end of
    // a straight tooth stands out of the face by about its own length squared
    // over twice the head's radius — a quarter of a radius on a wide mouth.
    // That is the row of white rods hanging off the cheek from three quarters
    // on, and it was every kind of tooth, not only the two that curl, which is
    // why nothing aimed at the curl ever moved the number.
    //
    // So the tooth is laid along the CHORD instead: pitched inward by half the
    // arc it spans, both ends land back on the skin and only its middle dips
    // under, by an eighth of the same quantity. Lifting it by that much again
    // floats the whole rod a hair above the skull all along its length —
    // visible everywhere, out through the outline nowhere.
    let pitch = len / (2 * headR);
    const sag = (len * len) / (8 * headR);
    const pose = () => {
      orientUpright(frame, hit.point, hit.normal);
      frame.rotateX(side * pitch);
      // A jaw's corner teeth lean IN, towards the middle of the bite. Leaning
      // them out is the other half of a tooth ending up on a cheek.
      frame.rotateZ(-t * side * 0.16);
      frame.updateMatrix();
    };
    pose();

    // A tooth hangs from its ROOT. Curling it about the middle of the rod
    // swung the gum end out of the face as far as the sweep carried the point
    // in — a hook's root stood a quarter of a radius clear of the cheek while
    // its tip sat obediently inside the mouth, which is the half the old
    // walk-back never looked at because it only ever measured the tip.
    // What has to clear the cavity is the tooth's OUTER face, not its axis: a
    // rod lying in the mouth is as thick as it is, and standing its centre line
    // over the cavity stands its whole diameter over it. So the axis is sunk by
    // the tooth's own half-thickness — the far side of it beds into the gum,
    // which is where the far side of a tooth belongs.
    const gp = geo.attributes.position;
    let half = 0;
    for (let k = 0; k < gp.count; k++) half = Math.max(half, Math.abs(gp.getZ(k)));
    half *= flat;
    const clear = sag + mawLift + 0.02 * S;

    const stem = new THREE.Group();
    // ...standing off the skin far enough to draw in front of the cavity, which
    // is a decal on its own measured lift. Under it the row disappears into the
    // dark and the mouth reads as an empty hole.
    stem.position.z = Math.max(clear * 0.35, clear - half);
    if (curl) stem.rotation.x = curl;
    frame.add(stem);

    const tooth = new THREE.Mesh(geo, mats.tooth);
    tooth.position.y = -side * len * 0.45;
    tooth.scale.z = flat;
    tooth.updateMatrix();

    // A curled tooth sweeps forward, and at the corner of a wide mouth
    // "forward" is half sideways: the skin's normal there leans a good way out
    // in x, so a barb swept a third of its length forward came out over the
    // cheek. This walks the sweep back until the point is inside the mouth it
    // grows from. Straight teeth never enter the loop.
    if (curl) {
      for (let k = 0; k < 8; k++) {
        stem.updateMatrix();
        _tip.set(0, -side * len * 0.5, 0)
          .applyMatrix4(tooth.matrix).applyMatrix4(stem.matrix).applyMatrix4(frame.matrix);
        if (Math.abs((_tip.x - mx) / Math.max(mw, 1e-6)) <= 1) break;
        stem.rotation.x *= 0.7;
      }
    }

    // ...and now the whole tooth, both end rings and the length between them,
    // is measured against the DRAWN skull — by raycast along each point's own
    // ray out of the head, because the analytic surface and the mesh part
    // company by a fifth of a radius on a lumpy head and it is the mesh the
    // outline is cut from. A skull is not a sphere, so the chord above is only
    // the first guess; what it leaves over is pitched in, and what pitching
    // cannot reach is taken out of the tooth's length, never out of its lift.
    const tp = geo.attributes.position;
    const tstep = Math.max(1, Math.floor(tp.count / 14));
    const proud = () => {
      stem.updateMatrix();
      tooth.updateMatrix();
      let worst = 0;
      for (let k = 0; k < tp.count; k += tstep) {
        _tip.fromBufferAttribute(tp, k)
          .applyMatrix4(tooth.matrix).applyMatrix4(stem.matrix).applyMatrix4(frame.matrix);
        if (_tip.lengthSq() < 1e-9) continue;
        surfaceRadial(headMesh, _tip, _thit, p);
        worst = Math.max(worst, _tip.length() - _thit.point.length());
      }
      return worst;
    };
    // What the tooth is allowed to stand proud of the skin: the height it needs
    // to draw over the cavity at all, and a little for the bite. Everything
    // above that is a rod hanging in the air from three quarters on.
    const outCap = clear + headR * 0.015;
    for (let k = 0; k < 6; k++) {
      const out = proud();
      if (out <= outCap) break;
      if (k < 3) {
        // the far end swings in by len*sin(dθ), so this is the angle that
        // would land it, damped because the near end swings the other way
        pitch = Math.min(1.2, pitch + Math.asin(Math.min(0.9, (out - outCap) / Math.max(len, 1e-3))) * 0.7 + 0.04);
        pose();
      } else {
        const f = Math.max(0.45, 1 - (out - outCap) / Math.max(len, 1e-3));
        tooth.scale.y *= f;
        tooth.position.y *= f;
      }
    }
    // tagged so tools/face-sweep.mjs can pick the teeth out of a head full of
    // horns and warts built from the same primitives
    tooth.userData.tooth = { len: len * tooth.scale.y, side };
    withOutline(stem, tooth, geo, p.outline * 0.45 * S, mats.outline);
    // ...after both of the mouth's decals, tooth and ink alike. Within the one
    // order they still sort by depth against each other and against the skull,
    // which is what keeps a tooth behind a lip that overhangs it.
    frame.traverse((o) => { o.renderOrder = 3; });
    // The jaw group hangs at the hinge, so its children are stored relative
    // to it — otherwise chewing would swing them around the head's origin.
    frame.position.sub(parent.position);
    parent.add(frame);
  }
}

/**
 * The mouth, pulled in until the mouth that gets BUILT is on the face.
 *
 * mawBox solves the same question analytically, against the frontal outline of
 * the skull — and the band is no longer laid out frontally: it is laid out in
 * its own frame on the skin (see patchFrame), where a step down from a mouth
 * on a heavy jaw follows the jaw round, and a step sideways lands wherever the
 * skin is along that ray, which on a lumpy skull can be most of a radius
 * further out than the step asked for. Neither is visible to a solve that only
 * knows the parameters.
 *
 * So the rim is walked where it will actually be, and the mouth gives up
 * opening and then width until none of it is under the chin or past the cheek.
 * Six probes a step, a dozen steps at worst: the cost of a mouth on the face.
 */
function fitMaw(headMesh, p, box) {
  const grow = 1 + Math.max(0, p.lips);
  const chinY = headPoint(p, _fd.set(0, -1, 0), _fs).y;
  const edge = (p.headHeight + p.headWidth) * 0.03;
  let { mx, my, mw, mh } = box;
  for (let k = 0; k < 10; k++) {
    const frame = patchFrame(headMesh, p, mx, my, Math.min(mw, mh) * 0.7);
    const rx = mw * grow;
    const ry = mh * grow * 1.25;
    let under = 0;
    let past = 0;
    // at the same thirty columns the band is built on, so nothing between two
    // probes can be the thing that hangs off the chin
    for (let i = 0; i <= 30; i++) {
      const u = -1 + i / 15;
      for (const y of [box.profile.up(u) * ry, box.profile.down(u) * ry]) {
        const v = frame.at(u * rx, y).point;
        if (v.y < chinY + edge) under = Math.max(under, chinY + edge - v.y);
        const half = headHalfWidth(p, v.y);
        if (half > 0 && Math.abs(v.x) > half * 0.93) past = Math.max(past, Math.abs(v.x) - half * 0.93);
      }
    }
    if (under <= 1e-3 && past <= 1e-3) break;
    // A mouth that hangs under the chin is first LIFTED — moving it costs the
    // creature nothing, shrinking it costs the creature its mouth — and only
    // what lifting cannot reach comes out of the opening.
    if (under > 1e-3) {
      const lift = Math.min(under, mh * 0.35);
      my += lift;
      if (under - lift > 1e-3) mh *= 0.85;
    }
    if (past > 1e-3) mw *= 0.88;
  }
  return { ...box, mx, my, mw, mh };
}

export function addMouth(parent, headMesh, p, mats, rng) {
  // a crooked maw sits off centre and off level — and, whatever it rolls, on
  // the face rather than round the side or under the chin. See mawBox.
  const skew = (rng() * 2 - 1) * p.lopsided;
  const { mx, my, mw, mh } = fitMaw(headMesh, p, mawBox(p, skew));

  // The shape the mouth is cut in — see maw.js. Every part of the mouth reads
  // the same two curves, so the lips, the hole and both rows of teeth agree
  // about where the rim is even when it is a zigzag.
  //
  // Both patches are BANDS between the two curves, never fans about a centre:
  // five of the shapes do not contain their own centre — a grin's corners are
  // hauled above its middle, a crescent lies below it entirely — and a fan on
  // those collapses through a point outside the mouth, painting a dark wedge
  // from the corner towards the middle of the face.
  //
  // The lips are not a ring: they are the same shape a size larger, laid UNDER
  // the cavity — the cavity's offset stands it off the skin further, so the lip
  // colour shows only as the border around it.
  const profile = mawProfile(p.mawShape);

  if (p.lips > 0.01) {
    const grow = 1 + p.lips;
    const lips = bandGeometry(headMesh, p, {
      cx: mx, cy: my, rx: mw * grow, ry: mh * grow * 1.25,
      up: profile.up, down: profile.down, offset: 0.018, cols: 22, rows: 9,
    });
    const lipMesh = new THREE.Mesh(lips, mats.lip);
    lipMesh.userData.maw = true;
    // The three things in a mouth are drawn in a fixed order — lip, then the
    // dark, then the teeth — and the two decals do not write depth, so that
    // order is the whole of the answer. Left to a depth bias it changed as the
    // creature turned: see mats.lip.
    lipMesh.renderOrder = 1;
    parent.add(lipMesh);
  }

  // Dense in BOTH directions, and standing further off the skin than feels
  // necessary: the band's quads are straight lines between samples, and on a
  // lumpy skull a straight line between two points of skin passes UNDER the
  // bump between them — which put a wedge of bare skin through the middle of
  // the mouth. Rows cost almost nothing; a hole in the face costs the creature.
  // The cavity keeps its own honest lift and wins the ordering on depth instead
  // — see mats.maw. Asking for a lift above the LIP'S worst point meant one bad
  // quad anywhere on the lip stood the whole dark of the mouth off the face,
  // and the seating sweep put the maw at the top of its blame list for it.
  // The offset is what the cavity stands off the skin BEFORE its own measured
  // sag is added, and everything in the mouth has to be stacked on top of it —
  // so it buys its way out of the outline. It is now only a hair above the
  // lip's, because the cavity wins the ordering against the lip on depth
  // rather than on height (see mats.maw), and because the sag it is measured
  // against is honest since the band stopped sampling itself frontally.
  const cavity = bandGeometry(headMesh, p, {
    cx: mx, cy: my, rx: mw, ry: mh,
    up: profile.up, down: profile.down, offset: 0.026, cols: 22, rows: 10,
  });
  const cavityMesh = new THREE.Mesh(cavity, mats.maw);
  cavityMesh.userData.maw = true;
  cavityMesh.renderOrder = 2;
  parent.add(cavityMesh);

  // The cavity and the lips are decals glued to the skull — moving them would
  // peel them off. Only the lower row of teeth swings, on a hinge sitting
  // behind and below the maw.
  const jaw = new THREE.Group();
  jaw.position.set(mx, my - mh * 0.2, -p.headDepth * 0.35);
  parent.add(jaw);

  // The teeth have to draw in front of the cavity, and the cavity is a decal
  // standing off the skin on a lift it measured for itself — so they are given
  // that number rather than a guess at it.
  const mawLift = cavity.userData.lift ?? 0.04;
  addTeeth(parent, headMesh, p, mats, rng, { mw, mh, my, mx, side: 1, count: p.teethTop, profile, mawLift });
  addTeeth(jaw, headMesh, p, mats, rng, { mw, mh, my, mx, side: -1, count: p.teethBottom, profile, mawLift });

  // The maw's own ellipse, reported so it can be checked afterwards. Where the
  // mouth ended up depends on a roll of `lopsided`, so nothing outside this
  // function can work it out again.
  const reach = mawExtent(profile);
  return { jaw, maw: { mx, my, mw, mh, hi: reach.hi, lo: reach.lo } };
}

// ----------------------------------------------------------------- NOSE ----

/**
 * Everything the nose is made of goes into one group, so that every mesh in it
 * can be tagged in one place. Tagging them one branch at a time meant the
 * measuring tools only ever saw the plain bump — the trunk, the ridge, the
 * rosette and every nostril were invisible to them, and the room the face
 * reserves for a nose was set from a sample that left most noses out.
 */
export function addNose(parent, headMesh, p, mats, rng) {
  const nose = new THREE.Group();
  buildNose(nose, headMesh, p, mats, rng);
  nose.traverse((o) => {
    if (o.isMesh && o.material?.side !== THREE.BackSide) o.userData.nose = true;
  });
  parent.add(nose);
}

function buildNose(parent, headMesh, p, mats, rng) {
  if (p.noseType === 'none') return;
  const L = faceLimits(p);
  const S = L.S;
  const ny = L.noseY;   // already lifted clear of the maw
  const size = L.noseSize;
  // Every bump used to be the same oval. Give this one its own proportions:
  // wide and flat, or narrow and long, or pushed out from the face.
  const wide = 0.65 + rng() * 0.95;
  const tall = 0.65 + rng() * 0.95;
  const deep = 0.7 + rng() * 0.9;

  if (p.noseType === 'holes') {
    for (const dx of [-1, 1]) {
      const hole = decalGeometry(headMesh, p, {
        cx: dx * size * 0.7, cy: ny, rx: size * 0.42, ry: size * 0.62, offset: 0.008, rings: 2, segs: 12,
      });
      parent.add(new THREE.Mesh(hole, mats.cavity));
    }
    return;
  }

  const hit = surfaceAt(headMesh, p, 0, ny);
  const frame = new THREE.Group();
  orientTo(frame, hit.point, hit.normal);

  if (p.noseType === 'tusks') {
    // not a nose so much as what grows either side of one
    for (const dx of [-1, 1]) {
      const h = surfaceAt(headMesh, p, dx * size * 0.9, ny);
      const f = new THREE.Group();
      orientTo(f, h.point, h.normal);
      const g = warpGeometry(new THREE.ConeGeometry(size * 0.34, size * 3.2, 6, 3),
        rng(), warpRoll(p, rng, 0.8));
      const tusk = new THREE.Mesh(g, mats.tooth);
      tusk.rotation.x = Math.PI * 0.34;   // up and out of the face
      tusk.rotation.z = dx * 0.3;
      tusk.position.set(0, size * 1.1, size * 1.1);
      withOutline(f, tusk, g, p.outline * 0.5 * S, mats.outline);
      parent.add(f);
    }
    return;
  }

  if (p.noseType === 'trunk') {
    // a heavy hanging tube, built from segments so it can droop
    const h = surfaceAt(headMesh, p, 0, ny);
    const frame = new THREE.Group();
    orientTo(frame, h.point, h.normal);
    const links = 5;
    for (let i = 0; i < links; i++) {
      const k = i / (links - 1);
      const r = size * (0.85 - k * 0.45);
      const g = warpGeometry(new THREE.SphereGeometry(r, 9, 7), rng(), warpRoll(p, rng, 0.7));
      const seg = new THREE.Mesh(g, mats.trim);
      // Out along the normal first, then increasingly down — and further out
      // than feels necessary, or it hangs flat against the face and reads as a
      // line drawn through the teeth rather than as a trunk in front of them.
      seg.position.set(0, -k * k * size * 2.5, size * (0.4 + k * 2.3 - k * k * 0.5));
      withOutline(frame, seg, g, p.outline * 0.55 * S, mats.outline);
    }
    parent.add(frame);
    return;
  }

  // Proportions alone were never enough: a wide bump and a narrow bump are the
  // same perfect oval at two settings, and every freak that rolled one wore the
  // same nose. The shape itself is knocked out of true — see warp.js.
  const warp = warpRoll(p, rng, p.noseType === 'straw' ? 0.35 : 0.85);
  // Several kinds are not one shape but a few, so they finish here.
  if (p.noseType === 'ridge') {
    // a bony crest running down the middle of the face
    for (let i = 0; i < 5; i++) {
      const k = i / 4;
      const h = surfaceAt(headMesh, p, 0, ny + (0.5 - k) * size * 2.4);
      const f = new THREE.Group();
      orientTo(f, h.point, h.normal);
      const g = warpGeometry(new THREE.SphereGeometry(size * (0.5 - k * 0.22), 9, 7),
        rng(), warpRoll(p, rng, 0.6));
      const seg = new THREE.Mesh(g, mats.trim);
      seg.scale.set(0.7, 1, 1.5);
      seg.position.z = size * 0.25;
      withOutline(f, seg, g, p.outline * 0.5 * S, mats.outline);
      parent.add(f);
    }
    return;
  }
  if (p.noseType === 'slits') {
    // vertical gills either side of the midline, cut into the skin
    for (const dx of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const cut = decalGeometry(headMesh, p, {
          cx: dx * size * (0.5 + i * 0.45), cy: ny,
          rx: size * 0.16, ry: size * 0.9, offset: 0.008, rings: 2, segs: 10,
        });
        parent.add(new THREE.Mesh(cut, mats.cavity));
      }
    }
    return;
  }
  if (p.noseType === 'star') {
    // a rosette of small lobes around a nostril, like something that digs
    const h = surfaceAt(headMesh, p, 0, ny);
    const f = new THREE.Group();
    orientTo(f, h.point, h.normal);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const g = warpGeometry(new THREE.SphereGeometry(size * 0.3, 8, 6), rng(), warpRoll(p, rng, 0.7));
      const lobe = new THREE.Mesh(g, mats.trim);
      lobe.scale.set(0.55, 1.25, 0.5);
      lobe.position.set(Math.cos(a) * size * 0.6, Math.sin(a) * size * 0.6, size * 0.3);
      lobe.rotation.z = a - Math.PI / 2;
      withOutline(f, lobe, g, p.outline * 0.4 * S, mats.outline);
    }
    parent.add(f);
    return;
  }
  if (p.noseType === 'double') {
    // two bumps where one would do
    for (const dx of [-1, 1]) {
      const h = surfaceAt(headMesh, p, dx * size * 0.55, ny);
      const f = new THREE.Group();
      orientTo(f, h.point, h.normal);
      const g = warpGeometry(new THREE.SphereGeometry(size * 0.62, 10, 8), rng(), warpRoll(p, rng));
      const bump = new THREE.Mesh(g, mats.trim);
      bump.scale.set(wide, tall, deep * 1.1);
      withOutline(f, bump, g, p.outline * 0.6 * S, mats.outline);
      parent.add(f);
    }
    return;
  }

  let geo;
  let mesh;
  if (p.noseType === 'pig') {
    // a flat disc pressed onto the face, two holes punched through it
    geo = new THREE.CylinderGeometry(size * 1.3 * wide, size * 1.15 * wide, size * 0.55 * deep, 12, 2);
    mesh = new THREE.Mesh(geo, mats.trim);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(0, 0, size * 0.3);
  } else if (p.noseType === 'beak') {
    geo = new THREE.ConeGeometry(size * 0.6 * wide, size * 2.6 * deep, 7, 3);
    mesh = new THREE.Mesh(geo, mats.skin);
    mesh.rotation.x = Math.PI / 2; // tip along the normal
    mesh.position.set(0, 0, size * 0.9);
  } else if (p.noseType === 'snout') {
    geo = new THREE.SphereGeometry(size, 11, 9);
    mesh = new THREE.Mesh(geo, mats.trim);
    mesh.scale.set(wide, 0.75 * tall, 1.9 * deep);
    mesh.position.set(0, 0, size * 0.45);
  } else if (p.noseType === 'hook') {
    // a beak that has been bent: the tip drops below where it started
    geo = new THREE.ConeGeometry(size * 0.55 * wide, size * 2.4 * deep, 7, 4);
    mesh = new THREE.Mesh(geo, mats.skin);
    mesh.rotation.x = Math.PI / 2.6;
    mesh.position.set(0, -size * 0.35, size * 0.8);
  } else if (p.noseType === 'blob') {
    // a heavy bulb hanging off the middle of the face
    // ...hanging OFF it. Set a quarter of a radius out from the skin it was
    // four fifths buried, and a sphere four fifths buried is not a bulb, it is
    // a flat patch of darker skin with part of an outline round it.
    geo = new THREE.SphereGeometry(size * 0.95, 11, 9);
    mesh = new THREE.Mesh(geo, mats.trim);
    mesh.scale.set(wide * 0.95, 1.25 * tall, 1.0 * deep);
    mesh.position.set(0, -size * 0.4, size * 0.6);
  } else if (p.noseType === 'button') {
    // a full stop in the middle of the face
    geo = new THREE.SphereGeometry(size * 0.45, 9, 7);
    mesh = new THREE.Mesh(geo, mats.trim);
    mesh.scale.set(wide, tall, deep * 0.8);
    mesh.position.set(0, 0, size * 0.12);
  } else if (p.noseType === 'horn') {
    // one spike straight off the bridge
    geo = new THREE.ConeGeometry(size * 0.42 * wide, size * 2.2 * deep, 6, 4);
    mesh = new THREE.Mesh(geo, mats.growth);
    mesh.rotation.x = Math.PI / 2.3;
    mesh.position.set(0, size * 0.4, size * 0.7);
  } else if (p.noseType === 'plate') {
    // a flat shield pressed over where a nose should be
    geo = new THREE.BoxGeometry(size * 1.9 * wide, size * 1.5 * tall, size * 0.4 * deep);
    mesh = new THREE.Mesh(geo, mats.trim);
    mesh.position.set(0, 0, size * 0.2);
  } else if (p.noseType === 'straw') {
    // A thin tube reaching out of the face — DOWNWARD as well as forward.
    // Aimed straight at the camera it vanishes into a dot from the front, and
    // with the warp's bend on a long tube it arced sideways instead, reading
    // as a rod lying across the face with no root: the two commonest "stick
    // across the cheek" reports in the audit were both this nose. Tipped down
    // it reads as a proboscis from every angle, and it warps gently.
    geo = new THREE.CylinderGeometry(size * 0.2, size * 0.3, size * 1.9 * Math.min(deep, 1.25), 7, 3);
    mesh = new THREE.Mesh(geo, mats.trim);
    mesh.rotation.x = Math.PI / 2 - 0.55;
    mesh.position.set(0, -size * 0.5, size * 0.85);
  } else {
    geo = new THREE.SphereGeometry(size, 11, 9);
    mesh = new THREE.Mesh(geo, mats.trim);
    mesh.scale.set(wide, 1.25 * tall, 0.85 * deep);
    mesh.position.set(0, 0, -size * 0.15);
  }
  warpGeometry(geo, rng(), warp);
  withOutline(frame, mesh, geo, p.outline * 0.7 * S, mats.outline);

  if (p.noseType !== 'beak') {
    const wide = p.noseType === 'pig';
    for (const dx of [-1, 1]) {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(size * (wide ? 0.34 : 0.22), 6, 5), mats.cavity);
      nostril.position.set(
        dx * size * (wide ? 0.55 : 0.42),
        wide ? 0 : -size * 0.3,
        size * (p.noseType === 'snout' ? 1.3 : wide ? 0.5 : 0.55),
      );
      frame.add(nostril);
    }
  }
  parent.add(frame);
}

// ---------------------------------------------------------------- SCARS ----

/**
 * Old damage: a line of small dark patches across the face. decalGeometry only
 * makes axis-aligned ellipses, so a slash is stitched from overlapping dots —
 * which at this resolution reads more like a scar than a clean ellipse would.
 */
export function addScars(parent, headMesh, p, mats, rng, maw) {
  if (p.wear < 0.25) return;
  const S = headUnit(p);
  const scars = 1 + (rng() < p.wear - 0.45 ? 1 : 0);

  for (let n = 0; n < scars; n++) {
    const angle = (rng() * 2 - 1) * 1.1;
    const len = (0.35 + rng() * 0.5) * p.headHeight;
    const cx = (rng() * 2 - 1) * p.headWidth * 0.45;
    const cy = (rng() * 2 - 1) * p.headHeight * 0.3;
    // A scar is a chain of round decals, because `decalGeometry` draws an
    // upright ellipse and a scar runs at an angle. The count used to be six
    // whatever the length, so a long one came out as six separate spots with
    // bare skin between them — a dotted line, not a scar. Derive it from the
    // length so consecutive dots always overlap, and cap it so a scar across a
    // whole skull is still a few dozen tiny fans rather than a hundred.
    // A scar TAPERS: thick in the middle, drawn out to nothing at the ends,
    // and never laser-straight. Overlapping dots of one constant radius made a
    // uniform solid line, and a uniform line on a face does not read as a scar
    // — it reads as a rod lying there, and three of the audit's "stick across
    // the cheek" reports were exactly this. The width rides a bell over the
    // length and each dot wanders a little off the line.
    const rDot = S * 0.045;
    const dots = Math.max(6, Math.min(34, Math.ceil(len / (rDot * 1.1))));
    let wander = 0;
    for (let i = 0; i < dots; i++) {
      const k = i / (dots - 1);
      const t = (k - 0.5) * len;
      const r = S * (0.012 + 0.036 * Math.sin(Math.PI * k));
      wander += (rng() - 0.5) * S * 0.012;
      const dx = cx + Math.sin(angle) * t + Math.cos(angle) * wander;
      const dy = cy + Math.cos(angle) * t - Math.sin(angle) * wander;
      // A scar stops at the mouth. The dots were scattered with no knowledge
      // of the maw at all, so a scar crossing it laid a chain of dark decals
      // over the lips and INTO the cavity — which reads as a rod entering the
      // mouth, not as a mark on the skin. The lip band is part of the mouth,
      // so the clearance covers it.
      if (maw) {
        const lipGrow = 1 + (p.lips ?? 0);
        const qx = (dx - maw.mx) / Math.max(maw.mw * lipGrow, 1e-6);
        const qy = (dy - maw.my) / Math.max(maw.mh * lipGrow * 1.25, 1e-6);
        if (Math.hypot(qx, qy / Math.max(maw.hi ?? 1, -(maw.lo ?? -1))) < 1.15) continue;
      }
      const geo = decalGeometry(headMesh, p, {
        cx: dx,
        cy: dy,
        rx: r,
        ry: r,
        offset: 0.016,
        rings: 1,
        segs: 8,
      });
      parent.add(new THREE.Mesh(geo, mats.socket));
    }
  }
}

// -------------------------------------------------------------- GROWTHS ----

function randomDir(rng, v = new THREE.Vector3()) {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return v.set(Math.cos(a) * r, z, Math.sin(a) * r);
}

export function addGrowths(parent, headMesh, p, mats, rng) {
  const S = headUnit(p);
  const dir = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();

  // warts are instanced so that 40 of them cost a single draw call
  if (p.warts > 0) {
    const geo = new THREE.IcosahedronGeometry(p.wartSize * S, 0);
    const inst = new THREE.InstancedMesh(geo, mats.growth, p.warts);
    for (let i = 0; i < p.warts; i++) {
      // do not plant growths straight into the maw
      for (let tries = 0; tries < 8; tries++) {
        randomDir(rng, dir);
        if (!(dir.z > 0.5 && Math.abs(dir.y - p.mouthY * 0.8) < 0.35)) break;
      }
      const hit = surfaceByDir(p, dir.x, dir.y, dir.z);
      // ...and then onto the skull that is DRAWN. Warts were the biggest single
      // entry in the seating sweep's blame list, and not because of where they
      // are put: they are put on the analytic surface, and where a lump field
      // is finer than the tessellation the mesh sits well inside it. A wart
      // planted on the field it was generated from floats above the face by the
      // difference.
      snapToMesh(headMesh, hit.point);
      // One geometry serves all forty of them, so the only way a wart can
      // differ from its neighbour is in how it is placed: an uneven scale on
      // all three axes and a roll about the normal, instead of the same
      // pebble at forty sizes.
      const s = 0.55 + rng() * 1.1;
      scl.set(s * (0.7 + rng() * 0.7), s * (0.7 + rng() * 0.7), s * (0.5 + rng() * 0.6));
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rng() * Math.PI * 2));
      m4.compose(hit.point.addScaledVector(hit.normal, -p.wartSize * S * 0.1), q, scl);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    parent.add(inst);
  }

  // horns grow in symmetric pairs across the crown
  for (let i = 0; i < p.horns; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const idx = Math.floor(i / 2);
    dir.set(side * (0.3 + idx * 0.28), 1 - idx * 0.22, -0.12 + idx * 0.1).normalize();
    const hit = surfaceByDir(p, dir.x, dir.y, dir.z);
    snapToMesh(headMesh, hit.point);   // the drawn skull, not the field behind it
    // A horn grows UP-OUT of the skull, not along the skin's normal. On a
    // round crown the two agree, which is why aiming along the normal looked
    // right for so long — but on a strongly tapered skull the crown directions
    // land on the steep flank of the cone, whose normal points forward and
    // DOWN, and the horn came out lying flat across the face like a rod with
    // no root. The aim keeps a share of the normal so a side horn still leans
    // outward rather than standing parallel to its neighbour.
    const aim = hit.normal.clone().multiplyScalar(0.55)
      .add(new THREE.Vector3(0, 1, 0)).normalize();
    // a broken horn is a stump with a flat top
    const broken = rng() < p.wear * 0.45;
    const len = p.hornLen * S * (0.7 + rng() * 0.5) * (broken ? 0.35 : 1) * (1 + (rng() * 2 - 1) * p.lopsided * 0.4);
    // A horn is the loudest thing on a skull, and two creatures wearing the
    // same perfect cone read as the same creature. Bent, tapered and knobbly,
    // each one its own.
    const geo = warpGeometry(broken
      ? new THREE.CylinderGeometry(S * 0.055, S * 0.085, len, 6, 3)
      : new THREE.ConeGeometry(S * 0.085, len, 6, 4),
    rng(), warpRoll(p, rng, 0.9));
    const frame = new THREE.Group();
    orientTo(frame, hit.point, aim);
    const horn = new THREE.Mesh(geo, mats.growth);
    horn.rotation.x = Math.PI / 2;
    horn.position.set(0, 0, len * 0.42);
    withOutline(frame, horn, geo, p.outline * 0.6 * S, mats.outline);
    parent.add(frame);
  }

  // hair of whatever kind lives in hair.js
  // Ears sway with the hair, so they join the same list the animator drives.
  const tendrils = addHair(parent, p, mats, rng, S).concat(addEars(parent, headMesh, p, mats, S, rng));

  // spore cloud above the skull, in a group of its own so it can drift
  // whatever floats around this one, hung on the head so it travels with it
  // The crown the aura hangs over is the SKULL'S, measured, not the slider's:
  // the profile normalisation and the warp both pull the real crown below
  // p.headHeight, and a halo seated on the parameter floated in a ring a whole
  // gap above the head it was meant to sit on.
  headMesh.geometry.computeBoundingBox();
  const spores = addAura(p, mats, rng, S, headMesh.geometry.boundingBox.max.y * 0.98);
  if (spores) parent.add(spores);

  return { tendrils, spores };
}
