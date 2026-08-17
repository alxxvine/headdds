import * as THREE from 'three';
import { surfaceByDir, orientTo } from './surface.js';
import { withOutline } from './materials.js';

// Whatever grows out of the crown. Every kind roots itself on the real skin
// (surfaceByDir) and lives in its own pivot group, so the animator can sway it
// — and so the outline shell, which is a sibling mesh, moves along with it.
//
// Each strand reports a `stiffness`: bristles barely move, antennae whip.

const CROWN = (i, n, rng, spreadMax = 0.45) => {
  const a = (i / Math.max(1, n)) * Math.PI * 2;
  const spread = 0.25 + rng() * spreadMax;
  return new THREE.Vector3(Math.cos(a) * spread, 1, Math.sin(a) * spread).normalize();
};

// Fur covers the skull rather than sprouting from the crown, so it needs a
// direction that reaches down the sides and round the back too.
const PELT = (i, n, rng) => {
  const k = (i + 0.5) / Math.max(1, n);
  const phi = Math.acos(1 - k * 1.35);       // crown down past the ear line
  const theta = i * 2.399 + rng() * 0.4;     // golden angle: a scatter, not a lattice
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  ).normalize();
};

/** A curved tube from the root, already translated into the pivot's space. */
function strandTube(hit, len, bend, radius, segments = 6, radial = 4) {
  const pts = [0, 0.35, 0.7, 1].map((t) =>
    hit.point.clone()
      .addScaledVector(hit.normal, len * t)
      .addScaledVector(bend, t * t)
      .sub(hit.point),
  );
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segments, radius, radial, false);
}

export function addHair(parent, p, mats, rng, S) {
  const kind = p.hairType;
  const strands = [];
  if (kind === 'none') return strands;

  const count = kind === 'crest' ? 1 : p.tendrils;
  if (kind !== 'crest' && count <= 0) return strands;

  // ---------------------------------------------------------------- crest ---
  if (kind === 'crest') {
    // a fin down the midline: a row of plates from brow to nape
    const plates = 11;
    const height = p.tendrilLen * S * 0.7;
    for (let i = 0; i < plates; i++) {
      const t = i / (plates - 1);
      // sweep the midline from above the brow, over the crown, to the nape
      const phi = Math.PI * (0.22 + t * 0.56);
      const hit = surfaceByDir(p, 0.0001, Math.sin(phi), Math.cos(phi));
      const h = height * (0.3 + Math.sin(t * Math.PI) * 0.9); // tallest in the middle
      const geo = new THREE.ConeGeometry(S * 0.1, h, 4);

      const pivot = new THREE.Group();
      orientTo(pivot, hit.point, hit.normal);
      const plate = new THREE.Mesh(geo, mats.growth);
      plate.rotation.x = Math.PI / 2; // cones point +Y; stand it along the normal
      // A razor-thin fin on the midline is a single line seen head-on, and this
      // creature is looked at head-on: lean the plates alternately so the crest
      // reads as a ragged ridge from the front too.
      plate.rotation.z = (i % 2 ? 1 : -1) * 0.22;
      plate.position.set((i % 2 ? 1 : -1) * S * 0.03, 0, h * 0.45);
      plate.scale.x = 0.45;
      withOutline(pivot, plate, geo, p.outline * 0.5 * S, mats.outline);
      parent.add(pivot);
      strands.push({ pivot, len: h, phase: t * 2.2, stiffness: 0.15 });
    }
    return strands;
  }

  // fur is a coat, not a hairdo: many more tufts, spread over the whole skull
  const total = kind === 'fur' ? count * 3 + 6 : count;

  for (let i = 0; i < total; i++) {
    const dir = kind === 'fur' ? PELT(i, total, rng)
      : kind === 'quills' ? CROWN(i, total, rng, 0.75)
      : CROWN(i, total, rng);
    const hit = surfaceByDir(p, dir.x, dir.y, dir.z);
    const len = p.tendrilLen * S * (0.6 + rng() * 0.8);
    const pivot = new THREE.Group();
    pivot.position.copy(hit.point);

    // ----------------------------------------------------------------- fur ---
    if (kind === 'fur') {
      // short, blunt and lying against the skull rather than standing off it
      const h = len * 0.3;
      const lie = new THREE.Vector3(-dir.x, -0.35, -dir.z).normalize();
      const geo = new THREE.ConeGeometry(S * 0.035, h, 3);
      const tuft = new THREE.Mesh(geo, mats.growth);
      tuft.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        hit.normal.clone().addScaledVector(lie, 0.55).normalize(),
      );
      tuft.position.copy(hit.normal).multiplyScalar(h * 0.35);
      pivot.add(tuft); // no outline: at this size the shell swallows the tuft
      strands.push({ pivot, len: h, phase: rng() * Math.PI * 2, stiffness: 0.08 });
    // -------------------------------------------------------------- quills ---
    } else if (kind === 'quills') {
      // long and swept back, like a startled porcupine that never calmed down
      const h = len * 1.45;
      const geo = new THREE.ConeGeometry(S * 0.032, h, 4);
      const quill = new THREE.Mesh(geo, mats.growth);
      const aim = hit.normal.clone().add(new THREE.Vector3(0, 0.25, -0.85)).normalize();
      quill.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), aim);
      quill.position.copy(aim).multiplyScalar(h * 0.48);
      withOutline(pivot, quill, geo, p.outline * 0.4 * S, mats.outline);
      strands.push({ pivot, len: h, phase: rng() * Math.PI * 2, stiffness: 0.2 });
    // -------------------------------------------------------------- fronds ---
    } else if (kind === 'fronds') {
      // flat leaves fanning off the crown, each turned a different way
      const h = len * 1.1;
      const geo = new THREE.ConeGeometry(S * 0.14, h, 3);
      const leaf = new THREE.Mesh(geo, mats.growth);
      leaf.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hit.normal);
      leaf.position.copy(hit.normal).multiplyScalar(h * 0.5);
      leaf.scale.z = 0.2;                       // a blade, not a spike
      leaf.rotateOnAxis(new THREE.Vector3(0, 1, 0), rng() * Math.PI);
      withOutline(pivot, leaf, geo, p.outline * 0.4 * S, mats.outline);
      strands.push({ pivot, len: h, phase: rng() * Math.PI * 2, stiffness: 0.75 });
    // ------------------------------------------------------------ bristles ---
    } else if (kind === 'bristles') {
      const h = len * 0.55;
      const geo = new THREE.ConeGeometry(S * 0.05, h, 4);
      const spike = new THREE.Mesh(geo, mats.growth);
      spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hit.normal);
      spike.position.copy(hit.normal).multiplyScalar(h * 0.45);
      withOutline(pivot, spike, geo, p.outline * 0.45 * S, mats.outline);
      strands.push({ pivot, len: h, phase: rng() * Math.PI * 2, stiffness: 0.12 });
    // ------------------------------------------------------------ antennae ---
    } else if (kind === 'antennae') {
      const bend = new THREE.Vector3((rng() - 0.5) * len * 0.7, 0, (rng() - 0.5) * len * 0.7);
      const geo = strandTube(hit, len, bend, S * 0.018);
      pivot.add(new THREE.Mesh(geo, mats.growth));
      const bulbGeo = new THREE.SphereGeometry(S * 0.055, 7, 5);
      const bulb = new THREE.Mesh(bulbGeo, mats.growth);
      bulb.position.copy(hit.normal).multiplyScalar(len).add(bend);
      withOutline(pivot, bulb, bulbGeo, p.outline * 0.4 * S, mats.outline);
      strands.push({ pivot, len, phase: rng() * Math.PI * 2, stiffness: 1.4 });
    // -------------------------------------------------------------- dreads ---
    } else if (kind === 'dreads') {
      // heavy ropes that flop down the sides of the skull instead of standing up
      const droop = new THREE.Vector3(hit.normal.x, -1.35, hit.normal.z)
        .normalize()
        .multiplyScalar(len * 0.9);
      const geo = strandTube(hit, len * 0.55, droop, S * 0.045, 7, 5);
      pivot.add(new THREE.Mesh(geo, mats.growth));
      strands.push({ pivot, len, phase: rng() * Math.PI * 2, stiffness: 0.55 });
    // ------------------------------------------------------------ tendrils ---
    } else {
      const bend = new THREE.Vector3((rng() - 0.5) * len * 0.9, 0, (rng() - 0.5) * len * 0.9);
      const geo = strandTube(hit, len, bend, S * 0.028);
      pivot.add(new THREE.Mesh(geo, mats.growth));
      strands.push({ pivot, len, phase: rng() * Math.PI * 2, stiffness: 1 });
    }

    parent.add(pivot);
  }

  return strands;
}
