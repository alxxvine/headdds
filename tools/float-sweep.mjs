// Checks that nothing on the head is floating beside it:
//   node tools/float-sweep.mjs [creatures]
//
// The audit kept reporting the same thing in different words — "flecks hanging
// in black space around the head", "a hollow triangle on the cheek", "a third
// eye separated from the skull by a gap, touching at a nub". They are all one
// defect: a part planted through a bad surface hit, or pushed out along a
// normal further than its own root, ends up NEAR the head instead of on it. At
// this resolution whatever joins it to the face is a pixel wide or missing, so
// it reads as debris.
//
// Measured radially against the analytic skin: for every mesh, the smallest gap
// between any of its vertices and the skull under that vertex. A part sitting
// on the face has a vertex at zero. Hair, spores and eye stalks are rooted
// somewhere and reach out on purpose, so they are asked about at their root
// rather than at their tip.

import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { headPoint } from '../src/creature/head.js';

const N = Number(process.argv[2] || 400);

const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

/** smallest radial gap between a mesh's vertices and the skin, in head units */
function gapOf(mesh, headMesh) {
  const pos = mesh.geometry.attributes.position;
  let best = Infinity;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    headMesh.worldToLocal(_v);
    if (_v.lengthSq() < 1e-9) return 0;
    _d.copy(_v).normalize();
    headPoint(mesh.userData.p, _d, _s);
    best = Math.min(best, _v.length() - _s.length());
    if (best <= 0) return 0;
  }
  return best;
}

const rows = [];
for (let i = 0; i < N; i++) {
  const p = randomize(i * 11 + 3);
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);
  const headMesh = c.rig.headPivot.children[0];
  const S = c.rig.scale;

  // the things that are meant to reach away from the head, and their roots
  const rooted = new Set();
  for (const t of c.rig.tendrils) t.pivot.traverse((o) => rooted.add(o));
  if (c.rig.spores) (Array.isArray(c.rig.spores) ? c.rig.spores : [c.rig.spores])
    .forEach((s) => s?.traverse?.((o) => rooted.add(o)));
  for (const e of c.rig.eyes) if (e.stalk) e.stalk.traverse((o) => rooted.add(o));

  // Asked per PART, not per mesh. A trunk is five spheres in a row and a crest
  // is a chain of segments: only the first of them touches the skin, and
  // measuring each mesh on its own calls every one of the others debris.
  let worst = 0;
  let who = '';
  const head = c.rig.headPivot.children[0].parent;
  for (const part of head.children) {
    if (part === headMesh || rooted.has(part)) continue;
    let gap = Infinity;
    let kind = '';
    part.traverse((o) => {
      if (!o.isMesh || o.material?.side === THREE.BackSide || rooted.has(o) || o.isInstancedMesh) return;
      o.userData.p = p;
      const g = gapOf(o, headMesh);
      if (g < gap) { gap = g; kind = o.geometry.type; }
    });
    if (gap !== Infinity && gap / S > worst) { worst = gap / S; who = `${kind} in ${part.type}`; }
  }
  rows.push({ seed: i * 11 + 3, worst, who, p });
  c.dispose();
}

const share = (over) => (100 * rows.filter((r) => r.worst > over).length / rows.length).toFixed(0);
const v = rows.map((r) => r.worst).sort((a, b) => a - b);
const q = (f) => v[Math.floor(f * (v.length - 1))].toFixed(3);
console.log(`${N} random creatures\n`);
console.log(`parts floating off the head  ${share(0.06).padStart(3)}%   gap in head units: median ${q(0.5)}  p90 ${q(0.9)}  max ${q(1)}`);
console.log('\nworst:');
for (const r of rows.slice().sort((a, b) => b.worst - a.worst).slice(0, 8)) {
  console.log(`  seed ${r.seed} ${r.worst.toFixed(3)} ${r.who}  eyes ${r.p.eyeStyle}/${r.p.eyeLayout}/${r.p.eyeCount}`,
    `nose ${r.p.noseType} horns ${r.p.growthType} ears ${r.p.earType} aura ${r.p.aura}`);
}
