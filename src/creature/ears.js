import * as THREE from 'three';
import { surfaceByDir, orientTo, skinAlong } from './surface.js';
import { withOutline } from './materials.js';
import { warpGeometry, warpRoll } from './warp.js';

const _ev = new THREE.Vector3();
const _ed = new THREE.Vector3();

// Ears are the one part that changes the silhouette from the side without
// touching the face, which is why they are here at all: two freaks with the
// same skull read as two creatures the moment one of them has flaps.
//
// They root on the real skin like everything else (surfaceByDir at ±X) and each
// one gets its own pivot, so a flap can swing with the head — the animator
// takes them alongside the hair strands.

export function addEars(parent, headMesh, p, mats, S, rng) {
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
      const rimGeo = warpGeometry(new THREE.TorusGeometry(size * 0.5, size * 0.16, 6, 14),
        rng(), warpRoll(p, rng, 0.5));
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
    // Ellipsoids under a scale, because a cone has a flat base and whichever
    // way it is turned that base shows as a hard disc hanging off the head.
    // What separates one kind from another is where it sits, how it leans and
    // how it is squashed — plus the warp, which stops the two sides matching.
    const ell = (sx, sy, sz, lean, px, py, pz) => {
      geo = warpGeometry(new THREE.SphereGeometry(1, 11, 9), rng(), warpRoll(p, rng));
      mesh = new THREE.Mesh(geo, mats.trim);
      mesh.scale.set(size * sx, size * sy, size * sz);
      mesh.rotation.x = lean;
      mesh.position.set(px * size, py * size, pz * size);
    };

    let geo;
    let mesh;
    if (kind === 'cups') {
      // a dish turned forward, listening at you
      ell(0.95, 1.05, 0.42, 1.35, 0, 0.25, 0.72);
    } else if (kind === 'leaf') {
      // broad and flat, standing off the skull like a leaf on a stem
      ell(0.22, 1.5, 1.1, 0.9, 0, 0.5, 0.9);
    } else if (kind === 'bat') {
      // tall, narrow and swept back
      ell(0.2, 1.9, 0.55, -0.35, 0, 1.5, 0.35);
    } else if (kind === 'droop') {
      // a long lobe hanging straight down the side of the head
      ell(0.3, 2.1, 0.6, 3.0, 0, -1.7, 0.5);
    } else if (kind === 'stub') {
      // barely an ear: a knob on the side of the skull
      ell(0.6, 0.6, 0.6, 0, 0, 0.15, 0.4);
    } else if (kind === 'tube') {
      // A pipe stuck out sideways, open at the far end — and buried at the near
      // one. Both cylinders used to START at the skin: the outer is open at
      // both ends and the dark bore inside it is not, so from three quarters
      // you saw the bore's flank as a dark collar around the root and the ear
      // read as a separate object butted against the head rather than a hole
      // through it. A pipe has to begin inside the skull it is a pipe into.
      geo = warpGeometry(new THREE.CylinderGeometry(size * 0.4, size * 0.55, size * 1.95, 9, 3, true),
        rng(), warpRoll(p, rng, 0.7));
      mesh = new THREE.Mesh(geo, mats.trim);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(0, 0, size * 0.62);
      const bore = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.3, size * 0.44, size * 1.85, 8), mats.cavity);
      bore.rotation.x = Math.PI / 2;
      bore.position.set(0, 0, size * 0.55);
      pivot.add(bore);
    } else if (kind === 'frills') {
      // not one ear but a row of small ones down the jaw line
      for (let i = 0; i < 3; i++) {
        const g = warpGeometry(new THREE.SphereGeometry(1, 9, 7), rng(), warpRoll(p, rng));
        const m = new THREE.Mesh(g, mats.trim);
        const k = size * (0.85 - i * 0.18);
        m.scale.set(k * 0.18, k * 0.85, k * 0.6);
        m.rotation.x = 2.2 + i * 0.25;
        m.position.set(0, -i * size * 0.55 - size * 0.3, size * (0.55 - i * 0.08));
        withOutline(pivot, m, g, p.outline * 0.4 * S, mats.outline);
      }
      pivots.push({ pivot, len: size, phase: side > 0 ? 0 : 1.6, stiffness: 0.45 });
      continue;
    } else if (kind === 'spines') {
      // a cluster of small spikes where an ear would be
      for (let i = 0; i < 4; i++) {
        const g = warpGeometry(new THREE.ConeGeometry(size * 0.16, size * (0.8 + i * 0.22), 5, 3),
          rng(), warpRoll(p, rng, 0.8));
        const m = new THREE.Mesh(g, mats.growth);
        m.rotation.x = Math.PI / 2 - 0.5 + i * 0.28;
        m.rotation.z = (i - 1.5) * 0.3;
        m.position.set(0, (i - 1.5) * size * 0.22, size * 0.5);
        withOutline(pivot, m, g, p.outline * 0.4 * S, mats.outline);
      }
      pivots.push({ pivot, len: size, phase: side > 0 ? 0 : 1.6, stiffness: 0.05 });
      continue;
    } else if (kind === 'curl') {
      // a ram's curl, three segments tightening as they go
      for (let i = 0; i < 3; i++) {
        const g = warpGeometry(new THREE.SphereGeometry(size * (0.5 - i * 0.11), 9, 7),
          rng(), warpRoll(p, rng, 0.6));
        const m = new THREE.Mesh(g, mats.growth);
        const a = i * 1.15;
        m.position.set(0, Math.sin(a) * size * 0.75, size * (0.4 + Math.cos(a) * 0.7));
        withOutline(pivot, m, g, p.outline * 0.4 * S, mats.outline);
      }
      pivots.push({ pivot, len: size, phase: side > 0 ? 0 : 1.6, stiffness: 0.05 });
      continue;
    } else if (kind === 'fan') {
      // a pleated fan standing off the skull, three blades from one root
      for (let i = 0; i < 3; i++) {
        const g = warpGeometry(new THREE.SphereGeometry(1, 9, 7), rng(), warpRoll(p, rng));
        const m = new THREE.Mesh(g, mats.trim);
        m.scale.set(size * 0.14, size * (1.3 - i * 0.15), size * 0.55);
        m.rotation.x = 0.2;
        m.rotation.z = (i - 1) * 0.42;
        m.position.set(0, size * 1.0, size * 0.5);
        withOutline(pivot, m, g, p.outline * 0.4 * S, mats.outline);
      }
      pivots.push({ pivot, len: size, phase: side > 0 ? 0 : 1.6, stiffness: 0.35 });
      continue;
    } else if (kind === 'flaps') {
      // broad and hanging: down and a little out, tapering to a point
      geo = warpGeometry(new THREE.SphereGeometry(1, 11, 9), rng(), warpRoll(p, rng));
      mesh = new THREE.Mesh(geo, mats.trim);
      mesh.scale.set(size * 0.3, size * 1.5, size * 0.85);
      mesh.rotation.x = 2.6;                    // +Y swings to (0, -0.86, 0.51)
      mesh.position.set(0, -size * 1.2, size * 0.72);
    } else if (kind === 'fins') {
      // stiff and standing, up and a little out
      geo = warpGeometry(new THREE.SphereGeometry(1, 11, 9), rng(), warpRoll(p, rng));
      mesh = new THREE.Mesh(geo, mats.trim);
      mesh.scale.set(size * 0.24, size * 1.25, size * 0.8);
      mesh.rotation.x = 0.46;                   // +Y swings to (0, 0.9, 0.44)
      mesh.position.set(0, size * 1.08, size * 0.53);
    } else {
      // Trumpets: an open cone aimed straight out, dark inside. Open-ended, so
      // there is no lid — and its point is pushed back into the skull, so the
      // one hard edge it does have is the rim you are meant to see.
      geo = warpGeometry(new THREE.ConeGeometry(size * 1.05, size * 1.9, 10, 3, true),
        rng(), warpRoll(p, rng, 0.7));
      mesh = new THREE.Mesh(geo, mats.trim);
      mesh.rotation.x = Math.PI / 2;            // +Y swings to +Z, straight out
      mesh.position.set(0, 0, size * 0.62);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(size * 0.9, size * 1.6, 9), mats.cavity);
      inner.rotation.x = Math.PI / 2;
      inner.position.set(0, 0, size * 0.5);
      pivot.add(inner);
    }

    // A collar of skin where the ear meets the head. Without it the ear's own
    // surface stops dead at the skull and the two read as two objects touching
    // — the report was "the ear falls off", and it is the join that says so,
    // not the ear. A low swelling in the SKIN colour, half of it inside the
    // head, gives the eye the flare it expects where a thing grows out of a
    // thing. It is deliberately smaller than the ear so the silhouette is still
    // the ear's.
    const collar = new THREE.Mesh(new THREE.SphereGeometry(size * 0.62, 10, 7), mats.skin);
    collar.scale.set(1, 1, 0.5);
    collar.position.z = -size * 0.12;
    pivot.add(collar);

    withOutline(pivot, mesh, geo, p.outline * 0.5 * S, mats.outline);
    // flaps are heavy and swing; a fin is bone and barely moves
    pivots.push({
      pivot,
      len: size,
      phase: side > 0 ? 0 : 1.6,
      stiffness: kind === 'flaps' ? 0.7 : kind === 'trumpets' ? 0.25 : 0.1,
    });
  }

  // Every ear is rooted ON the skin, and half the kinds never get any further
  // in than that: a fin, a flap, a stub or a hole reaches a thousandth of a head
  // radius past the surface, which is touching rather than entering. An ear
  // that only touches shows its own back end — the near rim of a pipe, the flat
  // side of a plate, the dark inside of anything hollow — and its outline draws
  // a hard black line all the way round the join. What a player sees is an ear
  // butted against the head rather than growing out of it: "the ear falls off".
  //
  // So each one is pushed in along its own normal until enough of it is inside
  // the skull to hide the join. Measured on what was built, because how deep a
  // kind already reaches is a property of its shape and not worth a table.
  parent.updateMatrixWorld(true);
  for (const st of pivots) {
    const want = Math.min(st.len * 0.4, S * 0.16);
    let deepest = -Infinity;
    st.pivot.traverse((o) => {
      if (!o.isMesh || o.material?.side === THREE.BackSide) return;
      const pos = o.geometry.attributes.position;
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 40));
      for (let k = 0; k < pos.count; k += step) {
        _ev.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
        if (_ev.lengthSq() < 1e-9) { deepest = Math.max(deepest, 9); continue; }
        _ed.copy(_ev).normalize();
        // against the skull that is DRAWN, not the surface it is sampled from:
        // the two differ by as much as the burial itself
        deepest = Math.max(deepest, skinAlong(headMesh, _ed) - _ev.length());
      }
    });
    if (deepest > -Infinity && deepest < want) {
      _ed.copy(st.pivot.position).normalize();
      st.pivot.position.addScaledVector(_ed, -(want - deepest));
    }
  }

  return pivots;
}
