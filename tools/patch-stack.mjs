// Bare skin through a projected patch, and the stack that patch sits in:
//   node tools/patch-stack.mjs [creatures] [seed]
//
// The lips family: the lip band, the maw cavity, every eye socket, every
// nostril and every scar dot. All of them are made the same way — flat
// triangles strung between points sampled ON the skin, then shoved off it
// along the skin's own normal — so all of them can let the face through, and
// all of them can end up standing off it.
//
// Everything below is measured on the mesh that was BUILT. No offset, no lift
// and no rim position is read out of features.js: the lift is recovered from
// the geometry, the sag is measured against the tessellated skull (the one
// that is drawn), and the requested rim is the only thing recomputed, so that
// where a patch was ASKED to go can be compared with where it went.
//
// What is measured, per patch:
//
//  LIFT. Every vertex sits at skin + normal*lift with one lift for the whole
//  patch. Along the ray through a vertex the skin is a plane through its own
//  skin point, so the radial gap between vertex and skull times cos(normal,
//  ray) is that lift exactly. Median over the vertices; the spread is printed
//  as a residual so a wrong recovery cannot pass unnoticed.
//
//  HOLE. Ten points inside every triangle, each asked along its own ray out of
//  the head's centre (the skull is star-shaped: one skin point per ray). Skin
//  outside patch is bare face showing through the patch. Asked twice: at the
//  lift the patch was built with, and at a flat 0.010 — the offset most of
//  features.js carried before surface.js measured its own — so that a clean
//  report is evidence and not silence.
//
//  STANDOFF. The lift is one number for the whole patch, taken as a max over
//  its quads, so a single bad chord lifts everything. Reported against the
//  patch's own footprint: a plate hanging a radius off the face is not a decal.
//
//  THE STACK. The lip is not a ring — it is the same shape a size larger laid
//  UNDER the cavity, and the only thing that keeps it reading as a border is
//  the cavity standing further off the skin. Both now measure their own lift
//  from their own sag, and nothing makes the cavity's the larger of the two.
//  So this shoots the rays through the cavity and asks which of the two the
//  player meets first, and what fraction of the mouth the lip has painted over.
//
//  THE WALK. surfaceAt answers a miss by walking the query in towards the
//  middle of the face until it lands. The vertex is then not where the band
//  asked for it: the rim it was drawing has moved. Both bands are laid out in
//  frontal coordinates that this file recomputes from the maw the rig reports,
//  so the distance between where a vertex was asked for and where it landed is
//  measurable, and so is the thing that distance does to the border: a lip
//  vertex walked inside the cavity's own rim paints no border at all, and the
//  bare skin outside the cavity is what the player sees instead.
import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { mawProfile } from '../src/creature/maw.js';
import { skinProbe } from './lib-skin.mjs';

const N = Number(process.argv[2] || 400);
const ONE = process.argv[3] ? Number(process.argv[3]) : null;
const EPS = 5e-4;
const CONTROL = 0.010;

const q = (a, f) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : NaN);
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(4) : '  -  ');
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(0) + '%' : ' - ');

// interior sample points of a triangle, barycentric, order 3
const BARY = [];
for (let i = 0; i <= 3; i++) for (let j = 0; i + j <= 3; j++) BARY.push([i / 3, j / 3, 1 - i / 3 - j / 3]);

// Everything on the head is built while the head is OUTSIDE the scene graph,
// so features are stored in skull coordinates; afterwards the head is moved
// onto a neck. The skin probe reads the skull's raw buffers, so every point
// measured here is taken back into the head mesh's own frame first.
function toSkull(hm) {
  const inv = new THREE.Matrix4().copy(hm.matrixWorld).invert();
  return (mesh) => {
    const M = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    return { M, NM: new THREE.Matrix3().getNormalMatrix(M) };
  };
}

function patchesOf(head) {
  const out = [];
  head.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    const g = o.geometry;
    if (g.attributes.uv || !g.index || !g.attributes.normal) return;   // hand-built lattice only
    out.push(o);
  });
  return out;
}

function headMeshOf(head) {
  let best = null;
  head.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    if (!o.geometry.type.startsWith('Icosahedron')) return;
    if (!best || o.geometry.attributes.position.count > best.geometry.attributes.position.count) best = o;
  });
  return best;
}

const stat = () => ({ n: 0, hole: 0, vals: [], deep: [], stand: [], rel: [], resid: [], standM: [], relM: [], nz: [] });
const bump = (m, k) => (m[k] || (m[k] = stat()));

const perClass = {};
const creature = { holes: 0, standoff: 0, lipOver: 0, walked: 0, borderLost: 0, inverted: 0, n: 0 };
const lipLift = []; const cavLift = []; const walkStat = []; const overShare = [];
const worstHole = [];
const worstStand = [];
const worstBorder = [];
const controlClass = {};

const walkers = [];
let railed = 0;
const segsOf = (g) => g.index.getX(1);

const seeds = ONE ? [ONE] : Array.from({ length: N }, (_, i) => 1 + i * 7919 % 99991);

for (const seed of seeds) {
  const c = buildCreature(randomize(seed));
  c.group.updateMatrixWorld(true);
  const p = c.params;
  const head = c.rig.headPivot.children[0];
  const hm = headMeshOf(head);
  const probe = skinProbe(hm);
  const frameOf = toSkull(hm);
  const R = (p.headWidth + p.headHeight + p.headDepth) / 3;

  const maw = c.rig.maw;
  const prof = mawProfile(p.mawShape);
  const grow = 1 + Math.max(0, p.lips);

  let anyHole = false; let anyStand = false;
  const patches = patchesOf(head);
  let lipMesh = null; let cavMesh = null;

  for (const m of patches) {
    const g = m.geometry;
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const idx = g.index;
    const nv = pos.count;
    const { M, NM } = frameOf(m);
    const V = new Array(nv); const Nv = new Array(nv);
    for (let i = 0; i < nv; i++) {
      V[i] = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(M);
      Nv[i] = new THREE.Vector3().fromBufferAttribute(nrm, i).applyMatrix3(NM).normalize();
    }
    // --- recover the lift.
    //
    // Every vertex is stored at skin + normal*lift with ONE lift for the whole
    // patch, and the normal is in the buffer, so the lift is the single number
    // that puts every vertex back ON the skin when it is subtracted. Solved as
    // that: a search for the L that minimises the median distance of
    // (vertex - normal*L) off the tessellated skull. No plane approximation, no
    // offset read out of features.js — and the residual it leaves is a
    // measurement in its own right, since a vertex surfaceAt could only answer
    // from the ANALYTIC surface does not sit on the drawn one at any L.
    const samp = [];
    for (let i = 0; i < nv; i += Math.max(1, Math.floor(nv / 32))) samp.push(i);
    const _t = new THREE.Vector3();
    // proud(v - n L) falls as L grows, so the lift is the root of the median.
    // Bisection rather than a grid: a grid has a ceiling, and a patch that has
    // left the head sits above any ceiling worth searching — the first draft of
    // this tool railed at 0.12 and reported that as the answer.
    const f = (L) => {
      const a = [];
      for (const i of samp) { _t.copy(V[i]).addScaledVector(Nv[i], -L); a.push(probe.proud(_t)); }
      return q(a, 0.5);
    };
    // Bracket first. proud(v - nL) falls as L grows only until the point has
    // been pushed through the middle of the skull, after which it climbs again,
    // so a bisection handed the whole range can converge on the far side of the
    // head and call a decal a head thick. Walk a coarse ladder until the median
    // first goes negative, and bisect inside that rung.
    const LAD = [0, 0.005, 0.01, 0.02, 0.035, 0.05, 0.08, 0.12, 0.2, 0.3, 0.45, 0.7, 1.0];
    let lo0 = 0; let hi0 = -1;
    for (let k = 1; k < LAD.length; k++) { if (f(LAD[k]) <= 0) { lo0 = LAD[k - 1]; hi0 = LAD[k]; break; } }
    if (hi0 < 0) { railed++; continue; }
    for (let k = 0; k < 30; k++) { const mid = (lo0 + hi0) * 0.5; if (f(mid) > 0) lo0 = mid; else hi0 = mid; }
    const lift = (lo0 + hi0) * 0.5;
    let resid = 0;
    for (const i of samp) { _t.copy(V[i]).addScaledVector(Nv[i], -lift); resid = Math.max(resid, Math.abs(probe.proud(_t))); }
    if (!Number.isFinite(lift)) continue;

    // --- footprint radius (in the frontal plane, which is how they are laid out)
    let cx0 = 0; let cy0 = 0;
    for (let i = 0; i < nv; i++) { cx0 += V[i].x; cy0 += V[i].y; }
    cx0 /= nv; cy0 /= nv;
    let foot = 0;
    for (let i = 0; i < nv; i++) foot = Math.max(foot, Math.hypot(V[i].x - cx0, V[i].y - cy0));

    // --- class
    let cls;
    if (m.userData.maw) cls = nv >= 400 ? 'cavity' : 'lip';
    else if (m.userData.nose) cls = 'nostril';
    else if (foot < R * 0.06) cls = 'scar';
    else cls = 'socket:' + p.eyeStyle;
    if (m.userData.maw) { if (cls === 'lip') lipMesh = m; else cavMesh = m; }

    // --- HOW FAR ROUND THE HEAD the patch reached.
    //
    // Every one of these patches is laid out in FRONTAL coordinates and planted
    // by a ray down -Z, which is a parameterisation of the skull only where the
    // skull faces the viewer. Near the silhouette it stops being one: a step of
    // a twentieth in x is a step of most of a head in z, and the flat quad
    // between two such samples is a chord through the skull rather than a
    // patch on it. The vertex normals in the buffer say exactly how far round a
    // patch reached — n.z is the cosine of the angle between the skin there and
    // the view — so this is measured, not inferred, and needs nothing from the
    // call site.
    let minNz = 1; let maxStep = 0;
    for (let i = 0; i < nv; i++) minNz = Math.min(minNz, Nv[i].z);

    // --- THE WALK, for a fan.
    //
    // decalGeometry lays its rings at t = r/rings of the way out, so before
    // anything is walked every ring is the SAME polygon scaled about the
    // centre: ring r sits exactly r times as far out as ring 1. That identity
    // is a property of the request, not of the skull, so any vertex that
    // breaks it is a vertex surfaceAt could not place where it was asked and
    // dragged inwards instead. Measured in the frontal plane, on the un-lifted
    // lattice, with ring 1 as the reference because the walk hits the OUTER
    // rings first.
    let walk = 0; let walkN = 0; let stretch = 1;
    if (!m.userData.maw && nv >= 3 * segsOf(g)) {
      const segs = segsOf(g);
      const rings = nv / segs - 1;
      const S0 = (i) => V[i].clone().addScaledVector(Nv[i], -lift);
      const C = S0(0);
      for (let r = 2; r <= rings; r++) {
        for (let sI = 0; sI < segs; sI++) {
          const ref = S0(segs + sI).sub(C).multiplyScalar(r);
          const got = S0(r * segs + sI).sub(C);
          const d = Math.hypot(got.x - ref.x, got.y - ref.y);
          if (d > 0.01) walkN++;
          if (d > walk) walk = d;
        }
      }
    }

    // --- holes, at the built lift and at the control lift
    let deep = 0; let deepC = 0; let stand = 0; let deepEdge = 0; let deepAt = null;
    const tri = idx.count / 3;
    for (let t = 0; t < tri; t++) {
      const a = idx.getX(t * 3); const b = idx.getX(t * 3 + 1); const c2 = idx.getX(t * 3 + 2);
      const edge = Math.max(V[a].distanceTo(V[b]), V[b].distanceTo(V[c2]), V[c2].distanceTo(V[a]));
      for (const [u, v, w] of BARY) {
        // The un-lifted lattice, interpolated — NOT the built triangle pushed
        // back down an interpolated normal. Each vertex went out along its OWN
        // normal, and where two normals differ by tens of degrees the average
        // of them is shorter than a unit, so subtracting it as if it were one
        // moves the sample. Un-lift per vertex, then interpolate.
        for (const [L, sink] of [[lift, 0], [CONTROL, 1]]) {
          const P = new THREE.Vector3();
          for (const [vi, bw] of [[a, u], [b, v], [c2, w]]) {
            P.addScaledVector(V[vi], bw).addScaledVector(Nv[vi], bw * (L - lift));
          }
          const len = P.length();
          if (len < 1e-9) continue;
          const sk = probe.along(P.clone().multiplyScalar(1 / len));
          if (sk < 0) continue;
          const gap = len - sk;
          if (sink === 0) {
            if (gap < -deep) { deep = -gap; deepEdge = edge; deepAt = [P.x - cx0, P.y - cy0]; }
            if (gap > stand) stand = gap;
          } else if (gap < -deepC) deepC = -gap;
        }
      }
    }
        const s = bump(perClass, cls);
    s.nz.push(minNz);
    if (minNz < 0.35) { s.steep = (s.steep || 0) + 1; if (deep > EPS) s.steepHole = (s.steepHole || 0) + 1; }
    else if (deep > EPS) s.flatHole = (s.flatHole || 0) + 1;
    s.n++; s.vals.push(lift); s.resid.push(resid);
    s.stand.push(lift); s.rel.push(lift / Math.max(foot, 1e-6));
    if (deep > EPS) {
      s.hole++; s.deep.push(deep); anyHole = true;
      worstHole.push([deep / R, seed, cls, deep, lift, deepEdge, foot,
        deepAt ? Math.round((Math.atan2(deepAt[1], deepAt[0]) * 180) / Math.PI) : 0, walk]);
    }
    if (walk > 0.01) { s.walk = (s.walk || 0) + 1; walkers.push([walk, seed, cls, walkN, nv]); }
    s.walkAll = (s.walkAll || 0) + (walk > 0.01 ? 1 : 0);
    if (lift > 0.05) anyStand = true;
    worstStand.push([lift / Math.max(foot, 1e-6), seed, cls, lift, foot, stand]);
    s.standM.push(lift); s.relM.push(lift / Math.max(foot, 1e-6));
    const sc = bump(controlClass, cls);
    sc.n++; if (deepC > EPS) { sc.hole++; sc.deep.push(deepC); }
  }

  // ---- the stack: does the lip paint over the cavity?
  if (lipMesh && cavMesh) {
    const lg = lipMesh.geometry; const cg = cavMesh.geometry;
    const lp = lg.attributes.position; const li = lg.index;
    const cp = cg.attributes.position; const ci = cg.index;
    const LM = frameOf(lipMesh).M; const CM = frameOf(cavMesh).M;
    const LV = []; for (let i = 0; i < lp.count; i++) LV.push(new THREE.Vector3().fromBufferAttribute(lp, i).applyMatrix4(LM));
    const CV = []; for (let i = 0; i < cp.count; i++) CV.push(new THREE.Vector3().fromBufferAttribute(cp, i).applyMatrix4(CM));
    const hitTri = (A, B, C, d) => {   // ray from origin along d
      const e1 = B.clone().sub(A); const e2 = C.clone().sub(A);
      const pv = d.clone().cross(e2); const det = e1.dot(pv);
      if (Math.abs(det) < 1e-14) return -1;
      const inv = 1 / det; const tv = A.clone().negate();
      const u = tv.dot(pv) * inv; if (u < -1e-7 || u > 1 + 1e-7) return -1;
      const qv = tv.cross(e1); const vv = d.dot(qv) * inv; if (vv < -1e-7 || u + vv > 1 + 1e-7) return -1;
      const t = e2.dot(qv) * inv; return t > 1e-9 ? t : -1;
    };
    let over = 0; let seen = 0;
    for (let t = 0; t < ci.count / 3; t++) {
      const A = CV[ci.getX(t * 3)]; const B = CV[ci.getX(t * 3 + 1)]; const C = CV[ci.getX(t * 3 + 2)];
      const P = A.clone().add(B).add(C).multiplyScalar(1 / 3);
      const len = P.length(); if (len < 1e-9) continue;
      const d = P.clone().multiplyScalar(1 / len);
      let best = -1;
      for (let s2 = 0; s2 < li.count / 3; s2++) {
        const h = hitTri(LV[li.getX(s2 * 3)], LV[li.getX(s2 * 3 + 1)], LV[li.getX(s2 * 3 + 2)], d);
        if (h > best) best = h;
      }
      seen++;
      if (best > len + 1e-4) over++;
    }
    if (over > 0) {
      creature.lipOver++; overShare.push(over / seen);
      worstBorder.push([over / seen, seed, 'lip-over-cavity', over, seen]);
    }

    // ---- the walk, and the stack, both from the ASKED-for rim.
    //
    // A band vertex is stored at ask + normal*lift, with ONE lift for the whole
    // patch and the normal known exactly (it is in the buffer). So the lift is
    // over-determined by the frontal coordinates alone: for any vertex whose
    // normal has some sideways to it, lift = (n_xy . (v_xy - ask_xy)) / |n_xy|^2,
    // and the median of those is the lift with no plane approximation in it at
    // all. What is left over is the WALK — how far surfaceAt had to drag the
    // query before it found skin — and that is measured, not inferred.
    const lattice = (mesh, rx, ry, cols, rows) => {
      const pa = mesh.geometry.attributes.position;
      const na = mesh.geometry.attributes.normal;
      const fr = frameOf(mesh);
      const rec = [];
      for (let ciX = 0; ciX <= cols; ciX++) {
        const u = -1 + (ciX / cols) * 2;
        const hi = prof.up(u); const lo = prof.down(u);
        for (let ri = 0; ri <= rows; ri++) {
          const y = lo + (hi - lo) * (ri / rows);
          const ax = maw.mx + u * rx; const ay = maw.my + y * ry;
          const i = ciX * (rows + 1) + ri;
          const v = new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(fr.M);
          const n = new THREE.Vector3().fromBufferAttribute(na, i).applyMatrix3(fr.NM).normalize();
          rec.push({ u, y, ri, ciX, ax, ay, v, n });
        }
      }
      const est = [];
      for (const r of rec) {
        const w = Math.hypot(r.n.x, r.n.y);
        if (w < 0.2) continue;
        est.push(((r.v.x - r.ax) * r.n.x + (r.v.y - r.ay) * r.n.y) / (w * w));
      }
      const L = est.length ? q(est, 0.5) : NaN;
      let walked = 0; let worst = 0; let worstAt = null;
      for (const r of rec) {
        r.sx = r.v.x - r.n.x * L; r.sy = r.v.y - r.n.y * L;
        const d = Math.hypot(r.sx - r.ax, r.sy - r.ay);
        r.walk = d;
        if (d > 0.004) walked++;
        if (d > worst) { worst = d; worstAt = r; }
      }
      return { rec, L, walked, worst, worstAt, total: rec.length };
    };
    const lipA = lattice(lipMesh, maw.mw * grow, maw.mh * grow * 1.25, 30, 11);
    const cavA = lattice(cavMesh, maw.mw, maw.mh, 30, 13);
    lipLift.push(lipA.L); cavLift.push(cavA.L);
    if (lipA.L >= cavA.L) { creature.inverted++; worstBorder.push([lipA.L - cavA.L, seed, 'lift-inversion', lipA.L, cavA.L]); }
    walkStat.push(Math.max(lipA.worst, cavA.worst));
    if (lipA.walked || cavA.walked) creature.walked++;

    // Is there a border at all? The lip is a filled band a size larger, so the
    // border is the part of it OUTSIDE the cavity's rim. Take the lip's own
    // outer edge — its top row, its bottom row and its two corner columns, as
    // BUILT — and ask whether each of those points still lies outside the
    // cavity's rim in the frontal plane. A lip edge that has landed inside the
    // cavity paints nothing the player can see: the mouth's dark hole runs
    // straight into bare skin with no lip between them.
    let lost = 0; let edge = 0;
    for (const r of lipA.rec) {
      if (r.ri !== 0 && r.ri !== 11 && r.ciX !== 0 && r.ciX !== 30) continue;
      edge++;
      const qx = (r.sx - maw.mx) / Math.max(maw.mw, 1e-9);
      const qy = (r.sy - maw.my) / Math.max(maw.mh, 1e-9);
      if (Math.abs(qx) <= 1 && qy <= prof.up(qx) + 1e-9 && qy >= prof.down(qx) - 1e-9) lost++;
    }
    if (lost) { creature.borderLost++; worstBorder.push([lost / edge, seed, 'lip-edge-inside-cavity', lost, edge]); }
    if (ONE) {
      console.log('lip  lift', f3(lipA.L), 'walked', lipA.walked + '/' + lipA.total, 'worst walk', f3(lipA.worst),
        lipA.worstAt ? 'at u=' + f3(lipA.worstAt.u) + ' y=' + f3(lipA.worstAt.y) + ' ask=' + f3(lipA.worstAt.ax) + ',' + f3(lipA.worstAt.ay) + ' got=' + f3(lipA.worstAt.sx) + ',' + f3(lipA.worstAt.sy) : '');
      console.log('cav  lift', f3(cavA.L), 'walked', cavA.walked + '/' + cavA.total, 'worst walk', f3(cavA.worst));
      console.log('lip edge points inside the cavity rim:', lost, '/', edge);
    }
  }

  if (anyHole) creature.holes++;
  if (anyStand) creature.standoff++;
  creature.n++;
  c.dispose();
  if (!ONE && creature.n % 50 === 0) process.stderr.write('.' + creature.n);
}

if (!ONE) process.stderr.write('\n');
const fin = (a) => a.filter(Number.isFinite);
console.log('creatures', creature.n);
console.log('');
console.log('patch                 n   lift.med  lift.p90  lift.max  lift/foot.p90  resid.max   holes  deepest  walked   ctrl-holes ctrl-deepest');
const names = Object.keys(perClass).sort((a, b) => perClass[b].n - perClass[a].n);
for (const k of names) {
  const s = perClass[k]; const cc = controlClass[k];
  console.log(
    k.padEnd(18), String(s.n).padStart(5),
    f3(q(s.standM, 0.5)), ' ', f3(q(s.standM, 0.9)), ' ', f3(q(s.standM, 0.999)), '   ',
    f3(q(s.relM, 0.9)), '      ', f3(q(s.resid, 0.999)), '  ',
    pct(s.hole, s.n).padStart(4), f3(q(s.deep, 0.999)), pct(s.walkAll || 0, s.n).padStart(6), '   ',
    pct(cc.hole, cc.n).padStart(4), f3(q(cc.deep, 0.999)),
  );
}
console.log('');
console.log('patches whose lift could not be bracketed', railed);
console.log('creatures with any hole   ', pct(creature.holes, creature.n));
console.log('creatures with a patch standing off > 0.05', pct(creature.standoff, creature.n));
console.log('creatures where the lip paints over the cavity', pct(creature.lipOver, creature.n));
console.log('  of those, share of the cavity painted over: >90% on', overShare.filter((x) => x > 0.9).length,
  'creatures, >50% on', overShare.filter((x) => x > 0.5).length, ', any on', overShare.length);
console.log('creatures where the lip edge landed inside the cavity rim', pct(creature.borderLost, creature.n));
console.log('creatures where lip lift >= cavity lift (border inverted)', pct(creature.inverted, creature.n));
console.log('creatures where a band vertex had to be walked > 0.004', pct(creature.walked, creature.n));
console.log('lip lift  med/p90/max', f3(q(fin(lipLift), 0.5)), f3(q(fin(lipLift), 0.9)), f3(q(fin(lipLift), 0.999)));
console.log('cav lift  med/p90/max', f3(q(fin(cavLift), 0.5)), f3(q(fin(cavLift), 0.9)), f3(q(fin(cavLift), 0.999)));
console.log('worst walk per creature med/p90/max', f3(q(fin(walkStat), 0.5)), f3(q(fin(walkStat), 0.9)), f3(q(fin(walkStat), 0.999)));
console.log('');
const show = (title, arr, n = 10) => {
  console.log(title);
  arr.sort((a, b) => b[0] - a[0]);
  for (const r of arr.slice(0, n)) console.log('   ', r.map((x) => (typeof x === 'number' ? f3(x) : x)).join('  '));
};
console.log('');
console.log('patch                 n   min n.z p10   patches reaching past n.z 0.35   holes among those   holes among the rest');
for (const k of names) {
  const s = perClass[k];
  console.log(k.padEnd(18), String(s.n).padStart(5), f3(q(s.nz, 0.1)).padStart(10),
    pct(s.steep || 0, s.n).padStart(24), pct(s.steepHole || 0, s.steep || 0).padStart(18), pct(s.flatHole || 0, s.n - (s.steep || 0)).padStart(20));
}
console.log('');
show('worst holes (deep/R, seed, class, deep, lift, edge-of-that-triangle, footprint, angle-from-centre, walk)', worstHole);
show('worst walks (walk, seed, class, vertices walked, of)', walkers);
show('worst standoff (lift/foot, seed, class, lift, footprint, worst radial gap)', worstStand);
show('worst stack (share, seed, what, n, of)', worstBorder);
