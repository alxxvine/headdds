import * as THREE from 'three';

// The bits that float around a freak rather than growing out of it. The spore
// cloud was the first of these and the one people notice, so it is now a family:
// a drifting cloud, a ring in orbit, rising bubbles, a swarm, a halo of shards.
//
// Every kind is one InstancedMesh — a hundred separate objects would cost more
// than the whole creature — and every one is returned in a group the animator
// spins and drifts. Where each mote sits is baked into the instance matrix; the
// motion is the group's, which is why a cloud of two hundred costs one
// transform a frame.

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * @param p        parameters
 * @param mats     materials — motes take the growth tone, so they glow with it
 * @param rng      the creature's own rng, so a seed always gets the same cloud
 * @param S        head unit
 * @param top      the y the skull's crown reaches
 * @returns a group to hang on the creature, or null
 */
export function addAura(p, mats, rng, S, top) {
  const kind = p.aura;
  const n = p.spores;   // the key predates the feature; renaming it breaks links
  if (kind === 'none' || n <= 0) return null;

  const group = new THREE.Group();
  const size = S * (0.02 + p.auraSize * 0.05);

  // Shards catch the light differently from cubes, and a swarm of spheres reads
  // as dust where a swarm of boxes reads as debris.
  const geo = kind === 'swarm' || kind === 'bubbles'
    ? new THREE.SphereGeometry(size, 5, 4)
    : kind === 'halo'
      ? new THREE.ConeGeometry(size * 1.1, size * 3.4, 4)
      : new THREE.BoxGeometry(size * 1.6, size * 1.6, size * 1.6);

  const inst = new THREE.InstancedMesh(geo, mats.growth, n);

  for (let i = 0; i < n; i++) {
    const t = rng();
    const a = rng() * Math.PI * 2;
    const scale = 0.5 + rng() * 1.2;
    _s.set(scale, scale, scale);
    _q.setFromAxisAngle(_v.set(rng(), rng(), rng()).normalize(), rng() * Math.PI);

    if (kind === 'ring') {
      // A flat band in orbit — the one kind with a shape you can read at a
      // glance rather than a scatter. It has to clear the skull's widest point,
      // and the skull is widest around its middle: a ring at that height with a
      // radius that sounded generous still ran straight through the face.
      const r = S * (1.25 + p.auraSize * 0.6) * (0.94 + rng() * 0.12);
      const k = (i / n) * Math.PI * 2;
      _v.set(Math.cos(k) * r, top * 0.8 + (rng() - 0.5) * S * 0.09, Math.sin(k) * r);
    } else if (kind === 'halo') {
      // A crown of shards standing over the head. It has to sit close: floated
      // a third of a head above the skull, which is what a generous-sounding
      // offset came to, it stops reading as part of the creature and becomes
      // scenery at the top of the frame. Each leans outwards so the ring reads
      // as a crown rather than a row of pickets.
      const r = S * (0.42 + p.auraSize * 0.3);
      const k = (i / n) * Math.PI * 2;
      _v.set(Math.cos(k) * r, top + S * 0.08, Math.sin(k) * r);
      _q.setFromEuler(new THREE.Euler(Math.sin(k) * 0.4, -k, -Math.cos(k) * 0.4));
    } else if (kind === 'bubbles') {
      // a column rising off the crown, thinning as it goes
      const r = Math.sqrt(rng()) * S * (0.12 + t * 0.4);
      _v.set(Math.cos(a) * r, top + t * S * 1.5, Math.sin(a) * r);
    } else if (kind === 'swarm') {
      // a shell all the way around the creature, not just over its head
      const phi = Math.acos(1 - 2 * ((i + 0.5) / n));
      const theta = i * 2.399;
      const r = S * (1.3 + p.auraSize * 0.7) * (0.85 + rng() * 0.3);
      _v.set(
        Math.sin(phi) * Math.cos(theta) * r,
        top * 0.35 + Math.cos(phi) * r * 0.7,
        Math.sin(phi) * Math.sin(theta) * r,
      );
    } else {
      // spores: the original drifting cloud above the crown
      const r = Math.sqrt(rng()) * (0.08 + t * 0.75) * S;
      _v.set(Math.cos(a) * r, top + t * S * 1.1, Math.sin(a) * r);
    }

    _m4.compose(_v, _q, _s);
    inst.setMatrixAt(i, _m4);
  }
  inst.instanceMatrix.needsUpdate = true;

  group.add(inst);
  return group;
}
