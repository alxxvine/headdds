import * as THREE from 'three';
import { withOutline } from './materials.js';

// Everything that grows on the body rather than on the head. The skull has had
// horns, warts and hair from the start; below the neck a freak was bare, which
// is why two creatures with different torsos still read as the same creature
// wearing a different lump.
//
// All of it is built in the deeper skin tone (`mats.trim`) or the growth tone,
// never a new colour: a second tone separates a part from the body it sits on
// without turning the creature into a paint job.

/**
 * @param parent  the body group — ornaments are static, so they need no pivot
 * @param anchors where the body put things: { torso, torsoY, torsoW, torsoH,
 *                legs, shoulders, limbR, neckY }
 */
export function addOrnaments(parent, p, mats, rng, a) {
  const kind = p.ornament;
  if (kind === 'none') return;

  const ink = p.outline * a.torsoW * 0.5;
  const amount = p.ornamentAmount;

  // ------------------------------------------------------------------ ruff ---
  if (kind === 'ruff') {
    // A collar of spikes around the neck, fanning out and down. Sized against
    // the head, not the torso: the skull is most of this creature and a ruff
    // measured off a tiny body disappears behind it entirely, which is what the
    // first version did. It still hangs from the body rather than the head, so
    // it stays put when the head turns instead of reading as a hat.
    const spikes = 7 + Math.round(amount * 9);
    const r = Math.max(a.torsoW * 0.9, a.headW * 0.3);
    const len = a.headW * (0.22 + amount * 0.4);
    // thick enough to be spikes: at a hair's width the outline swallows them
    // and a collar of blades comes out as a set of whiskers
    const geo = new THREE.ConeGeometry(a.headW * 0.1, len, 4);
    for (let i = 0; i < spikes; i++) {
      const t = (i / spikes) * Math.PI * 2;
      const wob = 0.65 + rng() * 0.7;
      const spike = new THREE.Mesh(geo, mats.growth);
      spike.position.set(Math.cos(t) * r, a.neckY, Math.sin(t) * r * 0.85);
      // Lean well past horizontal so the points clear the skull hanging over
      // them; a collar that only leans a little is a collar you cannot see.
      spike.rotation.z = -Math.cos(t) * 1.35;
      spike.rotation.x = Math.sin(t) * 1.35;
      spike.scale.setScalar(wob);
      withOutline(parent, spike, geo, ink * 0.7, mats.outline);
    }
    return;
  }

  // ---------------------------------------------------------------- plates ---
  if (kind === 'plates') {
    // a ridge down the spine, tallest in the middle
    const n = 4 + Math.round(amount * 5);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const h = a.torsoH * (0.12 + Math.sin(t * Math.PI) * 0.42 * amount);
      const geo = new THREE.ConeGeometry(a.torsoW * 0.22, h, 4);
      const plate = new THREE.Mesh(geo, mats.growth);
      plate.position.set(0, a.torsoY + a.torsoH * (0.42 - t * 0.75), -a.torsoW * 0.72);
      plate.rotation.x = -0.5;
      plate.scale.x = 0.4;
      withOutline(parent, plate, geo, ink * 0.7, mats.outline);
    }
    return;
  }

  // ----------------------------------------------------------------- studs ---
  if (kind === 'studs') {
    // Dark beads scattered over the torso. One instanced mesh: a hundred of
    // these as separate objects would cost more than the rest of the creature.
    const n = 6 + Math.round(amount * 26);
    const geo = new THREE.SphereGeometry(a.torsoW * (0.07 + amount * 0.07), 6, 5);
    const studs = new THREE.InstancedMesh(geo, mats.growth, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      // an even scatter over the torso ellipsoid, biased to the front
      const k = (i + 0.5) / n;
      const phi = Math.acos(1 - 2 * k);
      const theta = i * 2.399;
      m4.makeTranslation(
        Math.sin(phi) * Math.cos(theta) * a.torsoW * 0.96,
        a.torsoY + Math.cos(phi) * a.torsoH * 0.3,
        Math.sin(phi) * Math.sin(theta) * a.torsoW * 0.8,
      );
      studs.setMatrixAt(i, m4);
    }
    parent.add(studs);
    return;
  }

  // ----------------------------------------------------------------- bands ---
  // Rings around the limbs — the one ornament that puts something on the arms
  // and legs rather than on the trunk.
  const rings = 1 + Math.round(amount * 1.6);
  // A leg and an arm are not the same thickness, and a ring sized for one
  // floats off the other. Each takes the radius of the limb it goes on.
  for (const [limbs, r] of [[a.legs, a.legR], [a.shoulders, a.limbR * 0.85]]) {
    for (const limb of limbs) {
      for (let i = 0; i < rings; i++) {
        const geo = new THREE.TorusGeometry(r * 1.12, r * (0.22 + amount * 0.28), 5, 10);
        const band = new THREE.Mesh(geo, mats.trim);
        // limbs hang along their own -Y, so the ring lies across that
        band.rotation.x = Math.PI / 2;
        band.position.y = -r * 2.2 - i * r * 3.6;
        withOutline(limb, band, geo, ink * 0.5, mats.outline);
      }
    }
  }
}
