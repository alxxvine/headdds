import * as THREE from 'three';
import { surfaceByDir, orientTo } from './surface.js';
import { withOutline } from './materials.js';

// Ears are the one part that changes the silhouette from the side without
// touching the face, which is why they are here at all: two freaks with the
// same skull read as two creatures the moment one of them has flaps.
//
// They root on the real skin like everything else (surfaceByDir at ±X) and each
// one gets its own pivot, so a flap can swing with the head — the animator
// takes them alongside the hair strands.

export function addEars(parent, p, mats, S, rng) {
  const kind = p.earType;
  if (kind === 'none') return [];

  const base = p.earSize * S;
  const pivots = [];

  for (const side of [-1, 1]) {
    // Nothing says the two have to match, and a head where they do not is a
    // better head. Lopsidedness drives how far apart they get.
    const size = base * (1 + (rng() * 2 - 1) * (0.18 + p.lopsided * 0.5));
    // out and a little up: on a skull this round, straight out of the side sits
    // too low to read as an ear
    const hit = surfaceByDir(p, side * 1, p.earY * 0.9, -0.15);
    const pivot = new THREE.Group();
    orientTo(pivot, hit.point, hit.normal);
    parent.add(pivot);

    if (kind === 'holes') {
      // no ear at all, just a hole and a rim around it
      const rimGeo = new THREE.TorusGeometry(size * 0.5, size * 0.16, 5, 12);
      withOutline(pivot, new THREE.Mesh(rimGeo, mats.trim), rimGeo, p.outline * 0.4 * S, mats.outline);
      const pit = new THREE.Mesh(new THREE.SphereGeometry(size * 0.42, 8, 6), mats.cavity);
      pit.position.z = -size * 0.16;
      pivot.add(pit);
      pivots.push({ pivot, len: size, phase: side > 0 ? 0 : 1.6, stiffness: 0 });
      continue;
    }

    // orientTo gives this pivot a useful basis: +Z points out of the skull,
    // +Y is up, +X runs fore and aft. So an ear leans about X alone, which
    // keeps its own X axis on the head's fore-aft line — the axis to flatten
    // along. Rolling it about Z as well turns the flat face sideways and the
    // ear becomes a spike.
    //
    // These used to be cones, and a cone has a flat base. Whichever way it was
    // turned that base showed as a hard disc hanging off the head — an ear with
    // a lid on it. An ellipsoid has no flat face to show, so the shapes here
    // are all spheres under a scale.
    let geo;
    let mesh;
    if (kind === 'flaps') {
      // broad and hanging: down and a little out, tapering to a point
      geo = new THREE.SphereGeometry(1, 9, 7);
      mesh = new THREE.Mesh(geo, mats.trim);
      mesh.scale.set(size * 0.3, size * 1.5, size * 0.85);
      mesh.rotation.x = 2.6;                    // +Y swings to (0, -0.86, 0.51)
      mesh.position.set(0, -size * 1.2, size * 0.72);
    } else if (kind === 'fins') {
      // stiff and standing, up and a little out
      geo = new THREE.SphereGeometry(1, 9, 7);
      mesh = new THREE.Mesh(geo, mats.trim);
      mesh.scale.set(size * 0.24, size * 1.25, size * 0.8);
      mesh.rotation.x = 0.46;                   // +Y swings to (0, 0.9, 0.44)
      mesh.position.set(0, size * 1.08, size * 0.53);
    } else {
      // Trumpets: an open cone aimed straight out, dark inside. Open-ended, so
      // there is no lid — and its point is pushed back into the skull, so the
      // one hard edge it does have is the rim you are meant to see.
      geo = new THREE.ConeGeometry(size * 1.05, size * 1.9, 9, 1, true);
      mesh = new THREE.Mesh(geo, mats.trim);
      mesh.rotation.x = Math.PI / 2;            // +Y swings to +Z, straight out
      mesh.position.set(0, 0, size * 0.62);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(size * 0.9, size * 1.6, 9), mats.cavity);
      inner.rotation.x = Math.PI / 2;
      inner.position.set(0, 0, size * 0.5);
      pivot.add(inner);
    }

    withOutline(pivot, mesh, geo, p.outline * 0.5 * S, mats.outline);
    // flaps are heavy and swing; a fin is bone and barely moves
    pivots.push({
      pivot,
      len: size,
      phase: side > 0 ? 0 : 1.6,
      stiffness: kind === 'flaps' ? 0.7 : kind === 'trumpets' ? 0.25 : 0.1,
    });
  }

  return pivots;
}
