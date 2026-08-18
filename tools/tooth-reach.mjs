// How far a tooth stands out of the HEAD:
//   node tools/tooth-reach.mjs [creatures] [toothType]
//
// addTeeth caps a tooth's length against the maw's profile and walks a curled
// tooth back until its TIP is inside the mouth in x. Nothing anywhere compares
// any part of a tooth to the skull it grows out of, and a tooth is a rod with
// two ends. So this measures the built meshes, every vertex of them, against
// the star-shaped surface: how far past the skin the furthest point of each
// tooth sits, which end of the rod it is, and how far out of the frontal
// silhouette it lies.
//
// Radial, not frontal: the report was "it sticks forward", which the frontal
// plane cannot see at all.

import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { headPoint, headHalfWidth as silhouetteAt } from '../src/creature/head.js';

const N = Number(process.argv[2] || 300);
const ONLY = process.argv[3] || null;

const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

/** mean radius of the skull, so a protrusion can be quoted as a share of it */
function headRadius(p) {
  let r = 0;
  for (let k = 0; k < 32; k++) {
    const a = Math.acos(1 - (2 * (k + 0.5)) / 32);
    const b = k * 2.39996;
    headPoint(p, _d.set(Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)), _s);
    r += _s.length();
  }
  return r / 32;
}

/** how far a head-local point is outside the skin, along its own direction */
function past(p, v) {
  if (v.lengthSq() < 1e-9) return -1;
  _d.copy(v).normalize();
  headPoint(p, _d, _s);
  return v.length() - _s.length();
}

const rows = [];
for (let i = 0; i < N; i++) {
  const p = randomize(i * 11 + 3);
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);
  const headMesh = c.rig.headPivot.children[0];
  const R = headRadius(p);
  const maw = c.rig.maw;

  let out = 0;          // furthest any tooth vertex stands past the skin, in head radii
  let outIsTip = 0;     // was that the biting end (1) or the root end (0)
  let sil = 0;          // furthest past the frontal outline, in head radii
  let tipOut = 0;       // the biting end alone, past the skin
  let rootOut = 0;      // the planted end alone, past the skin

  c.rig.headPivot.traverse((o) => {
    const tag = o.userData.tooth;
    if (!tag) return;
    o.updateMatrixWorld(true);
    const pos = o.geometry.attributes.position;
    let far = 0;
    for (let k = 0; k < pos.count; k++) {
      _v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
      headMesh.worldToLocal(_v);
      far = Math.max(far, past(p, _v));
      const half = silhouetteAt(p, _v.y);
      if (half > 0 && Math.abs(_v.x) > half) sil = Math.max(sil, (Math.abs(_v.x) - half) / R);
    }
    // the two ends of the rod, taken in the mesh's own frame the way addTeeth
    // and face-sweep take them
    const tip = new THREE.Vector3(0, -tag.side * tag.len * 0.5, 0).applyMatrix4(o.matrixWorld);
    const root = new THREE.Vector3(0, tag.side * tag.len * 0.5, 0).applyMatrix4(o.matrixWorld);
    headMesh.worldToLocal(tip);
    headMesh.worldToLocal(root);
    const pt = past(p, tip);
    const pr = past(p, root);
    tipOut = Math.max(tipOut, pt / R);
    rootOut = Math.max(rootOut, pr / R);
    if (far / R > out) { out = far / R; outIsTip = pt >= pr ? 1 : 0; }
  });

  if (!ONLY || p.toothType === ONLY) {
    rows.push({ seed: i * 11 + 3, p, out, sil, tipOut, rootOut, outIsTip, mh: maw ? maw.mh : 0 });
  }
  c.dispose();
}

const stat = (key, sub = rows) => {
  const v = sub.map((r) => r[key]).sort((a, b) => a - b);
  if (!v.length) return 'none';
  const q = (f) => v[Math.floor(f * (v.length - 1))].toFixed(2);
  return `median ${q(0.5)}  p90 ${q(0.9)}  max ${q(1)}`;
};
const share = (key, over, sub = rows) => (100 * sub.filter((r) => r[key] > over).length / Math.max(1, sub.length)).toFixed(0);

console.log(`${rows.length} creatures\n`);
console.log(`teeth standing out of the SKIN   ${share('out', 0.15).padStart(3)}% over 0.15R   ${stat('out')}`);
console.log(`  ...at the biting end            ${stat('tipOut')}`);
console.log(`  ...at the planted end           ${stat('rootOut')}`);
console.log(`teeth past the frontal outline   ${share('sil', 0.02).padStart(3)}% over 0.02R   ${stat('sil')}`);
console.log(`worst point was the ROOT end     ${(100 * rows.filter((r) => r.out > 0.15 && !r.outIsTip).length / Math.max(1, rows.filter((r) => r.out > 0.15).length)).toFixed(0)}% of the bad ones`);

const kinds = [...new Set(rows.map((r) => r.p.toothType))].sort();
console.log('\nby kind (out of the skin, in head radii):');
for (const k of kinds) {
  const sub = rows.filter((r) => r.p.toothType === k);
  console.log(`  ${k.padEnd(9)} n=${String(sub.length).padStart(3)}  ${stat('out', sub)}   root ${stat('rootOut', sub)}`);
}

console.log('\nworst:');
for (const r of rows.slice().sort((a, b) => b.out - a.out).slice(0, 8)) {
  console.log(`  seed ${String(r.seed).padStart(6)} out ${r.out.toFixed(2)}R (${r.outIsTip ? 'tip' : 'ROOT'}) sil ${r.sil.toFixed(2)}`,
    `| ${r.p.toothType} size ${r.p.toothSize.toFixed(2)} maw ${r.p.mawShape} open ${r.p.mouthOpen.toFixed(2)}`,
    `top ${r.p.teethTop} bot ${r.p.teethBottom}`);
}
