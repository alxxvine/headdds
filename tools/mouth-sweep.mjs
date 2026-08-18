// Bare skin through a decal, and a tooth out through the face:
//   node tools/mouth-sweep.mjs [creatures] [patch-name-filter]
//
// Two complaints from the art director that no existing sweep can see:
//
//   "у нас губы бывает не везде красят лицо" — the purple lip ring around the
//   mouth has a wedge of bare cream skin cutting through it.
//   "зубы куда-то странно вперед торчат" — one long white rod comes out of the
//   mouth and is outside the head from three quarters and from the side.
//
// Neither is visible to face-sweep, and for the same reason in both cases: it
// works in the FRONTAL plane. From straight on, a patch that has sunk under the
// skull still covers the same pixels, and a tooth standing a third of a head
// radius out of a cheek is still inside the outline. Both failures are in Z.
//
// So this tool measures in the direction the failure is in, on the mesh that
// was BUILT rather than on the numbers that built it:
//
// 1. BARE SKIN THROUGH A DECAL. Every patch made by decalGeometry or
//    bandGeometry — the lip band, the cavity band, eye sockets, nostrils,
//    slits, scars — is flat triangles strung between points sampled ON the
//    skin and then lifted off it. Between the samples the skull rises, and
//    wherever it rises past the lift the skin is in FRONT of the patch and the
//    face shows through the mouth. For every triangle of every patch this takes
//    twelve points inside it, finds the skin along each point's own ray out of
//    the head's centre (the skull is star-shaped, so there is exactly one) and
//    asks how far that skin stands above the triangle's plane.
//
//    Measured against the TESSELLATED skull, which is the one that is drawn:
//    HEAD_DETAIL 4 is 500 triangles, not the 5120 the comment claims, and the
//    analytic surface bulges above every facet of it. Reporting the analytic
//    rise would invent holes that no player can see.
//
//    Reported in units of each patch's OWN lift, which is measured off the
//    built mesh too — a patch vertex sits at skin + normal*lift, so the radial
//    gap between the vertex and the skull, times the cosine between the normal
//    and the ray, is that lift. Nothing is read out of the source, so the
//    numbers stay honest while surface.js is being edited. 1.0 is the skin
//    exactly level with the patch; over 1.0 is bare face showing through.
//
// 2. A TOOTH OUT THROUGH THE FACE. Every cap in addTeeth is solved in the
//    mouth's own x and y; a curl sweeps the tooth in y and Z and nothing
//    compares the result to the skull. So this takes each tooth's whole
//    geometry — every vertex, never a bounding box, because a rotated rod's
//    AABB is a lie — and finds its furthest point radially outside the drawn
//    skull, in head radii.
//
//    A fang overhanging the lip is the look this thing is for; a rod out of a
//    cheek is not. The two are told apart by where the excursion happens: the
//    distance in the face plane from the painted mouth's own rim (its lips
//    when it has them, its cavity when it does not), zero inside it. And it
//    names the culprit — the toothType, the row, and which END of the tooth is
//    out, since a hook leaves the face by its ROOT while a barb leaves by its
//    point, and a guard that watches one of those cannot see the other.
//
// What it caught on the tree it was written against is at the bottom of this
// file's output, not in this comment: features.js and surface.js are being
// edited by another session and any number written here would be stale by
// morning. The fingerprint line at the top of the output says which tree the
// run measured.

import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { mawProfile } from '../src/creature/maw.js';

const N = Number(process.argv[2] || 400);
const ONLY = process.argv[3] || null;      // substring match on the patch name
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'creature');

// A hole under this is float noise, not a hole. Head units; a head is ~1 across.
const EPS = 5e-4;
// How far outside the painted mouth an excursion has to be before it stops
// being a fang overhanging the lip and starts being a rod through the face.
// In head radii, and printed as a distribution below so the line can be moved.
const CLEAR = 0.10;

// ------------------------------------------------------------------ PROBE ---
// Where the skin is along a ray out of the head's centre, ON THE MESH.
//
// Not headPoint(p, v.normalize()): headPoint is not a radial map — it scales x,
// y and z by different amounts — so it answers about a different direction, and
// run over the skull's own vertices (every one of which is a skin point, so
// every answer must be zero) it calls a third of them proud of the skin. The
// probe below is checked against exactly that, and against THREE.Raycaster, at
// the top of every run.
//
// 500 triangles is few enough to brute force and slow enough to matter at four
// million rays, so the faces are bucketed by the direction of their centroid,
// each one registered over every cell its own angular radius reaches.
function skinProbe(headMesh) {
  const geo = headMesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const nTri = idx ? idx.count / 3 : Math.floor(pos.count / 3);
  const tri = new Float32Array(nTri * 9);

  const NT = 32;
  const NP = 64;
  const dT = Math.PI / NT;
  const dP = (2 * Math.PI) / NP;
  const cellR = 0.5 * Math.hypot(dT, dP);
  const cells = new Map();
  const put = (ti, pi, t) => {
    const key = ti * NP + (((pi % NP) + NP) % NP);
    let a = cells.get(key);
    if (!a) cells.set(key, (a = []));
    a.push(t);
  };

  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  let R = 0;
  let nR = 0;
  for (let t = 0; t < nTri; t++) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) {
      const i = idx ? idx.getX(t * 3 + k) : t * 3 + k;
      v.fromBufferAttribute(pos, i);
      tri[t * 9 + k * 3] = v.x;
      tri[t * 9 + k * 3 + 1] = v.y;
      tri[t * 9 + k * 3 + 2] = v.z;
      c.add(v);
      R += v.length();
      nR++;
    }
    c.multiplyScalar(1 / 3);
    if (c.lengthSq() < 1e-14) continue;
    c.normalize();
    let cosA = 1;
    for (let k = 0; k < 3; k++) {
      v.set(tri[t * 9 + k * 3], tri[t * 9 + k * 3 + 1], tri[t * 9 + k * 3 + 2]);
      if (v.lengthSq() < 1e-14) continue;
      cosA = Math.min(cosA, v.normalize().dot(c));
    }
    const ang = Math.acos(Math.max(-1, Math.min(1, cosA))) + cellR;
    const th = Math.acos(Math.max(-1, Math.min(1, c.y)));
    const ph = Math.atan2(c.z, c.x);
    const ti0 = Math.max(0, Math.floor((th - ang) / dT));
    const ti1 = Math.min(NT - 1, Math.floor((th + ang) / dT));
    for (let ti = ti0; ti <= ti1; ti++) {
      const s = Math.min(Math.sin(ti * dT), Math.sin((ti + 1) * dT));
      const dphi = s > 1e-3 ? ang / s + dP : Math.PI;
      if (dphi >= Math.PI) {
        for (let pi = 0; pi < NP; pi++) put(ti, pi, t);
      } else {
        const p0 = Math.floor((ph - dphi + Math.PI) / dP);
        const p1 = Math.floor((ph + dphi + Math.PI) / dP);
        for (let pi = p0; pi <= p1; pi++) put(ti, pi, t);
      }
    }
  }

  // Möller–Trumbore from the head's centre; returns the distance or -1.
  const hit = (t, dx, dy, dz) => {
    const o = t * 9;
    const ax = tri[o], ay = tri[o + 1], az = tri[o + 2];
    const e1x = tri[o + 3] - ax, e1y = tri[o + 4] - ay, e1z = tri[o + 5] - az;
    const e2x = tri[o + 6] - ax, e2y = tri[o + 7] - ay, e2z = tri[o + 8] - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) return -1;
    const inv = 1 / det;
    const tx = -ax, ty = -ay, tz = -az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-7 || u > 1 + 1e-7) return -1;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const w = (dx * qx + dy * qy + dz * qz) * inv;
    if (w < -1e-7 || u + w > 1 + 1e-7) return -1;
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return d > 1e-9 ? d : -1;
  };

  let brute = 0;
  const query = (dx, dy, dz) => {
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 0)) return -1;
    dx /= len; dy /= len; dz /= len;
    const ti = Math.min(NT - 1, Math.max(0, Math.floor(Math.acos(Math.max(-1, Math.min(1, dy))) / dT)));
    const pi = (((Math.floor((Math.atan2(dz, dx) + Math.PI) / dP) % NP) + NP) % NP);
    const list = cells.get(ti * NP + pi);
    let best = -1;
    if (list) for (let i = 0; i < list.length; i++) best = Math.max(best, hit(list[i], dx, dy, dz));
    if (best < 0) {
      brute++;
      for (let t = 0; t < nTri; t++) best = Math.max(best, hit(t, dx, dy, dz));
    }
    return best;
  };

  return { query, nTri, R: R / Math.max(1, nR), missed: () => brute };
}

// ------------------------------------------------------------- GEOMETRY -----

const pct = (v, f) => (v.length ? v[Math.min(v.length - 1, Math.max(0, Math.floor(f * (v.length - 1))))] : 0);
const stat3 = (arr, d = 2, suf = '') => {
  const v = arr.slice().sort((a, b) => a - b);
  const q = (f) => pct(v, f).toFixed(d) + suf;
  return `${q(0.5).padStart(6)} ${q(0.9).padStart(6)} ${q(1).padStart(6)}`;
};
const share = (n, d) => `${d ? ((100 * n) / d).toFixed(0) : '0'}%`;

// Twelve points strictly inside a triangle: the barycentric grid of order four
// with the corners left off. The corners are on the patch by construction, so
// asking about them only ever returns the lift back.
const BARY = [];
for (let i = 0; i <= 4; i++) {
  for (let j = 0; i + j <= 4; j++) {
    const k = 4 - i - j;
    if (i === 4 || j === 4 || k === 4) continue;
    BARY.push([i / 4, j / 4, k / 4]);
  }
}

/** The painted mouth as a closed polyline in the face plane, and distance to it. */
function mawOutline(p, maw, grown) {
  const prof = mawProfile(p.mawShape);
  const g = grown ? 1 + Math.max(0, p.lips) : 1;
  const rx = maw.mw * g;
  const ry = maw.mh * g * (grown ? 1.25 : 1);
  const pts = [];
  const S = 72;
  for (let i = 0; i <= S; i++) { const u = -1 + (2 * i) / S; pts.push([maw.mx + u * rx, maw.my + prof.up(u) * ry]); }
  for (let i = S; i >= 0; i--) { const u = -1 + (2 * i) / S; pts.push([maw.mx + u * rx, maw.my + prof.down(u) * ry]); }
  pts.push(pts[0]);
  return pts;
}

/** Distance from (x, y) to a closed polyline, zero anywhere inside it. */
function distOutside(poly, x, y) {
  let inside = false;
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[i + 1];
    if ((ay > y) !== (by > y) && x < ax + ((y - ay) / (by - ay || 1e-12)) * (bx - ax)) inside = !inside;
    const ex = bx - ax, ey = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / Math.max(ex * ex + ey * ey, 1e-12)));
    best = Math.min(best, Math.hypot(x - (ax + ex * t), y - (ay + ey * t)));
  }
  return inside ? 0 : best;
}

/** Where on the head a point is, said in words. */
function region(v) {
  const az = (Math.atan2(v.x, v.z) * 180) / Math.PI;
  const el = (Math.atan2(v.y, Math.hypot(v.x, v.z)) * 180) / Math.PI;
  const a = Math.abs(az);
  const side = az >= 0 ? 'R' : 'L';
  const band = a <= 25 ? 'face' : a <= 60 ? `cheek-${side}` : a <= 115 ? `side-${side}` : 'back';
  const lift = el > 25 ? ' high' : el < -25 ? ' low' : '';
  return { label: band + lift, az, el };
}

// ---------------------------------------------------------------- SWEEP -----

const patchRows = [];   // one per patch built
const toothRows = [];   // one per tooth built
const creatureRows = [];

function measure(seed) {
  const p = randomize(seed);
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);

  // the drawn skull: the biggest FRONT-facing mesh under the head pivot. The
  // outline shell is the same geometry grown and drawn back-faces-only, and
  // measuring against that would put every patch a whole outline under the skin.
  let headMesh = null;
  c.rig.headPivot.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    if (!headMesh || o.geometry.attributes.position.count > headMesh.geometry.attributes.position.count) headMesh = o;
  });
  const probe = skinProbe(headMesh);
  const R = probe.R;
  const S = c.rig.scale;
  const maw = c.rig.maw;

  // eye plans, to give an anonymous socket a name
  const plans = [];
  c.rig.headPivot.traverse((o) => { if (o.userData.eyePlan) plans.push(o.userData.eyePlan); });

  // the two maw bands: the lip is the one that reaches further across
  const mawMeshes = [];
  c.rig.headPivot.traverse((o) => { if (o.isMesh && o.userData.maw) mawMeshes.push(o); });
  const spanOf = (m) => {
    const pos = m.geometry.attributes.position;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pos.count; i++) { lo = Math.min(lo, pos.getX(i)); hi = Math.max(hi, pos.getX(i)); }
    return hi - lo;
  };
  const lipMesh = mawMeshes.length > 1
    ? mawMeshes.reduce((a, b) => (spanOf(a) >= spanOf(b) ? a : b))
    : null;

  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const cc = new THREE.Vector3();
  const n = new THREE.Vector3();
  const q = new THREE.Vector3();
  const skin = new THREE.Vector3();
  const nv = new THREE.Vector3();

  // ---- 1. bare skin through a projected patch ----------------------------
  const patches = [];
  c.rig.headPivot.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    // decalGeometry and bandGeometry are the only things in the project that
    // build a raw BufferGeometry, and they are the only ones with no uv
    const g = o.geometry;
    if (g.type !== 'BufferGeometry' || g.attributes.uv || !g.index || !g.attributes.normal) return;
    patches.push(o);
  });

  let worstPatch = null;
  for (const o of patches) {
    const g = o.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const idx = g.index;

    // name it
    let name = 'scar';
    if (o.userData.maw) name = o === lipMesh ? 'maw lip' : 'maw cavity';
    else if (o.userData.nose) name = `nose ${p.noseType}`;
    else {
      // socket centres are the eye's own (x, y), so the nearest plan names it
      let cx = 0, cy = 0;
      for (let i = 0; i < pos.count; i++) { cx += pos.getX(i); cy += pos.getY(i); }
      cx /= pos.count; cy /= pos.count;
      let bestD = Infinity, bestE = null;
      for (const e of plans) {
        const d = Math.hypot(cx - e.x, cy - e.y) / Math.max(e.size, 1e-6);
        if (d < bestD) { bestD = d; bestE = e; }
      }
      if (bestE && bestD < 0.8) name = `eye ${p.eyeStyle}`;
    }
    if (ONLY && !name.includes(ONLY)) continue;

    // the lift this patch was actually built with: a vertex sits at
    // skin + normal*lift, so the radial gap from the skull to the vertex is
    // lift / (normal . ray). Median over the patch's vertices — a vertex that
    // landed on a facet crease answers for a facet the ray does not cross.
    const lifts = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const len = v.length();
      if (!(len > 0)) continue;
      const r = probe.query(v.x, v.y, v.z);
      if (r < 0) continue;
      nv.fromBufferAttribute(nor, i);
      const cos = nv.dot(v) / Math.max(len * nv.length(), 1e-9);
      if (cos < 0.2) continue;
      lifts.push((len - r) * cos);
    }
    lifts.sort((x, y) => x - y);
    const lift = Math.max(pct(lifts, 0.5), 1e-5);

    let worst = -Infinity;         // skin above the patch's plane, head units
    let worstAt = null;
    let holed = 0;
    const nT = idx.count / 3;
    for (let t = 0; t < nT; t++) {
      a.fromBufferAttribute(pos, idx.getX(t * 3));
      b.fromBufferAttribute(pos, idx.getX(t * 3 + 1));
      cc.fromBufferAttribute(pos, idx.getX(t * 3 + 2));
      n.copy(b).sub(a).cross(q.copy(cc).sub(a));
      if (n.lengthSq() < 1e-16) continue;
      n.normalize();
      if (n.dot(a) < 0) n.negate();     // outward, away from the head's centre
      let tw = -Infinity;
      for (const [w0, w1, w2] of BARY) {
        q.set(a.x * w0 + b.x * w1 + cc.x * w2, a.y * w0 + b.y * w1 + cc.y * w2, a.z * w0 + b.z * w1 + cc.z * w2);
        const len = q.length();
        if (!(len > 0)) continue;
        const r = probe.query(q.x, q.y, q.z);
        if (r < 0) continue;
        skin.copy(q).multiplyScalar(r / len);
        const h = skin.sub(a).dot(n);
        if (h > tw) { tw = h; if (h > worst) { worst = h; worstAt = skin.clone().add(a); } }
      }
      if (tw > EPS) holed++;
    }
    if (worst === -Infinity) continue;
    const row = {
      seed, name, lift, worst, ratio: 1 + worst / lift,
      holed: holed / Math.max(nT, 1), tris: nT, at: worstAt, p, S, maw,
    };
    patchRows.push(row);
    if (!worstPatch || row.ratio > worstPatch.ratio) worstPatch = row;
  }

  // ---- 2. a tooth out through the face -----------------------------------
  const lipPoly = maw ? mawOutline(p, maw, p.lips > 0.01) : null;
  let worstTooth = null;
  c.rig.headPivot.traverse((o) => {
    const tag = o.userData.tooth;
    if (!tag || !o.isMesh || o.material?.side === THREE.BackSide) return;
    const pos = o.geometry.attributes.position;
    let worst = -Infinity;
    let at = null;
    let atLocal = null;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      headMesh.worldToLocal(v);
      const len = v.length();
      if (!(len > 0)) continue;
      const r = probe.query(v.x, v.y, v.z);
      if (r < 0) continue;
      if (len - r > worst) {
        worst = len - r;
        at = v.clone();
        atLocal = q.fromBufferAttribute(pos, i).clone();
      }
    }
    if (worst === -Infinity) return;
    const rim = lipPoly ? distOutside(lipPoly, at.x, at.y) : Infinity;
    // which END of the rod is out: the biting end is at local y = -side*len/2,
    // the planted root at +side*len/2
    const end = tag.len > 1e-6
      ? (atLocal.y * tag.side > 0 ? 'root' : 'point')
      : 'ball';
    const row = {
      seed, type: p.toothType, side: tag.side, row: tag.side > 0 ? 'top' : 'bottom',
      reach: worst / R, rim: rim / R, end, at, reg: region(at), p, R,
    };
    toothRows.push(row);
    if (!worstTooth || row.reach > worstTooth.reach) worstTooth = row;
  });

  creatureRows.push({
    seed, p, S, R,
    patch: worstPatch ? worstPatch.ratio : 0,
    patchName: worstPatch ? worstPatch.name : '-',
    patchAbs: worstPatch ? worstPatch.worst : 0,
    tooth: worstTooth ? worstTooth.reach : 0,
    toothClear: Math.max(0, ...toothRows.filter((r) => r.seed === seed && r.rim > CLEAR).map((r) => r.reach), 0),
    worstTooth,
    missed: probe.missed(),
  });
  c.dispose();
  return { p, probe, headMesh, R };
}

// ------------------------------------------------------------ VALIDATION ----
// The probe is the whole tool; if it is wrong every number below is wrong in
// the same direction and nobody notices. So it is checked twice on the first
// creature, against the skull's own vertices (which must answer zero) and
// against THREE.Raycaster (which is slow but is not this code).
function validate() {
  const p = randomize(7013243);
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);
  let headMesh = null;
  c.rig.headPivot.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    if (!headMesh || o.geometry.attributes.position.count > headMesh.geometry.attributes.position.count) headMesh = o;
  });
  const probe = skinProbe(headMesh);
  const pos = headMesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  let selfMax = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = probe.query(v.x, v.y, v.z);
    selfMax = Math.max(selfMax, Math.abs(v.length() - r));
  }
  const rc = new THREE.Raycaster();
  const O = new THREE.Vector3(0, 0, 0);
  const d = new THREE.Vector3();
  let rayMax = 0;
  let rays = 0;
  for (let i = 0; i < 400; i++) {
    const z = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    d.set(Math.cos(t) * s, z, Math.sin(t) * s);
    rc.set(O, d);
    const hits = rc.intersectObject(headMesh, false);
    if (!hits.length) continue;
    rays++;
    rayMax = Math.max(rayMax, Math.abs(hits[hits.length - 1].distance - probe.query(d.x, d.y, d.z)));
  }
  const out = { tris: probe.nTri, selfMax, rayMax, rays, R: probe.R, brute: probe.missed() };
  c.dispose();
  return out;
}

// ----------------------------------------------------------------- RUN ------

const fp = (f) => {
  const path = join(SRC, f);
  const md5 = createHash('md5').update(readFileSync(path)).digest('hex').slice(0, 8);
  const mt = statSync(path).mtime.toISOString().replace('T', ' ').slice(0, 19);
  return `${f} ${md5} ${mt}`;
};

const t0 = Date.now();
const val = validate();
console.log(`mouth-sweep: ${N} creatures, seeds i*11+3`);
console.log(`tree: ${fp('surface.js')} | ${fp('features.js')} | ${fp('head.js')}`);
console.log(`probe: ${val.tris} head triangles (HEAD_DETAIL is 500 faces, not 5120), mean radius R = ${val.R.toFixed(3)} head units`);
console.log(`       the skull's own ${1500} vertices answer 0 to within ${val.selfMax.toExponential(1)}; vs THREE.Raycaster on ${val.rays} rays, max |diff| ${val.rayMax.toExponential(1)}${val.brute ? `; ${val.brute} bucket misses fell back to brute force` : ''}`);

for (let i = 0; i < N; i++) measure(i * 11 + 3);

console.log(`\nbuilt ${creatureRows.length} creatures, ${patchRows.length} projected patches, ${toothRows.length} teeth in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

// ---- 1 ---------------------------------------------------------------------
console.log('1. BARE SKIN THROUGH A DECAL');
console.log('   the skull above a patch triangle, in units of the lift that patch was built with.');
console.log('   1.00 = skin level with the patch; over 1.00 = bare face showing through it.\n');

const holedCreatures = creatureRows.filter((r) => r.patch > 1 && r.patchAbs > EPS);
console.log(`creatures with bare skin through some patch   ${share(holedCreatures.length, creatureRows.length).padStart(4)}`);
console.log(`worst patch on a creature, in its own lifts:  ${stat3(creatureRows.map((r) => r.patch))}   (median p90 max)`);
console.log(`                          in head units:      ${stat3(creatureRows.map((r) => r.patchAbs), 4)}\n`);

const byName = new Map();
for (const r of patchRows) {
  let g = byName.get(r.name);
  if (!g) byName.set(r.name, (g = []));
  g.push(r);
}
console.log('patch                 built   holed   skin through, in lifts      holed area of the patch   worst seed');
console.log('                              patches  median    p90    max      median    p90    max');
const named = [...byName.entries()].sort((x, y) => {
  const h = (g) => g.filter((r) => r.ratio > 1 && r.worst > EPS).length / g.length;
  return h(y[1]) - h(x[1]);
});
for (const [name, g] of named) {
  const bad = g.filter((r) => r.ratio > 1 && r.worst > EPS);
  const worst = g.reduce((x, y) => (x.ratio > y.ratio ? x : y));
  console.log(
    `${name.padEnd(20)} ${String(g.length).padStart(5)}   ${share(bad.length, g.length).padStart(5)}   ` +
    `${stat3(g.map((r) => r.ratio))}      ${stat3(g.map((r) => r.holed * 100), 0, '%')}    ${worst.seed}`,
  );
}

console.log('\nworst patches — where the hole is, and what the mouth was doing:');
const worstPatches = patchRows.slice().sort((x, y) => y.ratio - x.ratio).slice(0, 8);
for (const r of worstPatches) {
  let where = `at x ${(r.at.x / r.S).toFixed(2)}S y ${(r.at.y / r.S).toFixed(2)}S`;
  if (r.name.startsWith('maw') && r.maw) {
    where = `at u ${((r.at.x - r.maw.mx) / Math.max(r.maw.mw, 1e-6)).toFixed(2)} v ${((r.at.y - r.maw.my) / Math.max(r.maw.mh, 1e-6)).toFixed(2)} of the mouth`;
  }
  console.log(
    `  seed ${String(r.seed).padStart(6)} ${r.name.padEnd(14)} ${r.ratio.toFixed(2)} lifts (${r.worst.toFixed(4)} over a lift of ${r.lift.toFixed(4)})  ` +
    `${(100 * r.holed).toFixed(0)}% of ${r.tris} faces  ${where}`,
  );
  console.log(
    `                 | maw ${r.p.mawShape} lips ${r.p.lips.toFixed(2)} open ${r.p.mouthOpen.toFixed(2)}  eyes ${r.p.eyeStyle} ${r.p.eyeSize.toFixed(2)}  nose ${r.p.noseType}  lumps ${r.p.lumps.toFixed(2)} scale ${r.p.lumpScale.toFixed(2)} wear ${r.p.wear.toFixed(2)}`,
  );
}

// ---- 2 ---------------------------------------------------------------------
console.log('\n2. A TOOTH OUT THROUGH THE FACE');
console.log('   every tooth vertex, radially past the drawn skull, in head radii R.');
console.log(`   "clear of the mouth" = the excursion is more than ${CLEAR.toFixed(2)}R from the painted mouth's own rim.\n`);

const anyOut = creatureRows.filter((r) => r.tooth > 0.02);
const rods = creatureRows.filter((r) => r.toothClear > 0.02);
console.log(`creatures with a tooth past the skin at all     ${share(anyOut.length, creatureRows.length).padStart(4)}   reach ${stat3(creatureRows.map((r) => r.tooth), 2, 'R')}`);
console.log(`creatures with one clear of the mouth (a rod)   ${share(rods.length, creatureRows.length).padStart(4)}   reach ${stat3(creatureRows.map((r) => r.toothClear), 2, 'R')}`);
const outTeeth = toothRows.filter((r) => r.reach > 0.02);
console.log(`teeth past the skin                            ${share(outTeeth.length, toothRows.length).padStart(4)} of ${toothRows.length}`);
console.log(`  of those, how far from the mouth's rim:       ${stat3(outTeeth.map((r) => r.rim), 2, 'R')}  — the line above sits in this distribution\n`);

const byType = new Map();
for (const r of toothRows) {
  let g = byType.get(r.type);
  if (!g) byType.set(r.type, (g = []));
  g.push(r);
}
console.log('toothType   teeth   past skin   reach in head radii        clear of the mouth   which end   worst seed');
console.log('                              median    p90    max         %      max');
const typed = [...byType.entries()].sort((x, y) => {
  const m = (g) => Math.max(...g.map((r) => r.reach));
  return m(y[1]) - m(x[1]);
});
for (const [type, g] of typed) {
  const out = g.filter((r) => r.reach > 0.02);
  const clear = g.filter((r) => r.reach > 0.02 && r.rim > CLEAR);
  const worst = g.reduce((x, y) => (x.reach > y.reach ? x : y));
  const ends = new Map();
  for (const r of clear) ends.set(r.end, (ends.get(r.end) || 0) + 1);
  const endTxt = [...ends.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(' ') || '-';
  console.log(
    `${type.padEnd(10)} ${String(g.length).padStart(5)}   ${share(out.length, g.length).padStart(6)}    ` +
    `${stat3(g.map((r) => r.reach), 2, 'R')}     ${share(clear.length, g.length).padStart(5)}  ${(clear.length ? Math.max(...clear.map((r) => r.reach)) : 0).toFixed(2)}R   ${endTxt.padEnd(12)} ${worst.seed}`,
  );
}

console.log('\nworst teeth — a rod through the face, not a fang over the lip:');
const worstTeeth = toothRows.filter((r) => r.rim > CLEAR).sort((x, y) => y.reach - x.reach).slice(0, 10);
for (const r of worstTeeth) {
  console.log(
    `  seed ${String(r.seed).padStart(6)} ${r.type.padEnd(8)} ${r.reach.toFixed(2)}R out, by its ${r.end.padEnd(5)} ` +
    `${r.rim.toFixed(2)}R clear of the rim, ${r.row.padEnd(6)} row, on the ${r.reg.label} (az ${r.reg.az.toFixed(0)}deg el ${r.reg.el.toFixed(0)}deg)`,
  );
  console.log(
    `                 | maw ${r.p.mawShape} open ${r.p.mouthOpen.toFixed(2)} width ${r.p.mouthWidth.toFixed(2)}  teeth ${r.p.toothType} size ${r.p.toothSize.toFixed(2)} top ${r.p.teethTop} bottom ${r.p.teethBottom}`,
  );
}

console.log('\nfor comparison, the worst fang that is still AT the mouth (the look this thing is for):');
for (const r of toothRows.filter((x) => x.rim <= CLEAR).sort((x, y) => y.reach - x.reach).slice(0, 3)) {
  console.log(`  seed ${String(r.seed).padStart(6)} ${r.type.padEnd(8)} ${r.reach.toFixed(2)}R out, by its ${r.end}, ${r.rim.toFixed(2)}R from the rim, ${r.row} row, on the ${r.reg.label}`);
}

// ---- the two seeds the art director reported --------------------------------
console.log('\nthe two reported seeds, measured the same way:');
for (const seed of [7013243, 2690228]) {
  patchRows.length = 0;
  toothRows.length = 0;
  const before = creatureRows.length;
  measure(seed);
  const cr = creatureRows[creatureRows.length - 1];
  const wp = patchRows.slice().sort((x, y) => y.ratio - x.ratio)[0];
  const wt = toothRows.slice().sort((x, y) => y.reach - x.reach)[0];
  console.log(`  seed ${seed}  maw ${cr.p.mawShape} lips ${cr.p.lips.toFixed(2)} open ${cr.p.mouthOpen.toFixed(2)} teeth ${cr.p.toothType} ${cr.p.toothSize.toFixed(2)} ${cr.p.teethTop}/${cr.p.teethBottom} lumps ${cr.p.lumps.toFixed(2)}`);
  if (wp) {
    const u = wp.maw ? ` at u ${((wp.at.x - wp.maw.mx) / Math.max(wp.maw.mw, 1e-6)).toFixed(2)} v ${((wp.at.y - wp.maw.my) / Math.max(wp.maw.mh, 1e-6)).toFixed(2)}` : '';
    console.log(`    worst patch: ${wp.name} ${wp.ratio.toFixed(2)} lifts (${wp.worst.toFixed(4)} over ${wp.lift.toFixed(4)})${wp.name.startsWith('maw') ? u : ''}, ${(100 * wp.holed).toFixed(0)}% of its faces holed`);
  }
  if (wt) console.log(`    worst tooth: ${wt.type} ${wt.reach.toFixed(2)}R out by its ${wt.end}, ${wt.rim.toFixed(2)}R clear of the rim, ${wt.row} row, on the ${wt.reg.label}`);
  creatureRows.length = before;
}
