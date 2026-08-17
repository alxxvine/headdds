// Checks that a random freak has proportions, not just parts:
//   node tools/proportion-sweep.mjs [creatures]
//
// Two different failures both read to a player as "the character broke", and
// neither one shows up in any check of the parts themselves.
//
//  - A PANCAKE: one dimension far smaller than the other two. Not the same as
//    a column — a freak twice as tall as it is wide is still a freak, so the
//    number to watch is mid/min of the three sorted extents, never any single
//    ratio of two axes.
//  - A WEDGE: a skull that fits a perfectly square box and still runs from a
//    tenth of its width at the crown to all of it at the jaw. The bounding box
//    says nothing about the shape inside it, so the width profile is measured
//    latitude by latitude.

import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { headPoint } from '../src/creature/head.js';

const N = Number(process.argv[2] || 400);

const box = new THREE.Box3();
const size = new THREE.Vector3();
const extents = (o) => { box.setFromObject(o); box.getSize(size); return size.clone(); };
const flatness = (v) => {
  const s = [v.x, v.y, v.z].sort((a, b) => a - b);
  return s[1] / Math.max(s[0], 1e-6);
};

// half-width of the skull at latitude dy, taken around the whole ring
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
function skullWidth(p, dy) {
  const c = Math.sqrt(Math.max(0, 1 - dy * dy));
  let w = 0;
  for (let a = 0; a < 16; a++) {
    const th = (a / 16) * Math.PI * 2;
    headPoint(p, _d.set(Math.cos(th) * c, dy, Math.sin(th) * c).normalize(), _p);
    w = Math.max(w, Math.hypot(_p.x, _p.z));
  }
  return w;
}

const rows = [];
for (let i = 0; i < N; i++) {
  const seed = i * 11 + 3;
  const p = randomize(seed);
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);

  const ws = [];
  for (let k = 0; k <= 16; k++) ws.push(skullWidth(p, -0.85 + (k / 16) * 1.7));
  const hi = Math.max(...ws);

  rows.push({
    seed, p,
    whole: flatness(extents(c.group)),
    torso: flatness(extents(c.rig.torso)),
    head: flatness(extents(c.rig.headPivot)),
    // how much of the skull's widest point is left at the crown and the chin
    crown: ws[ws.length - 1] / hi,
    chin: ws[0] / hi,
  });
  c.dispose();
}

const stat = (key, low) => {
  const v = rows.map((r) => r[key]).sort((a, b) => a - b);
  const q = (f) => v[Math.floor(f * (v.length - 1))].toFixed(2);
  return low
    ? `min ${q(0)}  p1 ${q(0.01)}  p10 ${q(0.1)}  median ${q(0.5)}`
    : `median ${q(0.5)}  p90 ${q(0.9)}  p99 ${q(0.99)}  max ${q(1)}`;
};
console.log(`${N} random creatures\n`);
console.log('flatness, mid/min of the three extents — a pancake is a large number');
for (const k of ['whole', 'torso', 'head']) console.log(' ', k.padEnd(7), stat(k, false));
console.log('\nskull width left at the ends, as a fraction of its widest — a wedge is a small number');
for (const k of ['crown', 'chin']) console.log(' ', k.padEnd(7), stat(k, true));

for (const [key, dir] of [['whole', -1], ['head', -1], ['crown', 1], ['chin', 1]]) {
  const worst = rows.slice().sort((a, b) => (a[key] - b[key]) * dir).slice(0, 3);
  console.log(`\nworst ${key}:`);
  for (const r of worst) {
    console.log(`  seed ${r.seed} ${key} ${r[key].toFixed(2)}`,
      `head ${r.p.headWidth.toFixed(2)}x${r.p.headHeight.toFixed(2)}x${r.p.headDepth.toFixed(2)}`,
      `taper ${r.p.taper.toFixed(2)} jaw ${r.p.jaw.toFixed(2)}`,
      `bands ${r.p.browWide.toFixed(2)}/${r.p.midWide.toFixed(2)}/${r.p.chinWide.toFixed(2)}`,
      `bodyW ${r.p.bodyWidth.toFixed(2)} ratio ${r.p.headRatio.toFixed(2)}`);
  }
}
