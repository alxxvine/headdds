import * as THREE from 'three';
import { withOutline } from './materials.js';
import { buildArm } from './arms.js';
import { addOrnaments } from './ornaments.js';

/**
 * The body is whatever height is left after the head: bodyH = headH * (1-r)/r.
 * At r = 0.7 the head honestly takes up 70% of the character.
 * Feet stand at y = 0.
 */
export function buildBody(p, mats, headBox, rng) {
  const headH = headBox.max.y - headBox.min.y;
  const headW = headBox.max.x - headBox.min.x;
  const r = THREE.MathUtils.clamp(p.headRatio, 0.4, 0.92);
  const bodyH = (headH * (1 - r)) / r;

  const legH = bodyH * THREE.MathUtils.clamp(0.22 + p.legLen * 0.28, 0.12, 0.7);
  const torsoH = bodyH - legH;
  // A limb has to grow out of the body, not float beside it. The order here is
  // what makes that true: limbs are sized against the body the player asked
  // for, then the spread floors that keep them from fusing are worked out, and
  // only then is the torso widened — if it still has to be — to reach its own
  // attachment points. Sizing the torso first and spacing the limbs afterwards,
  // which is the obvious order, left the arms of a narrow freak hanging in
  // space several body-widths out.
  const wantW = Math.max(0.04, p.bodyWidth * headW * 0.26);
  // a slender body carries slender limbs
  const limbR = Math.min(Math.max(0.012, p.limbThick * headW * 0.045), wantW * 0.42);
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
  const pearTop = 0.4 + rng() * 0.35;
  const pearFoot = 1.05 + rng() * 0.3;

  // How wide the leg is at its widest, which is usually the foot rather than
  // the shin: a splayed foot is nearly twice the leg above it.
  const legRPre = Math.min(limbR * (p.legType === 'thick' ? 2.1 : p.legType === 'stump' ? 2.6 : 1), wantW * 0.55);
  const footRPre = legRPre * (p.footType === 'hoof' ? 1.05 : 1.25);
  const legHalf = Math.max(legRPre, p.footType === 'none' ? 0
    : p.footType === 'splay' ? footRPre * 1.8
    : p.footType === 'hoof' ? footRPre * 1.15
    : footRPre * 1.1);

  // Now the torso: as wide as asked for, but never narrower than the hips and
  // shoulders it has to carry. `narrow` is how much of that width the body
  // actually has at the height a limb attaches — a pear is slim at the
  // shoulder however wide it is at the hip, and a slab is cut square.
  const narrow = wide * (p.bodyType === 'pear' ? pearTop * 1.1
    : p.bodyType === 'segmented' ? 0.8
    : p.bodyType === 'slab' ? 0.9
    : 1);
  const hipFloor = legHalf * 1.45;
  const shoulderFloor = hipFloor + legHalf + limbR * 1.4;
  const torsoW = Math.max(wantW, shoulderFloor / (narrow * 0.95));
  // the furthest out a limb may root and still be inside the body
  const attach = torsoW * narrow * 0.95;

  const group = new THREE.Group();

  // ---------------------------------------------------------------- torso ---
  // Every freak used to be a squashed sphere. The shape is now a kind, and the
  // arms and legs hang off it exactly as before — only the mass between them
  // changes. `torso` is handed back for the animator to breathe with, so
  // whatever is built here goes under one mesh or one group.
  const torsoY = legH + torsoH * (0.42 + torsoDrop);
  let torso;
  if (p.bodyType === 'segmented') {
    // an insect: a small thorax with a heavy abdomen slung behind and below
    torso = new THREE.Group();
    torso.position.y = torsoY;
    group.add(torso);
    const parts = [
      { r: 0.72, y: torsoH * 0.26, z: 0, squash: 0.85 },
      { r: 1.0, y: -torsoH * 0.16, z: -torsoW * 0.18, squash: 0.7 },
    ];
    for (const q of parts) {
      const geo = new THREE.SphereGeometry(1, 11, 9);
      const seg = new THREE.Mesh(geo, mats.body);
      seg.scale.set(torsoW * q.r * wide, torsoH * 0.5 * q.r * q.squash * tall, torsoW * q.r * 0.9 * deep);
      seg.position.set(0, q.y, q.z);
      withOutline(torso, seg, geo, ink / Math.max(torsoW * q.r, torsoH * 0.4), mats.outline);
    }
  } else {
    let geo;
    let sx = torsoW * wide;
    let sy = torsoH * 0.62 * tall;
    let sz = torsoW * 0.82 * deep;
    if (p.bodyType === 'slab') {
      geo = new THREE.BoxGeometry(2, 2, 2);
      sx = torsoW * 0.92 * wide;
      sz = torsoW * 0.6 * deep;
    } else if (p.bodyType === 'barrel') {
      geo = new THREE.CylinderGeometry(1, 1, 2, 12);
      sy = torsoH * 0.55 * tall;
    } else if (p.bodyType === 'pear') {
      // narrow at the shoulders, wide at the hips
      geo = new THREE.CylinderGeometry(pearTop, pearFoot, 2, 12);
      sy = torsoH * 0.55 * tall;
    } else {
      geo = new THREE.SphereGeometry(1, 12, 10);
    }
    torso = new THREE.Mesh(geo, mats.body);
    torso.scale.set(sx, sy, sz);
    torso.position.y = torsoY;
    withOutline(group, torso, geo, ink / Math.max(sx, sy), mats.outline);
  }

  // ----------------------------------------------------------------- legs ---
  // A leg is a capsule of some thickness, and the whole limb has to fit inside
  // `legH` whatever kind it is — the creature stands with its feet at y = 0 and
  // nothing here may push them through the floor.
  const legR = Math.min(limbR * (p.legType === 'thick' ? 2.1 : p.legType === 'stump' ? 2.6 : 1), wantW * 0.55);
  const legLen = Math.max(0.02, legH - legR * 2);
  const legGeo = new THREE.CapsuleGeometry(legR, legLen, 3, 7);
  const armLen = Math.max(0.03, p.armLen * bodyH * 0.75);

  const footR = legR * (p.footType === 'hoof' ? 1.05 : 1.25);
  const footGeo = p.footType === 'hoof'
    ? new THREE.CylinderGeometry(footR, footR * 1.15, footR * 1.4, 7)
    : new THREE.SphereGeometry(footR, 8, 6);

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
  const hipRoom = Math.max(hipFloor, attach - (legHalf + limbR * 1.4));
  const hipSpread = THREE.MathUtils.clamp(torsoW * 0.4 + p.stance * torsoW * 0.55, hipFloor, hipRoom);
  // Shoulders sit outboard of the hips by more than both limb radii, so an arm
  // never runs alongside a leg; angling the arm outward only widens that gap.
  const shoulderSpread = Math.min(attach, Math.max(torsoW * 0.8, hipSpread + legHalf + limbR * 1.4));


  for (const side of [-1, 1]) {
    // leg: hangs from a hip pivot so the animator can shift weight from one
    // foot to the other; the foot rides along with it
    const hipX = side * hipSpread;
    const legPivot = new THREE.Group();
    legPivot.position.set(hipX, legH, 0);
    group.add(legPivot);
    legs.push(legPivot);

    if (p.legType === 'bent') {
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

    if (p.footType !== 'none') {
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
      shoulderY: legH + torsoH * 0.52,
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

  // Ornaments go on last: they hang off the torso and the limbs, so everything
  // they attach to has to exist and know its own size first.
  addOrnaments(group, p, mats, rng, {
    torso, torsoY, torsoW, torsoH, legs, shoulders, limbR, legR, headW,
    neckY: legH + torsoH * 0.82,
  });

  return { group, bodyH, legH, torsoH, torso, legs, shoulders };
}
