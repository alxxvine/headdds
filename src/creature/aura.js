import * as THREE from 'three';
import { headPoint } from './head.js';

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
const _s2 = new THREE.Vector3();
const _s3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const TIP = new THREE.Vector3(1, 0, 0);

/**
 * @param p        parameters
 * @param mats     materials — motes take the mote tone, which glows
 * @param rng      the creature's own rng, so a seed always gets the same cloud
 * @param S        head unit
 * @param top      the y the skull's crown reaches
 * @returns a group to hang on the creature, or null
 */
const REACH = new WeakMap();

/**
 * How far the skull reaches at a given angle down from its pole, taken as the
 * widest it gets anywhere around that latitude. Cached per creature and per
 * angle, because the halo asks for the same one sixty times.
 */
function crownReach(p, down) {
  let byAngle = REACH.get(p);
  if (!byAngle) { byAngle = new Map(); REACH.set(p, byAngle); }
  // Buckets of ~0.9deg were fine when one kind asked; now every mote of every
  // kind asks, and at a thousand buckets the cache never hits — ten thousand
  // headPoint calls per aura, measured as a third of the whole build. A
  // 1.4deg bucket is well inside the margin the push adds anyway.
  const key = Math.round(down * 40);
  let r = byAngle.get(key);
  if (r !== undefined) return r;
  r = 0;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    headPoint(p, _s3.set(Math.cos(a) * Math.sin(down), Math.cos(down), Math.sin(a) * Math.sin(down)), _s2);
    r = Math.max(r, _s2.length());
  }
  byAngle.set(key, r);
  return r;
}

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

  const inst = new THREE.InstancedMesh(geo, mats.mote, n);

  for (let i = 0; i < n; i++) {
    const t = rng();
    const a = rng() * Math.PI * 2;
    const scale = 0.5 + rng() * 1.2;
    _s.set(scale, scale, scale);
    _q.setFromAxisAngle(_v.set(rng(), rng(), rng()).normalize(), rng() * Math.PI);

    if (kind === 'ring') {
      // A flat band in orbit. Put around the widest part of the skull it needs
      // a radius wider than the head, and from the front that is a heavy bar
      // drawn straight across the face — the shape reads as something wrong
      // with the creature rather than as something around it. Above the crown
      // it reads as a halo from every angle, and it can be small enough to
      // stay in frame.
      //
      // ...and the band is TIPPED. Lying flat it is edge-on to a camera that
      // stands level with the creature, and forty motes at one height stop
      // being a ring at all: they line up into a solid white plank hanging in
      // the air over the head, which is what it read as from every azimuth.
      // Tipped, the far side rides above the near one and the shape reads as
      // an ellipse — and the animator's slow spin about Y then turns it,
      // instead of sliding it along itself invisibly.
      const r = S * (0.5 + p.auraSize * 0.4) * (0.94 + rng() * 0.12);
      const k = (i / n) * Math.PI * 2;
      _v.set(Math.cos(k) * r, (rng() - 0.5) * S * 0.06, Math.sin(k) * r);
      _v.applyAxisAngle(TIP, 0.42);
      _v.y += top + S * 0.24;
    } else if (kind === 'halo') {
      // A crown of shards standing ON the head. Twice now this has been solved
      // by picking a RADIUS and hunting for the skin at it — and twice the
      // radius turned out to be most of a head wide, so the "crown" came out as
      // a belt of spikes around the middle of the face, at whatever ragged
      // height each lump of the skull happened to reach it.
      //
      // The angle down from the pole is the thing that means "on the crown", so
      // the angle is what is chosen; the radius is then whatever the head is.
      // A crown stays a crown on a pinhead and on a pumpkin.
      // ...and it is seated at the widest the skull gets ANYWHERE round that
      // latitude, not at the skin under each shard. The animator spins this
      // whole group, so a shard seated on the skin where it was built swings
      // round to an azimuth where a lopsided, lumpy skull is fatter — and sinks
      // into the head. A crown that turns has to clear the head it turns on.
      const down = 0.45 + p.auraSize * 0.4;
      const k = (i / n) * Math.PI * 2;
      _v.set(Math.cos(k) * Math.sin(down), Math.cos(down), Math.sin(k) * Math.sin(down));
      _v.setLength(crownReach(p, down) * 1.02);
      // standing off the skin: up and out, leaning outwards with the crown
      _q.setFromUnitVectors(UP, _s3.set(Math.cos(k) * Math.sin(down) * 0.9, 1, Math.sin(k) * Math.sin(down) * 0.9).normalize());
    } else if (kind === 'bubbles') {
      // a column rising off the crown, thinning as it goes
      const r = Math.sqrt(rng()) * S * (0.12 + t * 0.4);
      _v.set(Math.cos(a) * r, top + t * S * 0.75, Math.sin(a) * r);
    } else if (kind === 'swarm') {
      // a shell all the way around the creature, not just over its head
      const phi = Math.acos(1 - 2 * ((i + 0.5) / n));
      const theta = i * 2.399;
      const r = S * (1.05 + p.auraSize * 0.5) * (0.85 + rng() * 0.3);
      _v.set(
        Math.sin(phi) * Math.cos(theta) * r,
        top * 0.35 + Math.cos(phi) * r * 0.7,
        Math.sin(phi) * Math.sin(theta) * r,
      );
      // A shell AROUND the creature, and the radius it was given is a guess off
      // two sliders — `S` is the average of headWidth and headHeight and says
      // nothing about the skull that was built from them. Half of a swarm was
      // inside the head, which the animator then spun: motes revolving through
      // a skull. Each one is pushed out until it clears the widest the head gets
      // anywhere round its own latitude, because the spin will take it there.
    } else {
      // spores: the original drifting cloud above the crown
      const r = Math.sqrt(rng()) * (0.08 + t * 0.75) * S;
      _v.set(Math.cos(a) * r, top + t * S * 0.6, Math.sin(a) * r);
    }

    // EVERY kind clears the skull, not only the swarm — and by the mote's own
    // size, not by its centre. A halo shard is a cone almost two mote-sizes
    // long, and seating its centre on the reach left one in seven of them cut
    // in half by the crown, which reads as a lump on the head rather than as
    // something floating over it. The push is along the mote's own radial, so
    // a ring stays a ring and a cloud stays a cloud, only inflated where the
    // skull is; and it uses the widest the head gets around that latitude,
    // because the animator will spin the whole group through it.
    if (_v.lengthSq() > 1e-9) {
      const half = kind === 'halo' ? size * 1.7 * scale : size * 1.2 * scale;
      const down = Math.acos(Math.max(-1, Math.min(1, _v.y / _v.length())));
      const need = crownReach(p, down) * (kind === 'swarm' ? 1.06 : 1.0) + half;
      if (_v.length() < need) _v.setLength(need);
    }

    _m4.compose(_v, _q, _s);
    inst.setMatrixAt(i, _m4);
  }
  inst.instanceMatrix.needsUpdate = true;

  group.add(inst);
  return group;
}
