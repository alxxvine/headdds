// Checks that nothing glued to the skull lets the skull through it:
//   node tools/decal-sweep.mjs [creatures]
//
// The lips, the mouth's cavity, an eye socket, a nostril, a scar — each is a
// grid of points ON the skin, lifted off it by a small offset and joined by
// FLAT triangles. A flat triangle between three points of a curved surface
// passes UNDER the surface in the middle, and where that sag is deeper than the
// lift, the face comes through the patch. What a player sees is a wedge of bare
// skin cut out of the lip ring: "the lips do not paint the face everywhere".
//
// Two things about how this is measured, both learned the hard way:
//
//   It is measured against the SKULL THAT IS DRAWN, by raycast. headPoint is the
//   analytic surface the skull is generated FROM; the mesh is a polyhedron
//   through samples of it, and with a lump field finer than the tessellation the
//   two disagree by a tenth of a head radius. Comparing a decal to the analytic
//   surface measures the tessellation and not the artefact — it reported every
//   creature as broken by a mile.
//
//   And it is measured inside the triangles, not at their corners. The corners
//   are on the skin by construction; the whole question is what happens between
//   them.
//
// The answer is reported in each patch's own lift, so 1.0 is exactly "the skin
// has reached the patch" and anything above it is bare face showing.

import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { makeHeadGeometry } from '../src/creature/head.js';

const N = Number(process.argv[2] || 200);

const rc = new THREE.Raycaster();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c3 = new THREE.Vector3();
const q = new THREE.Vector3();
const dir = new THREE.Vector3();

/** the lift a patch was actually built with: its vertices minus the skin */
function liftOf(mesh, probe, inv) {
  const pos = mesh.geometry.attributes.position;
  let lift = 0;
  const step = Math.max(1, Math.floor(pos.count / 12));
  for (let i = 0; i < pos.count; i += step) {
    q.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
    if (q.lengthSq() < 1e-9) continue;
    dir.copy(q).normalize();
    rc.set(q.clone().addScaledVector(dir, 4), dir.clone().negate());
    const hit = rc.intersectObject(probe, false);
    if (hit.length) lift = Math.max(lift, q.length() - hit[0].point.length());
  }
  return Math.max(lift, 1e-4);
}

const rows = [];
for (let i = 0; i < N; i++) {
  const p = randomize(i * 11 + 3);
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);
  let head = null;
  c.rig.headPivot.traverse((o) => {
    if (!head && o.isMesh && o.geometry.type === 'IcosahedronGeometry'
      && o.material?.side !== THREE.BackSide) head = o;
  });
  const inv = new THREE.Matrix4().copy(head.matrixWorld).invert();
  // the same skull in its own coordinates, to shoot at
  const probe = new THREE.Mesh(makeHeadGeometry(p), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  probe.updateMatrixWorld(true);

  let band = 0;
  let disc = 0;
  c.rig.headPivot.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    if (o.geometry.type !== 'BufferGeometry' || !o.geometry.index) return;
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const lift = liftOf(o, probe, inv);
    let worst = 0;
    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(pos, idx.getX(t)).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      b.fromBufferAttribute(pos, idx.getX(t + 1)).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      c3.fromBufferAttribute(pos, idx.getX(t + 2)).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      for (const [wa, wb, wc] of [[0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [1 / 3, 1 / 3, 1 / 3]]) {
        q.set(a.x * wa + b.x * wb + c3.x * wc, a.y * wa + b.y * wb + c3.y * wc, a.z * wa + b.z * wb + c3.z * wc);
        if (q.lengthSq() < 1e-9) continue;
        dir.copy(q).normalize();
        rc.set(q.clone().addScaledVector(dir, 4), dir.clone().negate());
        const hit = rc.intersectObject(probe, false);
        if (hit.length) worst = Math.max(worst, (hit[0].point.length() - q.length()) / lift);
      }
    }
    if (o.userData.maw) band = Math.max(band, worst);
    else disc = Math.max(disc, worst);
  });

  rows.push({ seed: i * 11 + 3, band, disc, p });
  probe.geometry.dispose();
  c.dispose();
}

const share = (key) => (100 * rows.filter((r) => r[key] > 1).length / rows.length).toFixed(0);
const stat = (key) => {
  const v = rows.map((r) => r[key]).sort((x, y) => x - y);
  const at = (f) => v[Math.floor(f * (v.length - 1))].toFixed(2);
  return `median ${at(0.5)}  p90 ${at(0.9)}  max ${at(1)}`;
};

console.log(`${N} random creatures\n`);
console.log(`skin through the mouth's bands  ${share('band').padStart(3)}%   in the patch's own lift: ${stat('band')}`);
console.log(`skin through a disc decal       ${share('disc').padStart(3)}%   in the patch's own lift: ${stat('disc')}`);
console.log('  (over 1.00 means bare face is showing through the patch)');

for (const [key, label] of [['band', 'the mouth'], ['disc', 'a socket, a nostril or a scar']]) {
  console.log(`\nworst through ${label}:`);
  for (const r of rows.slice().sort((x, y) => y[key] - x[key]).slice(0, 4)) {
    console.log(`  seed ${r.seed} ${r[key].toFixed(2)}  maw ${r.p.mawShape} lips ${r.p.lips.toFixed(2)}`,
      `open ${r.p.mouthOpen.toFixed(2)} eyes ${r.p.eyeStyle} nose ${r.p.noseType}`,
      `| lumps ${r.p.lumps.toFixed(2)} at scale ${r.p.lumpScale.toFixed(1)}`);
  }
}
