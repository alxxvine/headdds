import * as THREE from 'three';
import { withOutline } from './materials.js';

/**
 * The body is whatever height is left after the head: bodyH = headH * (1-r)/r.
 * At r = 0.7 the head honestly takes up 70% of the character.
 * Feet stand at y = 0.
 */
export function buildBody(p, mats, headBox) {
  const headH = headBox.max.y - headBox.min.y;
  const headW = headBox.max.x - headBox.min.x;
  const r = THREE.MathUtils.clamp(p.headRatio, 0.4, 0.92);
  const bodyH = (headH * (1 - r)) / r;

  const legH = bodyH * THREE.MathUtils.clamp(0.22 + p.legLen * 0.28, 0.12, 0.7);
  const torsoH = bodyH - legH;
  const torsoW = Math.max(0.04, p.bodyWidth * headW * 0.26);
  const limbR = Math.max(0.012, p.limbThick * headW * 0.045);
  const ink = p.outline * headW * 0.5;

  const group = new THREE.Group();

  // torso
  const torsoGeo = new THREE.SphereGeometry(1, 12, 10);
  const torso = new THREE.Mesh(torsoGeo, mats.body);
  torso.scale.set(torsoW, torsoH * 0.62, torsoW * 0.82);
  torso.position.y = legH + torsoH * 0.5;
  withOutline(group, torso, torsoGeo, ink / Math.max(torsoW, torsoH * 0.62), mats.outline);

  const legLen = Math.max(0.02, legH - limbR * 2);
  const legGeo = new THREE.CapsuleGeometry(limbR, legLen, 3, 6);
  const footGeo = new THREE.SphereGeometry(limbR * 1.25, 8, 6);
  const armLen = Math.max(0.03, p.armLen * bodyH * 0.75);
  const armGeo = new THREE.CapsuleGeometry(limbR * 0.85, armLen, 3, 6);
  const handGeo = new THREE.SphereGeometry(limbR * 1.1, 8, 6);

  const legs = [];
  const shoulders = [];

  // Thick limbs on a narrow body used to fuse into a single blob and the arms
  // used to hang inside the torso, so both get a floor on how close to the
  // midline they may sit. The extra room also covers the animator's sway.
  const hipSpread = Math.max(torsoW * 0.4 + p.stance * torsoW * 0.55, limbR * 1.9);
  // Shoulders sit outboard of the hips by more than both limb radii, so an arm
  // never runs alongside a leg; angling the arm outward only widens that gap.
  const shoulderSpread = Math.max(torsoW * 0.92, hipSpread + limbR * 1.9);

  for (const side of [-1, 1]) {
    // leg: hangs from a hip pivot so the animator can shift weight from one
    // foot to the other; the foot rides along with it
    const hipX = side * hipSpread;
    const legPivot = new THREE.Group();
    legPivot.position.set(hipX, legH, 0);
    group.add(legPivot);
    legs.push(legPivot);

    const leg = new THREE.Mesh(legGeo, mats.body);
    leg.position.set(0, limbR + legLen * 0.5 - legH, 0);
    withOutline(legPivot, leg, legGeo, ink, mats.outline);

    const foot = new THREE.Mesh(footGeo, mats.body);
    foot.position.set(0, limbR * 0.7 - legH, limbR * 0.9);
    foot.scale.set(1.1, 0.7, 1.5);
    withOutline(legPivot, foot, footGeo, ink, mats.outline);

    // arm: a shoulder plus a limb dangling down and outwards. The shoulder
    // sits low and wide, otherwise the whole arm hides under the head.
    const shoulder = new THREE.Group();
    const shoulderY = legH + torsoH * 0.52;
    shoulder.position.set(side * shoulderSpread, shoulderY, torsoW * 0.15);

    // A limb hanging at local -Y lands at x = len * sin(angle), so the sign of
    // the rotation has to follow the side it grows from — with the sign
    // flipped both arms fold across the chest and cross each other.
    // The angle also has a floor: rather than sinking a hand through the
    // floor, a long arm splays wider. Distances below are how far the hand
    // centre and the arm's own cap sit down the limb, plus how far each
    // bulges past that.
    const clearance = (down, radius) =>
      Math.acos(THREE.MathUtils.clamp((shoulderY - radius) / down, 0, 1));
    const minAngle = Math.max(
      clearance(armLen + limbR * 0.4, limbR * 1.1),
      clearance(armLen + limbR * 0.85, limbR * 0.85),
    );
    shoulder.rotation.z = side * Math.min(1.5, Math.max(0.32 + p.stance * 0.4, minAngle));
    const arm = new THREE.Mesh(armGeo, mats.body);
    arm.position.y = -armLen * 0.5;
    withOutline(shoulder, arm, armGeo, ink, mats.outline);

    const hand = new THREE.Mesh(handGeo, mats.body);
    hand.position.y = -armLen - limbR * 0.4;
    withOutline(shoulder, hand, handGeo, ink, mats.outline);
    group.add(shoulder);
    shoulders.push(shoulder);
  }

  return { group, bodyH, legH, torsoH, torso, legs, shoulders };
}
