import * as THREE from 'three';
import { buildCreature } from '/home/user/headdds/src/creature/build.js';
import { randomize } from '/home/user/headdds/src/creature/schema.js';
import { createAnimator } from '/home/user/headdds/src/scene/animator.js';

// Every limb reduced to world-space capsules (segment + radius), measured on
// the real shapes: a rotated sphere's AABB is far bigger than the sphere.
function capsules(root, out, inv) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    const g = o.geometry, par = g.parameters || {};
    const s = new THREE.Vector3(); o.getWorldScale(s);
    const k = Math.max(s.x, s.y, s.z);
    const put = (a, b, r) => out.push({ a: a.applyMatrix4(inv), b: b.applyMatrix4(inv), r });
    if (g.type === 'SphereGeometry') {
      const c = new THREE.Vector3(); o.getWorldPosition(c);
      put(c.clone(), c.clone(), (par.radius ?? 0) * k);
    } else if (['CapsuleGeometry', 'CylinderGeometry', 'ConeGeometry'].includes(g.type)) {
      const h = (par.height ?? par.length ?? 0) / 2;
      const r = Math.max(par.radius ?? 0, par.radiusTop ?? 0, par.radiusBottom ?? 0) * k;
      put(new THREE.Vector3(0, -h, 0).applyMatrix4(o.matrixWorld), new THREE.Vector3(0, h, 0).applyMatrix4(o.matrixWorld), r);
    } else if (g.type === 'TubeGeometry') {
      // A tube's bounding box is useless for a curve that bends sideways, so
      // rebuild the real segments: TubeGeometry emits one ring of
      // (radialSegments + 1) vertices per tubular segment, in order.
      const pos = g.attributes.position;
      const ring = (par.radialSegments ?? 8) + 1;
      const rings = [];
      for (let i = 0; i + ring <= pos.count; i += ring) {
        const c = new THREE.Vector3();
        for (let j = 0; j < ring; j++) c.add(new THREE.Vector3().fromBufferAttribute(pos, i + j));
        c.divideScalar(ring).applyMatrix4(o.matrixWorld);
        rings.push(c);
      }
      for (let i = 1; i < rings.length; i++) put(rings[i - 1].clone(), rings[i].clone(), (par.radius ?? 0) * k);
    }
  });
  return out;
}

// distance between two segments
function segDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a < 1e-9 && e < 1e-9) return r.length();
  if (a < 1e-9) { t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1.dot(r);
    if (e < 1e-9) { s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  return d1.multiplyScalar(s).add(p1).sub(d2.multiplyScalar(t).add(p2)).length();
}

const overlap = (A, B) => {
  let worst = 0;
  for (const x of A) for (const y of B) {
    const gap = segDist(x.a, x.b, y.a, y.b) - x.r - y.r;
    if (gap < -worst) worst = -gap;
  }
  return worst;
};

const MOODS = [
  ['calm', { arousal: 0, anger: 0, fatigue: 0, attention: 0 }],
  ['alert', { arousal: 0.3, anger: 0, fatigue: 0, attention: 1 }],
  ['wired', { arousal: 1, anger: 0, fatigue: 0, attention: 1 }],
  ['hostile', { arousal: 1, anger: 1, fatigue: 0.2, attention: 1 }],
  ['spent', { arousal: 0.2, anger: 0, fatigue: 1, attention: 0.3 }],
  ['worst', { arousal: 1, anger: 1, fatigue: 1, attention: 1 }],
];

// Gestures are picked with Math.random, so two runs would compare different
// sequences. Pin it: every mood then sees the exact same gestures.
let _s = 123456789;
const seedRandom = () => { _s = 123456789; };
Math.random = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };

const N = Number(process.argv[2] || 120);
const report = {};
for (const [name] of MOODS) report[name] = { cross: 0, sink: 0, worstCross: 0, worstSink: 0, cSeed: 0, sSeed: 0, acts: new Map() };

for (let i = 0; i < N; i++) {
  const seed = 1000 + i * 7;

  for (const [name, drives] of MOODS) {
    // a fresh creature per mood: an animator captures its base pose from the
    // rig as it finds it, so reusing one mesh would hand the next animator the
    // previous one's leftovers as its rest pose
    const built = buildCreature(randomize(seed));
    const scale = 1;
    seedRandom();
    const an = createAnimator();
    // the floor is where the creature was built standing, not where its feet
    // happen to be mid-gesture: a hop lifts the legs and would otherwise read
    // as the arms sinking
    built.group.updateMatrixWorld(true);
    const floorInv = new THREE.Matrix4().copy(built.rig.root.matrixWorld).invert();
    const floor = Math.min(...built.rig.legs.flatMap((lg) => capsules(lg, [], floorInv)).map((c) => Math.min(c.a.y, c.b.y) - c.r));
    an.update(built.rig, built.stats, 1 / 60, { pointer: { x: 0, y: 0 }, active: false });
    Object.assign(an.drives, drives);

    for (let f = 0; f < 90; f++) {
      Object.assign(an.drives, drives); // hold the mood pinned
      an.update(built.rig, built.stats, 1 / 60, { pointer: { x: 0.3, y: 0.1 }, active: true });

      if (f % 6) continue;
      // measure in the creature's own frame: a whole-body turn is not a defect
      built.group.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(built.rig.root.matrixWorld).invert();
      const arms = built.rig.shoulders.map((sh) => capsules(sh, [], inv));
      const legs = built.rig.legs.map((lg) => capsules(lg, [], inv));

      // The invariants are: the two arms never cross, the two legs never fuse,
      // and no arm dips below the feet. An arm brushing the leg beside it is
      // not one of them — on a freak this squat they hang right next to it.
      let cross = 0;
      if (arms[0]?.length && arms[1]?.length) cross = Math.max(cross, overlap(arms[0], arms[1]));
      if (legs[0]?.length && legs[1]?.length) cross = Math.max(cross, overlap(legs[0], legs[1]));

      const armLow = Math.min(Infinity, ...arms.flat().map((c) => Math.min(c.a.y, c.b.y) - c.r));
      const sink = Math.max(0, floor - armLow);

      const R = report[name];
      if (cross > 0.02 * scale) {
        R.cross++;
        R.acts.set(an.action, (R.acts.get(an.action) || 0) + 1);
        if (cross > R.worstCross) { R.worstCross = cross; R.cSeed = seed; }
      }
      if (sink > 0.02 * scale) {
        R.sink++;
        R.acts.set(an.action, (R.acts.get(an.action) || 0) + 1);
        if (sink > R.worstSink) { R.worstSink = sink; R.sSeed = seed; }
      }
    }
    built.dispose();
  }
}

for (const [name] of MOODS) {
  const R = report[name];
  console.log(name.padEnd(8), `cross ${R.cross} (worst ${R.worstCross.toFixed(3)} @${R.cSeed})`,
    `sink ${R.sink} (worst ${R.worstSink.toFixed(3)} @${R.sSeed})`, [...R.acts].map(([a,n])=>`${a}:${n}`).join(' '));
}
console.log(`${N} creatures x ${MOODS.length} moods x 15 samples`);
