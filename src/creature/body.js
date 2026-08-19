import * as THREE from 'three';
import { withOutline } from './materials.js';
import { warpGeometry, warpRoll } from './warp.js';
import { buildArm } from './arms.js';
import { makeTorsoGeometry, bodyProfile, profilePeak } from './torso.js';

/**
 * The body is whatever height is left after the head: bodyH = headH * (1-r)/r.
 * At r = 0.7 the head honestly takes up 70% of the character.
 *
 * With one saturation, at the very top of the slider: the trunk never goes
 * below a tenth of the head's height, and past that point the character grows
 * taller instead of the trunk disappearing. So the head's share is exact until
 * about r = 0.76 and then eases off — which is invisible next to the spread the
 * growths above the skull already put on it.
 *
 * Feet stand at y = 0.
 */
export function buildBody(p, mats, headBox, rng) {
  const headH = headBox.max.y - headBox.min.y;
  const headW = headBox.max.x - headBox.min.x;
  const r = THREE.MathUtils.clamp(p.headRatio, 0.4, 0.92);
  const bodyH = (headH * (1 - r)) / r;

  const legH = bodyH * THREE.MathUtils.clamp(0.22 + p.legLen * 0.28, 0.12, 0.7);
  // The trunk is the last thing the head's share takes from, and at the top of
  // that share there is nothing left: at headRatio 0.88 with long legs it comes
  // to 4% of the head's height, so the arms and legs hang straight off the
  // skull with no body between them and nothing to grow out of. A freak that is
  // mostly head is the point; a freak with no torso at all is four sticks and a
  // face. Below a tenth of the skull the character grows rather than the trunk
  // vanishing; the docstring above says what that costs.
  const torsoH = Math.max(bodyH - legH, headH * 0.1);
  // A limb has to grow out of the body, not float beside it. The order here is
  // what makes that true: limbs are sized against the body the player asked
  // for, then the spread floors that keep them from fusing are worked out, and
  // only then is the torso widened — if it still has to be — to reach its own
  // attachment points. Sizing the torso first and spacing the limbs afterwards,
  // which is the obvious order, left the arms of a narrow freak hanging in
  // space several body-widths out.
  const wantW = Math.max(0.04, p.bodyWidth * headW * 0.26);
  // a slender body carries slender limbs
  const limbR0 = Math.min(Math.max(0.012, p.limbThick * headW * 0.06), wantW * 0.55);
  const ink = p.outline * headW * 0.5;

  // The skull gets a silhouette of its own; the torso used to be whichever
  // primitive its kind named, at the same proportions every time. Give this one
  // its own — squat and deep, or narrow and tall, sitting a little high or low
  // on the legs. Rolled here, before the widths, because a torso that came out
  // narrow has to be taken into account when working out how far a limb may
  // root from the middle.
  const wide = 0.82 + rng() * 0.45;
  const tall = 0.78 + rng() * 0.5;
  const deep = 0.7 + rng() * 0.7;
  const torsoDrop = rng() * 0.16;

  // How wide the leg is at its widest, which is usually the foot rather than
  // the shin: a splayed foot is nearly twice the leg above it.
  const legRPre = Math.min(limbR0 * (p.legType === 'thick' ? 2.1 : p.legType === 'stump' ? 2.6 : 1), wantW * 0.55);
  const footRPre = legRPre * (p.footType === 'hoof' ? 1.05 : 1.25);
  // A digitigrade leg's thigh is built 15% fatter than the shin below it, and
  // leaving that out of the estimate meant the number the hips are spaced by
  // was smaller than the leg actually is. There was slack enough to hide it
  // while the spacing was generous; there is not once it is tight.
  // A frog leg bows outward and a peg is widest at the hip — both are wider
  // than the shin radius the spacing would otherwise be done by.
  const legWidest = legRPre * (p.legType === 'bent' ? 1.15
    : p.legType === 'frog' ? 1.25
    : p.legType === 'peg' ? 1.2 : 1);
  const legHalf0 = Math.max(legWidest, p.footType === 'none' ? 0
    : p.footType === 'splay' ? footRPre * 1.8
    : p.footType === 'hoof' ? footRPre * 1.15
    : p.footType === 'claws' ? footRPre * 1.6
    : p.footType === 'boot' ? footRPre * 1.4
    : footRPre * 1.1);

  // Now the torso: as wide as asked for, but never narrower than the hips and
  // shoulders it has to carry. `narrow` is how much of that width the body
  // actually has at the height a limb attaches — a pear is slim at the
  // shoulder however wide it is at the hip, and a slab is cut square.
  // Where the torso sits and how far it reaches. The joints are placed from
  // `legH` and `torsoH`, so their heights inside the torso have to be worked
  // out from the same numbers rather than guessed: with a short torso sitting
  // low, the hip line fell clean off the bottom of the body and the legs began
  // below the mesh they were supposed to grow from.
  const torsoY = legH + torsoH * (0.42 + torsoDrop);
  const shoulderY = legH + torsoH * 0.52;
  // The trunk always reaches PAST its own hips, not merely down to them. A
  // rounded body narrows towards its own ends, so a hip line sitting at the
  // very bottom is measured where the latitude term alone has taken the width
  // to a third — and everything downstream then divides by that third: the
  // torso is asked to widen, the ceiling stops it, and `fit` shrinks the legs
  // instead. Reaching a quarter further down puts the joint at four fifths
  // rather than at the pole, and the legs come out half again as thick for it
  // (radius median 0.039 -> 0.046) with no joint any further outside the skin.
  const halfH = Math.max(torsoH * 0.55 * tall, (torsoY - legH) * 1.25);
  const heightIn = (y) => THREE.MathUtils.clamp((y - torsoY) / halfH, -0.95, 0.95);

  // How wide the body actually is where each limb joins it. Two things set
  // that, and using only the first is what left a quarter of the population
  // with limbs outside the trunk: the width profile, and the plain fact that a
  // rounded body narrows towards its own top and bottom. At the hip line, four
  // fifths of the way down, that second term alone takes it to half.
  // Lumps displace the surface inwards as well as outwards, so the worst case
  // is what the joint has to be inside of — the analytic profile is where the
  // skin would be without them.
  const dented = 1 - Math.min(0.55, p.bodyLumps * 1.2);
  // The mesh is normalised to a half-width of one, so these fractions are of
  // the widest point rather than of the raw profile.
  const peak = profilePeak(p);
  const widthAt = (y) => {
    const t = heightIn(y);
    return wide * (bodyProfile(p, t) * Math.sqrt(Math.max(0.05, 1 - t * t)) / peak) * dented;
  };
  const shoulderNarrow = widthAt(shoulderY);
  const hipNarrow = widthAt(legH);
  // How much room the limbs need for the two of them to sit side by side
  // without fusing and still be inside the trunk. Everything here scales
  // linearly with one factor, which is what lets the fit below be a division
  // rather than a search.
  const hipNeed = legHalf0 * 1.45;
  const shoulderNeed = hipNeed + legHalf0 + limbR0 * 1.4;
  // And how much room they need if they are pushed together as close as they
  // can go without touching. The difference between these two is the slack the
  // fit below spends FIRST, before it starts shaving the limbs themselves —
  // spacing is what these numbers are about, and thickness is what a player
  // can see. Paying the whole shortfall out of thickness put 30% of arms under
  // two pixels wide at the resolution this renders at, which is a whisker.
  const hipTight = legHalf0 * 1.35;
  const shoulderTight = Math.max(hipTight * 0.7, limbR0 * 1.7);

  // The torso may widen to carry them — but only so far. Letting it grow
  // without bound, which is what dividing by these narrowing factors did, set
  // the width of 82% of creatures to something the body-width slider never
  // asked for: a median of twice over, up to fifteen times. And since the body
  // is a sliver whenever the head takes most of the character, a torso widened
  // like that renders as a flat blade — sixty times wider than tall, at worst.
  //
  // Hence two ceilings: half again the width asked for, and half again the
  // torso's own height. A body may be broad. It may not be a pancake.
  //
  // The height ceiling is not a ceiling on the WIDENING, it is a ceiling on the
  // width. The body-width slider is scaled by the head, and the body's height
  // shrinks as the head takes more of the character — so at a wide setting on a
  // big head with a tiny body, the width the slider asks for is already a disc
  // before anything widens it at all. Both the floor and the ceiling have to
  // respect it.
  const maxHalfW = (halfH * 1.6) / wide;
  const base = Math.min(wantW, maxHalfW);
  const torsoW = THREE.MathUtils.clamp(
    Math.max(hipNeed / (hipNarrow * 0.95), shoulderNeed / (shoulderNarrow * 0.95)),
    base,
    Math.max(base, Math.min(wantW * 1.5, maxHalfW)),
  );

  // the furthest out each joint may root and still be inside the body
  const hipAttach = torsoW * hipNarrow * 0.95;
  const attach = torsoW * shoulderNarrow * 0.95;

  // If a ceiling bound, the limbs come in rather than the body going out — and
  // they come TOGETHER before they come thin. Measured against the tight
  // spacing, so the roomy gaps above are spent first and the limb only starts
  // losing thickness once the two of them are already shoulder to shoulder.
  const fit = Math.min(1, hipAttach / Math.max(hipTight, 1e-6), attach / Math.max(shoulderTight, 1e-6));
  const limbR = limbR0 * fit;
  const legHalf = legHalf0 * fit;
  const hipFloor = hipTight * fit;

  const group = new THREE.Group();
  group.userData.part = 'torso';   // editor fallback: anything untagged on the body

  // ---------------------------------------------------------------- torso ---
  // One surface with its own silhouette, not a primitive picked from a list.
  // The scale is applied to the mesh rather than baked into the geometry so a
  // slider drag only rebuilds the vertices, not the whole body.
  const torsoGeo = makeTorsoGeometry(p);
  const torso = new THREE.Mesh(torsoGeo, mats.body);
  torso.scale.set(torsoW * wide, halfH, torsoW * 0.85 * deep);
  torso.position.y = torsoY;
  withOutline(group, torso, torsoGeo, ink / Math.max(torsoW * wide, halfH), mats.outline);

  // ----------------------------------------------------------------- legs ---
  // A leg is a capsule of some thickness, and the whole limb has to fit inside
  // `legH` whatever kind it is — the creature stands with its feet at y = 0 and
  // nothing here may push them through the floor.
  const legR = legRPre * fit;
  const legLen = Math.max(0.02, legH - legR * 2);
  const legGeo = new THREE.CapsuleGeometry(legR, legLen, 3, 7);
  const armLen = Math.max(0.03, p.armLen * bodyH * 0.75);

  // A foot is a ball or a stub, and both used to be the same ball or stub on
  // every creature that rolled them. Warped, so a hoof is a worn hoof and a
  // splayed foot has toes rather than being a squashed marble.
  const footR = legR * (p.footType === 'hoof' ? 1.05 : 1.25);
  const footGeo = warpGeometry(p.footType === 'hoof'
    ? new THREE.CylinderGeometry(footR, footR * 1.15, footR * 1.4, 8, 3)
    : new THREE.SphereGeometry(footR, 9, 7),
  rng(), warpRoll(p, rng, 0.6));

  const legs = [];
  const shoulders = [];

  // Thick limbs on a narrow body used to fuse into a single blob and the arms
  // used to hang inside the torso, so both get a floor on how close to the
  // midline they may sit. The extra room also covers the animator's sway.
  // The gap has to clear the widest thing on the leg, which is usually not the
  // leg: a splayed foot is nearly twice the width of the shin above it, and
  // spacing the hips by the shin alone fuses the feet into one paddle.
  // Stance opens the hips, but never so far that the shoulders — which have to
  // clear the hips by a leg's width — no longer fit inside the body either.
  // Letting stance run free is what pushed the arms out into space.
  const hipRoom = Math.max(hipFloor, Math.min(hipAttach, attach - (legHalf + limbR * 1.4)));
  const hipSpread = THREE.MathUtils.clamp(torsoW * 0.4 + p.stance * torsoW * 0.55, hipFloor, hipRoom);
  // Shoulders sit outboard of the hips by more than both limb radii, so an arm
  // never runs alongside a leg; angling the arm outward only widens that gap.
  const shoulderSpread = Math.min(attach, Math.max(torsoW * 0.8, hipSpread + legHalf + limbR * 1.4));

  // How far a gesture may tilt one leg sideways before it touches the other.
  // The stance sets the gap once, at build time; a gesture that swings a single
  // leg spends it, and on a squat freak with thick legs the two fuse into one
  // paddle. Tilting by θ moves the foot legH·sin θ across, so the room between
  // them is a rotation, and it is the leg that knows how much of one it has.
  // Half the gap each, not the whole of it: a gesture may swing the two legs
  // opposite ways, so both spend the budget towards the same middle. Giving
  // each one the full gap — on the grounds that only one leg is moving — brings
  // the crossings straight back.
  const legLean = Math.min(0.3, Math.asin(THREE.MathUtils.clamp(
    Math.max(0, hipSpread - legHalf) * 0.7 / Math.max(legH, 1e-6), 0, 1)));

  for (const side of [-1, 1]) {
    // leg: hangs from a hip pivot so the animator can shift weight from one
    // foot to the other; the foot rides along with it
    const hipX = side * hipSpread;
    const legPivot = new THREE.Group();
    legPivot.userData.part = 'leg';
    legPivot.position.set(hipX, legH, 0);
    legPivot.userData.lean = legLean;
    group.add(legPivot);
    legs.push(legPivot);

    if (p.legType === 'frog') {
      // a squat bow: thigh swung out to the side, shin swung back in, so the
      // knee sticks out sideways — a leg mid-crouch
      const half = legLen * 0.58;
      const bow = 0.5;
      const thighGeo = new THREE.CapsuleGeometry(legR * 1.1, half, 3, 7);
      const thigh = new THREE.Mesh(thighGeo, mats.body);
      thigh.position.set(side * half * 0.22, legR + half * 1.35 - legH, 0);
      thigh.rotation.z = -side * bow;
      withOutline(legPivot, thigh, thighGeo, ink, mats.outline);

      const shinGeo = new THREE.CapsuleGeometry(legR * 0.85, half, 3, 7);
      const shin = new THREE.Mesh(shinGeo, mats.body);
      shin.position.set(side * half * 0.24, legR + half * 0.42 - legH, 0);
      shin.rotation.z = side * bow * 0.85;
      withOutline(legPivot, shin, shinGeo, ink, mats.outline);
    } else if (p.legType === 'peg') {
      // a rigid taper: wide where it meets the hip, next to nothing at the
      // floor — a pirate's peg
      const pegGeo = new THREE.CylinderGeometry(legR * 1.2, legR * 0.45, legLen + legR, 8, 3);
      const peg = new THREE.Mesh(pegGeo, mats.body);
      peg.position.set(0, (legLen + legR) * 0.5 - legH, 0);
      withOutline(legPivot, peg, pegGeo, ink, mats.outline);
    } else if (p.legType === 'bent') {
      // A digitigrade leg: thigh angled back, shin angled forward, so the knee
      // sticks out behind. Both halves are shortened to keep the ankle at the
      // same height a straight leg would have reached.
      const half = legLen * 0.52;
      const lean = 0.4;
      const thighGeo = new THREE.CapsuleGeometry(legR * 1.15, half, 3, 7);
      const thigh = new THREE.Mesh(thighGeo, mats.body);
      thigh.position.set(0, legR + half * 1.45 - legH, -half * 0.2);
      thigh.rotation.x = -lean;
      withOutline(legPivot, thigh, thighGeo, ink, mats.outline);

      const shinGeo = new THREE.CapsuleGeometry(legR * 0.85, half, 3, 7);
      const shin = new THREE.Mesh(shinGeo, mats.body);
      shin.position.set(0, legR + half * 0.5 - legH, half * 0.12);
      shin.rotation.x = lean * 0.55;
      withOutline(legPivot, shin, shinGeo, ink, mats.outline);
    } else {
      const leg = new THREE.Mesh(legGeo, mats.body);
      leg.position.set(0, legR + legLen * 0.5 - legH, 0);
      withOutline(legPivot, leg, legGeo, ink, mats.outline);
    }

    if (p.footType === 'claws') {
      // three talons splayed on the ground, no pad under them — each one a
      // cone laid nearly flat, pointing forward and a little apart
      const toeGeo = new THREE.ConeGeometry(footR * 0.38, footR * 2.1, 5, 2);
      for (let t = -1; t <= 1; t++) {
        const aim = new THREE.Group();
        aim.position.set(0, footR * 0.38 - legH, legR * 0.5);
        aim.rotation.y = t * 0.5;
        legPivot.add(aim);
        const toe = new THREE.Mesh(toeGeo, mats.trim);
        // cones point +Y; lay this one down so it points along +Z with a
        // slight rake — the tip grazes the floor without piercing it
        toe.rotation.x = Math.PI / 2 - 0.12;
        toe.position.z = footR * 0.9;
        withOutline(aim, toe, toeGeo, ink * 0.7, mats.outline);
      }
    } else if (p.footType === 'boot') {
      // a blocky stump of a foot, like it was carved rather than grown
      const bootGeo = warpGeometry(
        new THREE.BoxGeometry(footR * 2.1, footR * 1.4, footR * 2.5, 2, 2, 2),
        rng(), warpRoll(p, rng, 0.4));
      const boot = new THREE.Mesh(bootGeo, mats.trim);
      boot.position.set(0, footR * 0.75 - legH, legR * 0.5);
      withOutline(legPivot, boot, bootGeo, ink, mats.outline);
    } else if (p.footType !== 'none') {
      const foot = new THREE.Mesh(footGeo, mats.trim);
      if (p.footType === 'hoof') {
        foot.position.set(0, footR * 0.7 - legH, 0);
      } else {
        // splayed feet are wide and flat, a ball foot is a rounded stub — and
        // whichever it is, it is lifted by its own squashed radius so the sole
        // lands on y = 0. Using the leg's radius instead, which is the obvious
        // thing, buries a fat foot in the floor.
        const squash = p.footType === 'splay' ? 0.45 : 0.7;
        foot.scale.set(p.footType === 'splay' ? 1.8 : 1.1, squash, p.footType === 'splay' ? 2.2 : 1.5);
        foot.position.set(0, footR * squash - legH, legR * 0.9);
      }
      withOutline(legPivot, foot, footGeo, ink, mats.outline);
    }

    // arm: the shoulder sits low and wide, otherwise the whole limb hides
    // under the head. Its splay carries the sign of the side it grows from —
    // flip that and both arms fold across the chest (see arms.js).
    const shoulder = buildArm(p, mats, rng, {
      side,
      shoulderX: shoulderSpread,
      shoulderY,
      shoulderZ: torsoW * 0.15,
      limbR,
      armLen,
      ink,
      stance: p.stance,
    });
    if (shoulder) {
      group.add(shoulder);
      shoulders.push(shoulder);
    }
  }

  return { group, bodyH, legH, torsoH, torso, legs, shoulders };
}
