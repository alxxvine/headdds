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

  for (const side of [-1, 1]) {
    // leg
    const leg = new THREE.Mesh(legGeo, mats.body);
    leg.position.set(side * (torsoW * 0.4 + p.stance * torsoW * 0.55), limbR + legLen * 0.5, 0);
    withOutline(group, leg, legGeo, ink, mats.outline);

    const foot = new THREE.Mesh(footGeo, mats.body);
    foot.position.set(leg.position.x, limbR * 0.7, limbR * 0.9);
    foot.scale.set(1.1, 0.7, 1.5);
    withOutline(group, foot, footGeo, ink, mats.outline);

    // arm: a shoulder plus a limb dangling down and outwards.
    // The shoulder sits low and wide, otherwise the whole arm hides
    // under the overhanging head.
    const shoulder = new THREE.Group();
    shoulder.position.set(side * torsoW * 0.92, legH + torsoH * 0.52, torsoW * 0.15);
    shoulder.rotation.z = -side * (0.6 + p.stance * 0.5);
    const arm = new THREE.Mesh(armGeo, mats.body);
    arm.position.y = -armLen * 0.5;
    withOutline(shoulder, arm, armGeo, ink, mats.outline);

    const hand = new THREE.Mesh(handGeo, mats.body);
    hand.position.y = -armLen - limbR * 0.4;
    withOutline(shoulder, hand, handGeo, ink, mats.outline);
    group.add(shoulder);
  }

  return { group, bodyH, legH, torsoH };
}
