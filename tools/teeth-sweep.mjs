// Where a tooth ends up — against the SKULL, not against the mouth:
//   node tools/teeth-sweep.mjs [creatures] [toothType]
//
// addTeeth caps a tooth's length against the maw profile and, for the two
// kinds that curl, walks the curl back until the TIP is inside the mouth in x
// and not too far outside the head. Everything it checks is one point: the
// biting end. A tooth is a rod with two ends, a curl about the mouth's X moves
// BOTH of them, and the end that leaves the face first on a hook is the ROOT.
//
// So this measures the built meshes — every vertex of the tooth AND of its
// outline shell, never a bounding box, since a rotated rod's AABB is a lie —
// against the drawn skull, radially, which is the direction the failure is in.
// It also replays addTeeth's own walk-back on the built tooth so the loop's
// estimate of "out" can be compared with the truth, and it re-poses the jaw
// hinge, because a bottom tooth is measured at rest and then animated.

import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { headPoint, headHalfWidth as silhouetteAt } from '../src/creature/head.js';
import { headUnit, headRadius } from '../src/creature/features.js';
import { skinProbe } from './lib-skin.mjs';

// `node tools/teeth-sweep.mjs 500` sweeps 500 creatures; `seeds:168,2690228`
// measures the named ones, which is how a seed the art director reported gets
// checked against the same numbers as the population.
const ARG = process.argv[2] || '400';
const SEEDS = ARG.startsWith('seeds:') ? ARG.slice(6).split(',').map(Number) : null;
const N = SEEDS ? SEEDS.length : Number(ARG);
const ONLY = process.argv[3] || null;

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();

/** mean radius of the DRAWN skull */
function drawnRadius(probe) {
  let r = 0;
  for (let k = 0; k < 64; k++) {
    const a = Math.acos(1 - (2 * (k + 0.5)) / 64);
    const b = k * 2.39996;
    r += probe.along(_d.set(Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)));
  }
  return r / 64;
}

/** the front of the skull at (x, y), by raycast on the drawn mesh */
const _rc = new THREE.Raycaster();
const _o = new THREE.Vector3();
const _dz = new THREE.Vector3(0, 0, -1);
function frontAt(headMesh, x, y) {
  // head-LOCAL in, head-local out. The head hangs on a pivot above the body,
  // so a ray built at a head-local (x, y) and fired in world space misses the
  // skull entirely and every point looks like it is off the side of the face.
  _o.set(x, y, 60);
  headMesh.localToWorld(_o);
  _rc.set(_o, _dz);
  const hits = _rc.intersectObject(headMesh, false);
  for (const h of hits) if (!h.face || h.face.normal.z > 0.05) return headMesh.worldToLocal(h.point.clone()).z;
  return null;
}

/** the head-local frame of an object */
function localMatrix(o, inv) {
  return new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
}

/** furthest any vertex of `geo` under `mat` stands past the skin, and where */
function reach(geo, mat, probe, split) {
  const pos = geo.attributes.position;
  let far = -Infinity;
  let farRoot = -Infinity;   // worst point in the root half
  let farTip = -Infinity;    // worst point in the tip half
  const at = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    _v.fromBufferAttribute(pos, k).applyMatrix4(mat);
    const d = probe.proud(_v);
    if (d > far) { far = d; at.copy(_v); }
    // split() says which half of the ROD this vertex came from, in the
    // geometry's own coordinates, before the matrix moved it
    const half = split(pos.getY(k));
    if (half > 0) { if (d > farRoot) farRoot = d; } else if (d > farTip) farTip = d;
  }
  let buried = 0;
  for (let k = 0; k < pos.count; k++) {
    _v.fromBufferAttribute(pos, k).applyMatrix4(mat);
    if (probe.proud(_v) < 0) buried++;
  }
  return { far, farRoot, farTip, at, buried: buried / pos.count };
}

// ------------------------------------------------------------------ CHECK --
// The probe first, on the one question whose answer is known: every vertex of
// the skull is a point of skin, so every one must come back at zero. The
// one-liner this file could have used instead — headPoint(p, v.normalized())
// — calls a third of them proud of the surface, because headPoint scales x, y
// and z by different amounts and so answers about a different direction. That
// is the same estimator addTeeth's walk-back uses, which is why its error is
// reported below rather than assumed away.
{
  const p0 = randomize(7013243);
  const c0 = buildCreature(p0);
  c0.group.updateMatrixWorld(true);
  const hm = c0.rig.headPivot.children[0].children[0];
  const pr = skinProbe(hm);
  const pos = hm.geometry.attributes.position;
  let worst = 0; let worstNaive = 0;
  const v = new THREE.Vector3();
  for (let k = 0; k < pos.count; k += 7) {
    v.fromBufferAttribute(pos, k);
    worst = Math.max(worst, Math.abs(pr.proud(v)));
    _d.copy(v).normalize(); headPoint(p0, _d, _s);
    worstNaive = Math.max(worstNaive, Math.abs(v.length() - _s.length()));
  }
  console.log(`probe on the skull's own ${pos.count} vertices: worst |gap| ${worst.toExponential(1)} ` +
    `(the headPoint one-liner addTeeth uses: ${worstNaive.toFixed(3)})\n`);
  c0.dispose();
}

const rows = [];
const teeth = [];
for (let i = 0; i < N; i++) {
  const seed = SEEDS ? SEEDS[i] : i * 11 + 3;
  const p = randomize(seed);
  if (ONLY && p.toothType !== ONLY) continue;
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);
  const head = c.rig.headPivot.children[0];
  const headMesh = head.children[0];
  const probe = skinProbe(headMesh);
  const R = drawnRadius(probe);
  const S = headUnit(p);
  const maw = c.rig.maw;
  const inv = new THREE.Matrix4().copy(headMesh.matrixWorld).invert();

  const mine = [];
  head.traverse((o) => {
    if (!o.userData.tooth) return;
    const { len, side } = o.userData.tooth;
    const frame = o.parent;
    frame.updateMatrixWorld(true);
    const flat = o.scale.z;
    const rot = o.rotation.x;
    // the curl the kind ASKED for, recovered from the mesh: the walk-back
    // stores position.z = 0.02S + 0.16*len*(rot/curl0), so the ratio it has
    // been reduced by is readable, and with it the original curl
    const ratio = (o.position.z - 0.02 * S) / (0.16 * len);
    const curl0 = Math.abs(ratio) > 1e-6 ? rot / ratio : rot;
    const steps = rot === 0 ? -1 : Math.round(Math.log(Math.max(1e-9, Math.abs(ratio))) / Math.log(0.7));

    const mat = localMatrix(o, inv);
    const split = (y) => y * side;      // >0 root half, <0 tip half
    const r = reach(o.geometry, mat, probe, split);
    // the outline shell is the same rod grown by `thickness`, drawn back
    // faces only, and it is what the player sees the edge of
    let shellFar = -Infinity;
    for (const sib of frame.children) {
      if (sib === o || !sib.isMesh || sib.material?.side !== THREE.BackSide) continue;
      shellFar = Math.max(shellFar, reach(sib.geometry, localMatrix(sib, inv), probe, split).far);
    }

    const tip = new THREE.Vector3(0, -side * len * 0.5, 0).applyMatrix4(mat);
    const root = new THREE.Vector3(0, side * len * 0.5, 0).applyMatrix4(mat);
    // what addTeeth's own estimator would have said about that tip
    _d.copy(tip).normalize(); headPoint(p, _d, _s);
    const guess = tip.length() - _s.length();

    const rec = {
      seed, kind: p.toothType, side, len, R, mh: maw.mh, mw: maw.mw,
      out: r.far / R, outRoot: r.farRoot / R, outTip: r.farTip / R,
      buried: r.buried, worst: r.at.clone(),
      shell: Number.isFinite(shellFar) ? shellFar / R : null,
      tipOut: probe.proud(tip) / R, rootOut: probe.proud(root) / R,
      guess: guess / R, curl0, rot, steps, flat,
      lenR: len / R, capHead: Math.abs(len - headRadius(p) * 0.45) < 1e-9 ? 1 : 0,
      radiusBias: headRadius(p) / R, count: side > 0 ? p.teethTop : p.teethBottom,
      x: (root.x - maw.mx) / Math.max(maw.mw, 1e-6),
      obj: o, frame, mat, probe, R, S, p,
    };
    mine.push(rec);
    teeth.push(rec);
  });

  // --- counterfactuals, replayed on the built tooth -----------------------
  // The loop as written stops when the TIP is inside the mouth in x and no
  // more than headR*0.28 outside the skull, and it asks headPoint about a
  // direction headPoint does not answer about. Replay it with each of those
  // three things changed, one at a time, and with the tolerance moved, and
  // measure what comes out — including how much of the curl survives, since a
  // cure that straightens every hook is not a cure.
  for (const t of mine) {
    if (!t.rot) continue;
    const o = t.obj;
    const keepR = o.rotation.x; const keepZ = o.position.z;
    const pose = (j) => {
      o.rotation.x = t.curl0 * Math.pow(0.7, j);
      o.position.z = 0.02 * t.S + t.len * 0.16 * Math.pow(0.7, j);
      o.updateMatrix(); t.frame.updateMatrixWorld(true);
      return localMatrix(o, inv);
    };
    const ends = (m) => {
      const a = probe.proud(new THREE.Vector3(0, -t.side * t.len * 0.5, 0).applyMatrix4(m));
      const b = probe.proud(new THREE.Vector3(0, t.side * t.len * 0.5, 0).applyMatrix4(m));
      return { tip: a, root: b };
    };
    const run = (tol, both) => {
      let j = 0;
      for (; j < 8; j++) {
        const m = pose(j);
        const e = ends(m);
        const v = both ? Math.max(e.tip, e.root) : e.tip;
        if (v <= t.R * tol) break;
      }
      const m = pose(j);
      return { out: reach(o.geometry, m, probe, (y) => y * t.side).far / t.R, keep: Math.pow(0.7, j) };
    };
    // the shove is unconditional: +0.16*len forward for ANY curl. It exists so
    // a hook, whose tip curls BACK into a solid skull, is not buried. A barb
    // curls the other way, so the same shove adds to an excursion that is
    // already forward. Sign of the tip's own z travel under the curl:
    //   dz = -side * len * 0.5 * sin(rot)   (independent of side)
    const shoveNeeded = () => {
      const dz = -t.side * t.len * 0.5 * Math.sin(t.curl0);
      return dz < 0 ? t.len * 0.16 : 0;
    };
    o.rotation.x = t.curl0;
    o.position.z = 0.02 * t.S + shoveNeeded();
    o.updateMatrix(); t.frame.updateMatrixWorld(true);
    {
      const m = localMatrix(o, inv);
      const rr = reach(o.geometry, m, probe, (y) => y * t.side);
      t.cfShove = rr.far / t.R;
      t.cfShoveBuried = rr.buried;
    }
    const a = run(0.28, false); t.cfTipTrue = a.out; t.cfTipTrueKeep = a.keep;
    const b = run(0.28, true);  t.cfBoth28 = b.out;
    const t12 = run(0.12, false); t.cfTip12 = t12.out;
    const cc = run(0.12, true); t.cfBoth12 = cc.out; t.cfBoth12Keep = cc.keep;
    const d = run(0.06, true);  t.cfBoth06 = d.out; t.cfBoth06Keep = d.keep;
    o.rotation.x = keepR; o.position.z = keepZ;
    o.updateMatrix(); t.frame.updateMatrixWorld(true);
  }

  // --- straight teeth: nothing checks them at all -------------------------
  // The loop lives inside `if (curl)`. Four teeth in five never enter it. A
  // straight tooth grows along the head's own +Y from its rim point, at the z
  // the rim had, while the face falls away underneath it — so its excursion is
  // pure length, and the only cure is to be shorter. How much shorter?
  for (const t of mine) {
    if (t.rot) continue;
    const o = t.obj;
    const keep = o.position.y;
    let f = 1;
    for (; f > 0.2; f -= 0.05) {
      // shrink about the rim: the tooth still starts where it was planted
      o.scale.y = f;
      o.position.y = -t.side * t.len * 0.45 * f - t.side * t.len * 0.05 * (1 - f);
      o.updateMatrix(); t.frame.updateMatrixWorld(true);
      if (reach(o.geometry, localMatrix(o, inv), probe, (y) => y * t.side).far <= t.R * 0.12) break;
    }
    t.shrinkTo = f;
    o.scale.y = 1; o.position.y = keep;
    o.updateMatrix(); t.frame.updateMatrixWorld(true);
  }

  // --- what the worst point of each tooth is actually doing ---------------
  // In front of the face, or out past the side of it? A fang standing off the
  // chin is the look; a rod out through a cheek is not, and the two are not
  // told apart by how far out they are.
  headMesh.geometry.computeBoundingBox();
  const bb = headMesh.geometry.boundingBox;
  for (const t of mine) {
    const w = t.worst;
    const zf = frontAt(headMesh, w.x, w.y);
    t.aheadOfFace = zf === null ? null : (w.z - zf) / t.R;   // >0 floating in front
    // the SIDE silhouette at this height: the front-most skin anywhere across
    // the face at that y. A tooth past it is a tooth you can see sticking out
    // of the profile, which is the complaint.
    let prof = -Infinity;
    for (let k = -10; k <= 10; k++) {
      const zf2 = frontAt(headMesh, (k / 10) * silhouetteAt(p, w.y) * 0.98, w.y);
      if (zf2 !== null) prof = Math.max(prof, zf2);
    }
    t.pastProfile = Number.isFinite(prof) ? (w.z - prof) / t.R : null;
    t.pastFront = (w.z - bb.max.z) / t.R;                    // >0 in front of the WHOLE skull
    const hw = silhouetteAt(p, w.y);
    t.pastSide = hw > 0 ? (Math.abs(w.x) - hw) / t.R : 1;
    t.belowChin = (bb.min.y - w.y) / t.R;
    t.dropBelowRim = (t.frame.position.y - w.y) / t.R;
  }

  // --- the jaw hinge -------------------------------------------------------
  const jawTeeth = mine.filter((t) => t.side < 0);
  const jawOut = {};
  const jawSlide = {};
  const planted = jawTeeth.map((t) => new THREE.Vector3(0, t.side * t.len * 0.5, 0).applyMatrix4(t.mat));
  for (const open of [0, 1, 2, 3, 4]) {
    c.rig.jaw.rotation.x = open * 0.09;
    c.group.updateMatrixWorld(true);
    let worst = -Infinity;
    let slid = 0;
    jawTeeth.forEach((t, i) => {
      worst = Math.max(worst, reach(t.obj.geometry, localMatrix(t.obj, inv), probe, (y) => y * t.side).far / R);
      const root = new THREE.Vector3(0, t.side * t.len * 0.5, 0).applyMatrix4(localMatrix(t.obj, inv));
      slid = Math.max(slid, root.distanceTo(planted[i]) / R);
    });
    jawOut[open] = jawTeeth.length ? worst : null;
    jawSlide[open] = jawTeeth.length ? slid : null;
  }
  c.rig.jaw.rotation.x = 0;
  c.group.updateMatrixWorld(true);

  // --- top row against bottom row ------------------------------------------
  // two rods at the same x, one growing down and one growing up, are one white
  // bar. Compared in the mouth's own coordinates, on the built frames.
  // Each rod as a capsule in head-local: axis from root to tip, radius = the
  // furthest any of its own vertices lies off that axis. Measured, not read
  // off the geometry's parameters, because scale.z flattens some of them.
  const capsule = (t) => {
    const m = t.mat;
    const a = new THREE.Vector3(0, t.side * t.len * 0.5, 0).applyMatrix4(m);
    const b = new THREE.Vector3(0, -t.side * t.len * 0.5, 0).applyMatrix4(m);
    const ab = new THREE.Vector3().subVectors(b, a);
    const L2 = Math.max(ab.lengthSq(), 1e-12);
    let r = 0;
    const pos = t.obj.geometry.attributes.position;
    const v = new THREE.Vector3(); const w = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m).sub(a);
      const s2 = Math.min(1, Math.max(0, v.dot(ab) / L2));
      r = Math.max(r, w.copy(ab).multiplyScalar(s2).sub(v).length());
    }
    return { a, b, r };
  };
  let cross = 0;
  const top = mine.filter((t) => t.side > 0);
  const bot = mine.filter((t) => t.side < 0);
  const caps = new Map(mine.map((t) => [t, capsule(t)]));
  for (const t of mine) { t.rad = caps.get(t).r / Math.max(t.mw, 1e-9); }
  const segDist = (P, Q) => {
    // sampled, which is enough at this scale and cannot go wrong
    let best = Infinity;
    const u = new THREE.Vector3(); const v = new THREE.Vector3();
    for (let i = 0; i <= 24; i++) {
      u.lerpVectors(P.a, P.b, i / 24);
      for (let j = 0; j <= 24; j++) { v.lerpVectors(Q.a, Q.b, j / 24); best = Math.min(best, u.distanceTo(v)); }
    }
    return best;
  };
  let alignX = Infinity;
  for (const a of top) for (const b of bot) {
    const A = caps.get(a); const B = caps.get(b);
    const d = segDist(A, B);
    const pen = (A.r + B.r - d) / Math.max(A.r + B.r, 1e-9);
    if (pen > cross) cross = pen;
    alignX = Math.min(alignX, Math.abs(a.frame.position.x - b.frame.position.x) / Math.max(a.mw, 1e-9));
  }

  rows.push({
    seed, p, R,
    out: mine.length ? Math.max(...mine.map((t) => t.out)) : 0,
    shell: mine.length ? Math.max(...mine.map((t) => t.shell)) : 0,
    nTop: top.length, nBot: bot.length, cross, alignX: Number.isFinite(alignX) ? alignX : null,
    jaw0: jawOut[0], jaw2: jawOut[2], jaw4: jawOut[4],
    slide2: jawSlide[2], slide4: jawSlide[4],
    single: p.teethTop === 1 || p.teethBottom === 1,
  });
  for (const t of mine) { t.obj = null; t.frame = null; t.mat = null; t.probe = null; t.p = null; t.worst = null; }
  c.dispose();
}

// ------------------------------------------------------------------ REPORT --
const q = (v, f) => (v.length ? v.slice().sort((a, b) => a - b)[Math.floor(f * (v.length - 1))] : NaN);
const stat = (arr, key, d = 3) => {
  const v = arr.map((r) => r[key]).filter((x) => Number.isFinite(x));
  if (!v.length) return 'none';
  return `median ${q(v, 0.5).toFixed(d)}  p90 ${q(v, 0.9).toFixed(d)}  max ${q(v, 1).toFixed(d)}`;
};
const pct = (arr, f) => (100 * arr.filter(f).length / Math.max(1, arr.length)).toFixed(0) + '%';

console.log(`${rows.length} creatures, ${teeth.length} teeth${ONLY ? ` (${ONLY} only)` : ''}\n`);

console.log('=== a tooth past the drawn skin, in head radii ===');
console.log(`per creature, worst tooth   ${stat(rows, 'out')}   ${pct(rows, (r) => r.out > 0.15)} over 0.15R`);
console.log(`  ...with its outline shell ${stat(rows, 'shell')}`);
console.log(`per tooth                   ${stat(teeth, 'out')}   ${pct(teeth, (t) => t.out > 0.15)} over 0.15R`);
console.log(`  worst point in the ROOT half ${pct(teeth.filter((t) => t.out > 0.10), (t) => t.outRoot >= t.outTip)} of the teeth over 0.10R`);

console.log('\n=== by kind (per tooth, head radii) ===');
const kinds = [...new Set(teeth.map((t) => t.kind))].sort();
for (const k of kinds) {
  const sub = teeth.filter((t) => t.kind === k);
  const curled = sub.filter((t) => t.rot);
  console.log(`  ${k.padEnd(8)} n=${String(sub.length).padStart(4)} curl=${curled.length ? 'y' : 'n'}  out ${stat(sub, 'out')}  ` +
    `root end ${stat(sub, 'rootOut')}  tip end ${stat(sub, 'tipOut')}  ${pct(sub, (t) => t.out > 0.15)} over 0.15R`);
}

console.log('\n=== the walk-back loop in addTeeth ===');
const curled = teeth.filter((t) => t.rot);
const straight = teeth.filter((t) => !t.rot);
console.log(`curled teeth ${curled.length}, straight ${straight.length} (never enter the loop at all)`);
console.log(`  straight, out of the skin   ${stat(straight, 'out')}   ${pct(straight, (t) => t.out > 0.15)} over 0.15R`);
console.log(`  curled,   out of the skin   ${stat(curled, 'out')}   ${pct(curled, (t) => t.out > 0.15)} over 0.15R`);
console.log(`  the loop stopped at step 0 (its tip test passed immediately) for ${pct(curled, (t) => t.steps === 0)}`);
for (const k of ['hooks', 'barbs', 'tusks']) {
  const sub = curled.filter((t) => t.kind === k);
  if (!sub.length) continue;
  console.log(`    ${k.padEnd(6)} step 0 for ${pct(sub, (t) => t.steps === 0)}  tip end ${stat(sub, 'tipOut')}  root end ${stat(sub, 'rootOut')}`);
}
const err = curled.map((t) => ({ e: t.guess - t.tipOut, a: Math.abs(t.guess - t.tipOut) }));
const qq = (f) => q(err.map((x) => x.e), f).toFixed(3);
console.log(`  its own estimator minus the truth at the tip, head radii: min ${qq(0)} p10 ${qq(0.1)} median ${qq(0.5)} p90 ${qq(0.9)} max ${qq(1)}`);
console.log(`  it is wrong by more than 0.10R on ${pct(err, (x) => x.a > 0.1)} of curled teeth, more than 0.30R on ${pct(err, (x) => x.a > 0.3)}`);
const over = curled.filter((t) => t.tipOut > 0.28);
console.log(`  curled teeth whose tip truly breaks the loop's OWN 0.28R tolerance: ${over.length} (${pct(curled, (t) => t.tipOut > 0.28)})`);
console.log(`    ...of those, the loop walked back 0 times because its estimate said they were inside: ${pct(over, (t) => t.steps === 0)}`);
console.log(`  teeth the loop passed whose ROOT is out by more than 0.15R: ${pct(curled, (t) => t.rootOut > 0.15)}`);
console.log(`  ...by more than 0.28R, the loop's own tolerance:           ${pct(curled, (t) => t.rootOut > 0.28)}`);

console.log('\n=== counterfactuals, replayed on the built tooth ===');
console.log(`as built                              ${stat(curled, 'out')}   ${pct(curled, (t) => t.out > 0.15)} over 0.15R`);
console.log(`tip only, tol .28, TRUE radial test   ${stat(curled, 'cfTipTrue')}   ${pct(curled, (t) => t.cfTipTrue > 0.15)} over 0.15R`);
console.log(`both ends, tol .28, true test         ${stat(curled, 'cfBoth28')}   ${pct(curled, (t) => t.cfBoth28 > 0.15)} over 0.15R`);
console.log(`tip only,  tol .12, true test          ${stat(curled, 'cfTip12')}   ${pct(curled, (t) => t.cfTip12 > 0.15)} over 0.15R`);
for (const k of ['hooks', 'barbs', 'tusks']) {
  const sub = curled.filter((t) => t.kind === k);
  if (sub.length) console.log(`     ${k.padEnd(6)} ${stat(sub, 'cfTip12')}   ${pct(sub, (t) => t.cfTip12 > 0.15)} over 0.15R`);
}
console.log(`both ends, tol .12, true test         ${stat(curled, 'cfBoth12')}   ${pct(curled, (t) => t.cfBoth12 > 0.15)} over 0.15R  curl kept ${stat(curled, 'cfBoth12Keep', 2)}`);
console.log(`both ends, tol .06, true test         ${stat(curled, 'cfBoth06')}   ${pct(curled, (t) => t.cfBoth06 > 0.15)} over 0.15R  curl kept ${stat(curled, 'cfBoth06Keep', 2)}`);
for (const k of kinds) {
  const sub = curled.filter((t) => t.kind === k);
  if (!sub.length) continue;
  console.log(`   ${k.padEnd(7)} built ${stat(sub, 'out')} | tol.12 ${stat(sub, 'cfBoth12')} keep ${stat(sub, 'cfBoth12Keep', 2)}`);
}

console.log('\n=== the length cap ===');
console.log(`  a tooth's length, in DRAWN head radii        ${stat(teeth, 'lenR')}`);
console.log(`  headRadius(p) over the drawn mean radius     ${stat(teeth, 'radiusBias', 2)}`);
console.log(`  teeth whose length was cut by headR*0.45     ${pct(teeth, (t) => t.capHead)}`);
console.log(`  those teeth, out of the skin                 ${stat(teeth.filter((t) => t.capHead), 'out')}   ${pct(teeth.filter((t) => t.capHead), (t) => t.out > 0.15)} over 0.15R`);
console.log(`  the rest                                     ${stat(teeth.filter((t) => !t.capHead), 'out')}   ${pct(teeth.filter((t) => !t.capHead), (t) => t.out > 0.15)} over 0.15R`);

console.log('\n=== where the worst point of a tooth is ===');
const bad = teeth.filter((t) => t.out > 0.15);
console.log(`  teeth over 0.15R: ${bad.length}`);
console.log(`  ...in front of the face (z past the skin at its own x,y) ${stat(bad, 'aheadOfFace')}`);
console.log(`  ...past the SIDE silhouette at its own height            ${stat(bad, 'pastProfile')}  ${pct(bad, (t) => t.pastProfile > 0)} of them`);
console.log(`  ...in front of the WHOLE skull (past its front-most z)   ${stat(bad, 'pastFront')}  ${pct(bad, (t) => t.pastFront > 0)} of them`);
for (const lo of [0.05, 0.10, 0.15, 0.20, 0.30]) {
  const sub = teeth.filter((t) => t.out >= lo && t.out < lo + 0.05);
  if (sub.length > 20) console.log(`    excursion ${lo.toFixed(2)}-${(lo + 0.05).toFixed(2)}R: ${pct(sub, (t) => t.pastProfile > 0)} of them are past the side silhouette (n=${sub.length})`);
}
console.log(`  ...out past the frontal outline at its own height        ${stat(bad, 'pastSide')}  ${pct(bad, (t) => t.pastSide > 0)} of them`);
console.log(`  ...below the chin                                        ${stat(bad, 'belowChin')}  ${pct(bad, (t) => t.belowChin > 0)} of them`);
console.log(`  ...how far below its own rim the worst point sits        ${stat(bad, 'dropBelowRim')}`);
console.log(`  buried share of a curled tooth's own vertices            ${stat(curled, 'buried', 2)}`);

console.log('\n=== the forward shove (position.z += len*0.16 for ANY curl) ===');
console.log(`as built                       ${stat(curled, 'out')}   ${pct(curled, (t) => t.out > 0.15)} over 0.15R`);
console.log(`shove only when the curl digs  ${stat(curled, 'cfShove')}   ${pct(curled, (t) => t.cfShove > 0.15)} over 0.15R  buried after ${stat(curled, 'cfShoveBuried', 2)}`);
for (const k of kinds) {
  const sub = curled.filter((t) => t.kind === k);
  if (!sub.length) continue;
  console.log(`   ${k.padEnd(7)} built ${stat(sub, 'out')} | no-shove ${stat(sub, 'cfShove')} buried ${stat(sub, 'cfShoveBuried', 2)} (built ${stat(sub, 'buried', 2)})`);
}

console.log('\n=== top row against bottom row ===');
console.log(`  deepest rod-in-rod overlap, share of the two radii  ${stat(rows, 'cross', 2)}`);
const sameCount = rows.filter((r) => r.nTop > 0 && r.nTop === r.nBot);
console.log(`  creatures whose two rows have the same count: ${sameCount.length}  overlap ${stat(sameCount, 'cross', 2)}`);
const oneRow = rows.filter((r) => r.p.teethTop === 1 && r.p.teethBottom === 1);
console.log(`  nearest opposite-row pair, x apart in mouth half-widths: same count ${stat(sameCount, 'alignX', 3)} | different ${stat(rows.filter((r) => r.nTop > 0 && r.nBot > 0 && r.nTop !== r.nBot), 'alignX', 3)}`);
console.log(`  both rows a single tooth: ${oneRow.length}  overlap ${stat(oneRow, 'cross', 2)}`);

console.log('\n=== the jaw hinge (bottom row only, worst tooth, head radii) ===');
console.log(`  the tooth's ROOT slid off its planted skin point: open 2 ${stat(rows, 'slide2')}   open 4 ${stat(rows, 'slide4')}`);
for (const k of ['jaw0', 'jaw2', 'jaw4']) {
  const lab = { jaw0: 'shut          ', jaw2: 'open  2 (yawn)', jaw4: 'open  4 (roar)' }[k];
  console.log(`  ${lab}  ${stat(rows, k)}   ${pct(rows.filter((r) => Number.isFinite(r[k])), (r) => r[k] > 0.15)} over 0.15R`);
}

console.log('\n=== straight teeth: shorten until they are in ===');
const str2 = teeth.filter((t) => !t.rot);
console.log(`  length that survives a 0.12R reach test  ${stat(str2, 'shrinkTo', 2)}   ${pct(str2, (t) => t.shrinkTo < 0.95)} needed shortening at all`);
console.log(`  of the ones over 0.15R as built          ${stat(str2.filter((t) => t.out > 0.15), 'shrinkTo', 2)}`);

console.log('\n=== one tooth owning the whole mouth ===');
for (const n of [1, 2, 3, 5, 9, 13]) {
  const sub = teeth.filter((t) => t.count === n);
  if (!sub.length) continue;
  console.log(`  row of ${String(n).padStart(2)}: n=${String(sub.length).padStart(4)}  out ${stat(sub, 'out')}  len ${stat(sub, 'lenR')}  half-width/mw ${stat(sub, 'rad', 2)}  ${pct(sub, (t) => t.out > 0.15)} over 0.15R`);
}
const one = rows.filter((r) => r.single);
const many = rows.filter((r) => !r.single);
console.log(`  teethTop or teethBottom === 1: ${one.length} creatures, worst tooth ${stat(one, 'out')}`);
console.log(`  otherwise:                     ${many.length} creatures, worst tooth ${stat(many, 'out')}`);
const oneT = teeth.filter((t) => rows.find((r) => r.seed === t.seed)?.single);
console.log(`  a tooth on such a creature: ${stat(oneT, 'out')}   ${pct(oneT, (t) => t.out > 0.15)} over 0.15R`);

console.log('\n=== per creature, by kind ===');
for (const k of kinds) {
  const sub = rows.filter((r) => r.p.toothType === k);
  if (!sub.length) continue;
  console.log(`  ${k.padEnd(8)} n=${String(sub.length).padStart(3)} (${(100 * sub.length / rows.length).toFixed(1)}% of all creatures)  worst tooth ${stat(sub, 'out')}  ${pct(sub, (r) => r.out > 0.15)} over 0.15R  ${pct(sub, (r) => r.out > 0.25)} over 0.25R`);
}

if (SEEDS) {
  console.log('\n=== each tooth of each named seed ===');
  for (const t of teeth) {
    console.log(`  seed ${String(t.seed).padStart(7)} ${t.kind.padEnd(7)} row of ${String(t.count).padStart(2)} ${t.side > 0 ? 'top' : 'bot'} ` +
      `len ${t.lenR.toFixed(3)}R curl ${t.rot.toFixed(2)} (asked ${t.curl0.toFixed(2)}, walked back ${t.steps} times) ` +
      `out ${t.out.toFixed(3)}R  root end ${t.rootOut.toFixed(3)}R  tip end ${t.tipOut.toFixed(3)}R  ` +
      `the loop's own estimate of the tip ${t.guess.toFixed(3)}R`);
  }
}

console.log('\n=== worst by the hinge (jaw shut -> open 4) ===');
for (const r of rows.filter((x) => Number.isFinite(x.jaw4)).sort((a, b) => (b.jaw4 - b.jaw0) - (a.jaw4 - a.jaw0)).slice(0, 6)) {
  console.log(`  seed ${String(r.seed).padStart(6)} ${r.jaw0.toFixed(3)}R -> ${r.jaw4.toFixed(3)}R  slid ${r.slide4.toFixed(3)}R | ${r.p.toothType} bot ${r.p.teethBottom} maw ${r.p.mawShape}`);
}
for (const k of ['hooks', 'barbs', 'tusks']) {
  console.log(`\nworst ${k}:`);
  for (const r of rows.filter((x) => x.p.toothType === k).sort((a, b) => b.out - a.out).slice(0, 4)) {
    console.log(`  seed ${String(r.seed).padStart(6)} out ${r.out.toFixed(3)}R | size ${r.p.toothSize.toFixed(2)} maw ${r.p.mawShape} top ${r.p.teethTop} bot ${r.p.teethBottom}`);
  }
}

console.log('\n=== worst creatures ===');
for (const r of rows.slice().sort((a, b) => b.out - a.out).slice(0, 12)) {
  console.log(`  seed ${String(r.seed).padStart(6)} out ${r.out.toFixed(3)}R shell ${r.shell.toFixed(3)}R | ` +
    `${r.p.toothType.padEnd(8)} size ${r.p.toothSize.toFixed(2)} maw ${r.p.mawShape.padEnd(8)} ` +
    `top ${r.p.teethTop} bot ${r.p.teethBottom} open ${r.p.mouthOpen.toFixed(2)}`);
}
