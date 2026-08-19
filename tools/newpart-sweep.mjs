// Rest-pose invariants for every arm/hand/leg/foot kind, each one forced in
// turn over a population of random freaks:
//   node tools/newpart-sweep.mjs [seeds-per-kind]
//
// For each kind: the build must not throw, no arm may dip below the feet or
// cross the midline, and the legs must both touch the floor without crossing.
// Measured on the transformed vertices of the real meshes — exact, warp and
// all.

import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize, PARAM_BY_KEY } from '../src/creature/schema.js';

// Exact, vertex-level measurement: the mesh IS its vertices, warp included.
// Analytic shells (capsule radii, ellipsoid axes) all overestimate somewhere;
// the transformed vertex cloud does not.
const _v = new THREE.Vector3();
function scan(root) {
  let loY = Infinity, loXL = Infinity, loXR = Infinity;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    const pos = o.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (_v.y < loY) loY = _v.y;
      if (-_v.x < loXL) loXL = -_v.x;   // reach towards the midline from the left
      if (_v.x < loXR) loXR = _v.x;     // ...and from the right
    }
  });
  return { loY, inner: (side) => (side < 0 ? loXL : loXR) };
}

const N = Number(process.argv[2] || 40);

const KINDS = [
  ['armType', PARAM_BY_KEY.armType.options.map((o) => o.value)],
  ['handType', PARAM_BY_KEY.handType.options.map((o) => o.value)],
  ['legType', PARAM_BY_KEY.legType.options.map((o) => o.value)],
  ['footType', PARAM_BY_KEY.footType.options.map((o) => o.value)],
];

let failures = 0;

for (const [key, values] of KINDS) {
  for (const value of values) {
    let armSink = 0, armCross = 0, legSink = 0, legFloat = 0, legCross = 0, thrown = 0;
    let worst = { sink: 0, seed: 0 };
    for (let i = 0; i < N; i++) {
      const seed = 40000 + i * 13;
      const p = { ...randomize(seed), [key]: value };
      // a hand needs an arm to hang off, feet need legs that reach the floor
      if (key === 'handType') p.armType = ['stick', 'noodle', 'mantis', 'tentacle', 'branch'][i % 5];
      let built;
      try {
        built = buildCreature(p);
      } catch (e) {
        thrown++;
        if (thrown === 1) console.log(`  THROWS ${key}=${value} @${seed}: ${e.message}`);
        continue;
      }
      built.group.updateMatrixWorld(true);
      const S = built.rig.scale;

      for (const sh of built.rig.shoulders) {
        const m = scan(sh);
        if (m.loY < -0.02 * S) { armSink++; if (-m.loY > worst.sink) worst = { sink: -m.loY, seed }; }
        if (m.inner(sh.userData.side) < -0.01 * S) armCross++;
      }
      built.rig.legs.forEach((leg, li) => {
        const m = scan(leg);
        if (m.loY < -0.03 * S) legSink++;
        if (m.loY > 0.12 * S) legFloat++;
        if (m.inner(li === 0 ? -1 : 1) < -0.005 * S) legCross++;
      });
      built.dispose();
    }
    const bad = armSink + armCross + legSink + legFloat + legCross + thrown;
    failures += bad;
    const tag = bad ? 'FAIL' : ' ok ';
    console.log(`${tag} ${key}=${value.padEnd(9)} armSink ${armSink} armCross ${armCross} legSink ${legSink} legFloat ${legFloat} legCross ${legCross} throws ${thrown}`
      + (worst.sink ? ` (worst sink ${worst.sink.toFixed(3)} @${worst.seed})` : ''));
  }
}

// distribution: every kind must actually come up under RANDOM, none dominate
console.log('\nrandom distribution over 400 seeds:');
for (const [key] of KINDS) {
  const seen = new Map();
  for (let i = 0; i < 400; i++) {
    const v = randomize(90000 + i * 31)[key];
    seen.set(v, (seen.get(v) || 0) + 1);
  }
  const parts = PARAM_BY_KEY[key].options.map((o) => `${o.value}:${seen.get(o.value) || 0}`);
  console.log(` ${key.padEnd(9)} ${parts.join(' ')}`);
}

process.exit(failures ? 1 : 0);
