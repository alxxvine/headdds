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
//    skin and then lifted off it along the skin's own normal. Between the
//    samples the skull rises, and wherever it rises further than the lift the
//    skin is in FRONT of the decal: bare face through the lip ring.
//
//    So for every triangle of every patch this takes twelve points inside it,
//    finds the skin along each point's own ray out of the head's centre (the
//    skull is star-shaped, so there is exactly one) and measures the SAG: how
//    far the skull stands above the chord plane through the bare-skin samples,
//    along that plane's own normal, which is the unit every offset in
//    features.js is written in. sag over lift greater than one is a hole.
//
//    Both halves of that ratio are measured off the built mesh and neither is
//    read out of the source. The lattice is un-lifted first — every vertex
//    pushed back down its own normal — so the sag is a property of the
//    sampling and does not move when somebody changes an offset; and the lift
//    is recovered from the mesh, since a vertex sits at skin + normal*lift, so
//    the radial gap between the vertex and the skull times the cosine between
//    the normal and the ray is that lift. The tool therefore keeps telling the
//    truth while surface.js is being edited under it, which it was, twice,
//    during the writing of this file.
//
//    Measured against the TESSELLATED skull, which is the one that is drawn:
//    HEAD_DETAIL 4 is 500 triangles, not the 5120 the comment claims, and the
//    analytic surface bulges above every facet of it. Reporting the analytic
//    rise would invent holes no player can see.
//
//    The same rays are then asked of a flat 0.010 lift — the offset most of
//    features.js carried before surface.js started measuring its own — and
//    that CONTROL is what makes a clean report evidence rather than an absence
//    of evidence. A detector that never fires has not been shown to work.
//
//    Three more things fall out of the same pass, all consequences of a lift
//    large enough to clear a sag. STANDOFF: the lift is a maximum over the
//    whole patch, so one bad chord — a fold, a crease, a vertex surfaceAt had
//    to walk — raises the ENTIRE patch, and the tool caught eye sockets
//    floating a whole head radius in front of the face. The lift is reported
//    against the patch's own footprint as well as in head units, because a
//    plate hanging off the head is not a decal however well it covers the
//    skin. SHEARED QUADS: a quad whose ends lie on different facets of the
//    skull is lifted along two normals up to forty degrees apart, so the lift
//    does not translate it, it twists it. SLID OFF:
//    the lift goes along the normal, not along the ray, so where the skin
//    slants away from the ray a big lift carries the whole decal off its own
//    footprint, and rays through the skin under the patch hit no patch at all.
//    That one is asked only within sixty degrees of the skin's normal, because
//    past that the ray out of the head's centre is a bad stand-in for a view
//    ray and the question stops being about the creature.
//
// 2. A TOOTH OUT THROUGH THE FACE. Every cap in addTeeth is solved in the
//    mouth's own x and y; a curl sweeps the tooth in y and Z and nothing
//    compares the result to the skull. So this takes each tooth's whole
//    geometry — every vertex, never a bounding box, because a rotated rod's
//    AABB is a lie — and finds its furthest point radially outside the drawn
//    skull, in head radii.
//
//    A fang overhanging the lip is the look this thing is for; a rod out of a
//    cheek is not. The two are told apart by where the excursion happens —
//    and NOT in the face plane, which is the trap the first draft of this tool
//    fell into: a hook thrown forward by its curl is still over the mouth from
//    straight on, so a frontal rim distance calls the reported rod a fang. So
//    the excursion is taken back to the skin under it (the skin point along
//    the same ray) and measured in 3D against the painted mouth itself — the
//    nearest vertex of the lip band, or of the cavity band when there are no
//    lips. Zero anywhere over the mouth, and it grows as the tooth's exit
//    wanders onto bare cheek. Each tooth reports two such points: the one that
//    stands furthest out, and the one furthest from the mouth that is still
//    outside the skin, which is the one that reads as a rod.
//
//    And it names the culprit — the toothType, the row, how much of the tooth
//    is outside the skull, and which END of it is out, since a hook leaves the
//    face by its ROOT while a barb leaves by its point, and a guard that
//    watches one of those cannot see the other.
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

// A gap under this is float noise rather than a part standing out of the skin.
// Head units; a head is about one across, its mean radius about 1.1.
const EPS = 5e-4;
// How far from the painted mouth, in head radii, an excursion has to happen
// before the skin under it is bare face rather than lip. Printed as a
// distribution below so the line can be moved by anyone who disagrees with it.
const BARE = 0.10;
// The control lift. Every fixed offset in features.js is between 0.006 and
// 0.022, and 0.010 is the one most of them use; a lattice whose sag beats this
// is a lattice that only the self-measured lift is holding together.
const CONTROL = 0.010;

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
function skinProbe(headMesh, mat = null) {
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
      if (mat) v.applyMatrix4(mat);
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

  // any mesh under the head pivot, taken into the skull's own coordinates —
  // the ones headPoint, mawBox and every decal are written in
  const inv = new THREE.Matrix4().copy(headMesh.matrixWorld).invert();
  const toHead = (o) => inv.clone().multiply(o.matrixWorld);

  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const cc = new THREE.Vector3();
  const n = new THREE.Vector3();
  const q = new THREE.Vector3();
  const skin = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const e0 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();

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
  let worstSag = null;
  let worstStand = null;
  let samples = 0;
  let offPatch = 0;
  for (const o of patches) {
    const g = o.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const idx = g.index;

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

    // The same lattice with the lift taken back off it: every vertex pushed
    // back down its own normal, which is exactly where surfaceAt found it. The
    // rise of the skull above THIS chord plane is the SAG, and the sag belongs
    // to the sampling — it does not move when somebody changes an offset.
    const flat = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      nv.fromBufferAttribute(nor, i);
      flat[i * 3] = v.x - nv.x * lift;
      flat[i * 3 + 1] = v.y - nv.y * lift;
      flat[i * 3 + 2] = v.z - nv.z * lift;
    }
    // How big the patch's FOOTPRINT is, measured on the un-lifted lattice, so
    // that a lift can be judged against the thing being lifted: a disc of
    // radius 0.05 standing 0.2 off the face is not a decal any more, it is a
    // plate floating in front of the head. Taken on the un-lifted lattice
    // because the lift is what is being judged — on the built one, a decal
    // floating a head's radius off the face reports a footprint a head across
    // and its own centroid lands nowhere near the eye it belongs to, which is
    // how the worst offenders in this run first turned up filed as scars.
    let ccx = 0, ccy = 0, ccz = 0;
    for (let i = 0; i < pos.count; i++) { ccx += flat[i * 3]; ccy += flat[i * 3 + 1]; ccz += flat[i * 3 + 2]; }
    ccx /= pos.count; ccy /= pos.count; ccz /= pos.count;
    let rad = 0;
    for (let i = 0; i < pos.count; i++) {
      rad = Math.max(rad, Math.hypot(flat[i * 3] - ccx, flat[i * 3 + 1] - ccy, flat[i * 3 + 2] - ccz));
    }

    // name it
    let name = 'scar';
    if (o.userData.maw) name = o === lipMesh ? 'maw lip' : 'maw cavity';
    else if (o.userData.nose) name = `nose ${p.noseType}`;
    else {
      // socket centres are the eye's own (x, y), so the nearest plan names it
      const cx = ccx;
      const cy = ccy;
      // A socket is drawn concentric with its eye, so its centroid IS the
      // eye's own (x, y) up to the walk surfaceAt does at a miss. A scar that
      // happens to land on a cheek near an eye is not, and a loose threshold
      // here filed hundreds of them under eye styles that build no socket at
      // all — the giveaway being rows for `ring` and `dome`, which have no
      // decalGeometry call anywhere in features.js.
      let bestD = Infinity, bestE = null;
      for (const e of plans) {
        const d = Math.hypot(cx - e.x, cy - e.y) / Math.max(e.size, 1e-6);
        if (d < bestD) { bestD = d; bestE = e; }
      }
      // ...and of the eye's own scale: the narrowest socket in features.js is
      // 0.55 of the eye's size across, a scar is a few hundredths of a head
      if (bestE && bestD < 0.25 && rad > bestE.size * 0.35) name = `eye ${p.eyeStyle}`;
    }
    if (ONLY && !name.includes(ONLY)) continue;

    const a0 = new THREE.Vector3(), b0 = new THREE.Vector3(), c0 = new THREE.Vector3(), n0 = new THREE.Vector3();
    const get = (arr, i, out) => out.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);

    // A probe on the patch itself, so the built patch can be asked the same
    // question an eye asks: along this ray, which of the two is the outer one?
    //
    // Comparing the skin against the PLANE of a triangle instead was the first
    // draft, and on a decal lifted as far off the skin as these are it reports
    // nonsense: a quad whose two ends sit on different facets of the skull is
    // lifted along two normals up to 40 degrees apart, which shears it until it
    // stands nearly edge on to the ray, and the height of anything above the
    // plane of an edge-on triangle is a number with no meaning. Intersecting
    // the ray with the patch has none of that, and it also gets the sheared
    // quad's neighbours right: the skin is only bare if NOTHING covers it.
    const patchProbe = skinProbe(o, toHead(o));

    let sag = -Infinity;           // skin above the bare-skin chord plane
    let sagAt = null;
    let holed = 0;                 // faces the patch's own lift does not cover
    let sagged = 0;                // faces a flat control lift would not cover
    let folded = 0;                // faces the lift has sheared off their own plane
    let bare = 0;                  // rays that hit no part of the built patch
    let rays = 0;
    const nT = idx.count / 3;
    for (let t = 0; t < nT; t++) {
      const ia = idx.getX(t * 3), ib = idx.getX(t * 3 + 1), ic = idx.getX(t * 3 + 2);
      a.fromBufferAttribute(pos, ia);
      b.fromBufferAttribute(pos, ib);
      cc.fromBufferAttribute(pos, ic);
      get(flat, ia, a0); get(flat, ib, b0); get(flat, ic, c0);
      n.copy(b).sub(a).cross(q.copy(cc).sub(a));
      n0.copy(b0).sub(a0).cross(q.copy(c0).sub(a0));
      if (n.lengthSq() < 1e-16 || n0.lengthSq() < 1e-16) continue;
      n.normalize();
      n0.normalize();
      if (n.dot(a) < 0) n.negate();      // outward, away from the head's centre
      if (n0.dot(a0) < 0) n0.negate();
      // A quad whose two ends sit on different facets of the skull is lifted
      // along two normals that can be forty degrees apart, so the lift does not
      // translate it, it SHEARS it. Counted, because the bigger the lift the
      // worse this gets, and it is the thing that limits how far a lift can be
      // raised to cure a sag.
      if (n.dot(n0) < Math.cos(Math.PI / 6)) folded++;
      let ts = -Infinity;
      for (const [w0, w1, w2] of BARY) {
        // the ray goes through the SKIN-level sample: the patch's footprint on
        // the skull is where the samples were asked for, not where the lift
        // ended up putting them
        q.set(a0.x * w0 + b0.x * w1 + c0.x * w2, a0.y * w0 + b0.y * w1 + c0.y * w2, a0.z * w0 + b0.z * w1 + c0.z * w2);
        const len = q.length();
        if (!(len > 0)) continue;
        const r = probe.query(q.x, q.y, q.z);
        if (r < 0) continue;
        skin.copy(q).multiplyScalar(r / len);
        // The ray out of the head's centre is not the triangle's own normal,
        // and on a patch lying at a slant to it — a visor on the temple, a
        // socket near the silhouette — the skin it lands on can be past the
        // triangle's own edge. Counting that would report a hole in a patch
        // over skull the patch never claimed to cover, so the skin point has
        // to land inside the triangle it is being compared against.
        e0.copy(b0).sub(a0);
        e1.copy(c0).sub(a0);
        e2.copy(skin).sub(a0);
        const d00 = e0.dot(e0), d01 = e0.dot(e1), d11 = e1.dot(e1);
        const den = d00 * d11 - d01 * d01;
        if (Math.abs(den) < 1e-18) continue;
        const bb1 = (d11 * e2.dot(e0) - d01 * e2.dot(e1)) / den;
        const bb2 = (d00 * e2.dot(e1) - d01 * e2.dot(e0)) / den;
        samples++;
        if (bb1 < -0.05 || bb2 < -0.05 || bb1 + bb2 > 1.05) { offPatch++; continue; }
        // how far the skull rises above the bare-skin chord, along the chord's
        // own normal — the units every offset in features.js is written in
        const h0 = e2.dot(n0);
        if (h0 > ts) { ts = h0; if (h0 > sag) { sag = h0; sagAt = skin.clone(); } }
        // and, separately, whether the patch as built is still in front of
        // this piece of skin AT ALL: the lift goes along the NORMAL, so on a
        // patch lying at a slant to the ray a big lift slides the whole decal
        // off its own footprint, and no amount of lift covers the skin.
        //
        // Only asked where the ray out of the head's centre is within sixty
        // degrees of the skin's own normal. Past that the ray is a bad stand-in
        // for a view ray — the player is looking at that skin edge on too — and
        // a question asked there answers about the model, not the creature.
        if (n0.dot(skin) / r > 0.5) {
          rays++;
          if (patchProbe.query(skin.x, skin.y, skin.z) < 0) bare++;
        }
      }
      if (ts > lift) holed++;
      if (ts > CONTROL) sagged++;
    }
    if (sag === -Infinity) continue;
    const row = {
      seed, name, lift, sag, ratio: sag / lift, bare, rays,
      rad, stand: lift / Math.max(rad, 1e-6),
      holed: holed / Math.max(nT, 1), sagged: sagged / Math.max(nT, 1),
      folded: folded / Math.max(nT, 1),
      tris: nT, at: sagAt, p, S, maw,
    };
    patchRows.push(row);
    if (!worstPatch || row.ratio > worstPatch.ratio) worstPatch = row;
    if (!worstSag || row.sag > worstSag.sag) worstSag = row;
    // judged on the absolute lift, not on the ratio: a scar a hundredth of a
    // head across lifted twice its own radius is still a hundredth of a head
    // off the skin and nobody sees it, while a socket lifted a tenth of a head
    // is a plate hanging in front of the face
    if (!worstStand || row.lift > worstStand.lift) worstStand = row;
  }

  // ---- 2. a tooth out through the face -----------------------------------
  // The painted mouth, as the points it is actually painted on: the lip band
  // when there is one, the cavity band when there is not. Distance to the
  // nearest of these IS the distance from the mouth, in three dimensions, on
  // the skull — which is the question, and which a frontal rim distance
  // answers wrongly for exactly the teeth this tool exists for.
  const mouthPts = [];
  {
    const src = lipMesh ?? mawMeshes[0];
    if (src) {
      const pos = src.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) mouthPts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
  }
  const fromMouth = (pt) => {
    let best = Infinity;
    for (let i = 0; i < mouthPts.length; i += 3) {
      const dx = pt.x - mouthPts[i], dy = pt.y - mouthPts[i + 1], dz = pt.z - mouthPts[i + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) best = d;
    }
    return mouthPts.length ? Math.sqrt(best) : Infinity;
  };

  let worstTooth = null;
  c.rig.headPivot.traverse((o) => {
    const tag = o.userData.tooth;
    if (!tag || !o.isMesh || o.material?.side === THREE.BackSide) return;
    const pos = o.geometry.attributes.position;
    // the whole geometry, vertex by vertex — never a bounding box: a rod
    // rotated by a curl has an AABB far bigger than the rod
    let worst = -Infinity;      // stands furthest out of the skull
    let at = null, atLocal = null;
    let far = -Infinity;        // outside the skin FURTHEST from the mouth
    let farAt = null, farGap = 0, farLocal = null;
    let outside = 0;
    let seen = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      headMesh.worldToLocal(v);
      const len = v.length();
      if (!(len > 0)) continue;
      const r = probe.query(v.x, v.y, v.z);
      if (r < 0) continue;
      const gap = len - r;
      seen++;
      if (gap > EPS) outside++;
      if (gap > worst) {
        worst = gap;
        at = v.clone();
        atLocal = q.fromBufferAttribute(pos, i).clone();
      }
      // where the excursion happens is asked of the SKIN under the vertex, not
      // of the vertex: the skin point is on the head, so its distance from the
      // mouth is a distance across the face
      if (gap > EPS) {
        const d = fromMouth(skin.copy(v).multiplyScalar(r / len));
        if (d > far) {
          far = d; farGap = gap; farAt = v.clone();
          farLocal = q.fromBufferAttribute(pos, i).clone();
        }
      }
    }
    if (worst === -Infinity) return;
    const skinAt = skin.copy(at).multiplyScalar(probe.query(at.x, at.y, at.z) / at.length());
    const rim = fromMouth(skinAt);
    // which END of the rod is out: the biting end is at local y = -side*len/2,
    // the planted root at +side*len/2. A molar is a ball and has neither — its
    // `len` never reaches its geometry at all.
    const endOf = (loc) => (o.geometry.type === 'SphereGeometry' || tag.len <= 1e-6
      ? 'ball' : (loc.y * tag.side > 0 ? 'root' : 'point'));
    const row = {
      seed, type: p.toothType, side: tag.side, row: tag.side > 0 ? 'top' : 'bottom',
      reach: worst / R, rim: rim / R, end: endOf(atLocal), at, reg: region(at),
      out: outside / Math.max(seen, 1), len: tag.len,
      far: far > -Infinity ? far / R : 0,
      farReach: farGap / R,
      farEnd: farLocal ? endOf(farLocal) : '-',
      farReg: farAt ? region(farAt) : null,
      p, R,
    };
    toothRows.push(row);
    if (!worstTooth || row.reach > worstTooth.reach) worstTooth = row;
  });

  creatureRows.push({
    seed, p, S, R,
    patch: worstPatch ? worstPatch.ratio : 0,
    patchName: worstPatch ? worstPatch.name : '-',
    patchAbs: worstPatch ? worstPatch.sag - worstPatch.lift : 0,
    sag: worstSag ? worstSag.sag : 0,
    sagName: worstSag ? worstSag.name : '-',
    stand: worstStand ? worstStand.stand : 0,
    liftMax: worstStand ? worstStand.lift : 0,
    tooth: worstTooth ? worstTooth.reach : 0,
    toothClear: Math.max(0, ...toothRows.filter((r) => r.seed === seed && r.far > BARE).map((r) => r.farReach), 0),
    toothRoot: Math.max(0, ...toothRows.filter((r) => r.seed === seed && r.end === 'root').map((r) => r.reach), 0),
    worstTooth,
    missed: probe.missed(),
    samples, offPatch,
    bare: patchRows.filter((r) => r.seed === seed).reduce((t, r) => t + r.bare, 0),
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
  // The skull's geometry on an identity transform, drawn on both sides: the
  // head hangs two units up the neck by the time it is in the graph, and its
  // material is FrontSide, so a raycast in world space against the mesh as it
  // stands misses every time — from inside, every face is a back face. A
  // validation that silently tests nothing is worse than none.
  const bare = new THREE.Mesh(headMesh.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  bare.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  const O = new THREE.Vector3(0, 0, 0);
  const d = new THREE.Vector3();
  let rayMax = 0;
  let rays = 0;
  for (let i = 0; i < 400; i++) {
    const z = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const sn = Math.sqrt(Math.max(0, 1 - z * z));
    d.set(Math.cos(t) * sn, z, Math.sin(t) * sn);
    rc.set(O, d);
    const hits = rc.intersectObject(bare, false);
    if (!hits.length) continue;
    rays++;
    rayMax = Math.max(rayMax, Math.abs(hits[hits.length - 1].distance - probe.query(d.x, d.y, d.z)));
  }

  // And the lift measurement itself: the radial gap times the cosine, against
  // a raycast straight down the vertex's own normal, on every patch on this
  // head. If this is wrong, every ratio printed below is wrong by the same
  // factor and the tool reads as calm.
  let liftMax = 0;
  let liftN = 0;
  const n = new THREE.Vector3();
  c.rig.headPivot.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    const g = o.geometry;
    if (g.type !== 'BufferGeometry' || g.attributes.uv || !g.index || !g.attributes.normal) return;
    const pp = g.attributes.position;
    const nn = g.attributes.normal;
    for (let i = 0; i < pp.count; i += Math.max(1, Math.floor(pp.count / 12))) {
      v.fromBufferAttribute(pp, i);
      n.fromBufferAttribute(nn, i).normalize();
      rc.set(v.clone().addScaledVector(n, 0.5), n.clone().negate());
      const h = rc.intersectObject(bare, false);
      const r = probe.query(v.x, v.y, v.z);
      if (!h.length || r < 0) continue;
      liftN++;
      liftMax = Math.max(liftMax, Math.abs((h[0].distance - 0.5) - (v.length() - r) * (n.dot(v) / v.length())));
    }
  });

  const out = { tris: probe.nTri, selfMax, rayMax, rays, R: probe.R, brute: probe.missed(), liftMax, liftN };
  bare.material.dispose();
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
console.log(`       the skull's own vertices answer 0 to within ${val.selfMax.toExponential(1)}; vs THREE.Raycaster on ${val.rays} rays, max |diff| ${val.rayMax.toExponential(1)}${val.brute ? `; ${val.brute} bucket misses fell back to brute force` : ''}`);
console.log(`       measured lift vs a raycast down each patch vertex's own normal, ${val.liftN} vertices: max |diff| ${val.liftMax.toExponential(1)} head units`);

for (let i = 0; i < N; i++) measure(i * 11 + 3);

console.log(`\nbuilt ${creatureRows.length} creatures, ${patchRows.length} projected patches, ${toothRows.length} teeth in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

// ---- 1 ---------------------------------------------------------------------
console.log('1. BARE SKIN THROUGH A DECAL');
console.log('   SAG is how far the skull rises above a patch triangle inside that triangle, along');
console.log('   the triangle\'s own normal — the units every offset in features.js is written in.');
console.log('   The patch stands off the skin by its LIFT, so sag/lift over 1.00 is bare face');
console.log(`   showing through the decal. The control column asks the same of a flat ${CONTROL} lift,`);
console.log('   which is the offset most of the source carried before it started measuring its own.\n');

const holedCreatures = creatureRows.filter((r) => r.patch > 1);
const saggedCreatures = creatureRows.filter((r) => r.sag > CONTROL);
console.log(`creatures with bare skin through a patch, as built     ${share(holedCreatures.length, creatureRows.length).padStart(4)}`);
console.log(`  worst patch on a creature, sag over its own lift:    ${stat3(creatureRows.map((r) => r.patch))}   (median p90 max)`);
console.log(`  how much skin that is, in head units:                ${stat3(creatureRows.map((r) => r.patchAbs), 4)}`);
console.log(`the same creatures at a flat ${CONTROL} lift (the control)  ${share(saggedCreatures.length, creatureRows.length).padStart(4)}`);
console.log(`  worst sag on a creature, in head units:              ${stat3(creatureRows.map((r) => r.sag), 4)}`);
console.log(`creatures with a decal lifted over 0.05 off the skin   ${share(creatureRows.filter((r) => r.liftMax > 0.05).length, creatureRows.length).padStart(4)}`);
console.log(`  worst lift on a creature, in head units:             ${stat3(creatureRows.map((r) => r.liftMax), 4)}`);
console.log(`  that lift over the patch's own radius:               ${stat3(creatureRows.map((r) => r.stand))}`);
{
  const smp = creatureRows.reduce((t, r) => t + r.samples, 0);
  const off = creatureRows.reduce((t, r) => t + r.offPatch, 0);
  const bare = creatureRows.reduce((t, r) => t + r.bare, 0);
  const rays = patchRows.reduce((t, r) => t + r.rays, 0);
  console.log(`${smp} rays into ${patchRows.length} patches; ${share(off, smp)} landed past the triangle's own edge and were dropped`);
  console.log(`${share(bare, rays)} of the rest hit no part of the built patch at all — see the "slid off" column\n`);
}

const byName = new Map();
for (const r of patchRows) {
  let g = byName.get(r.name);
  if (!g) byName.set(r.name, (g = []));
  g.push(r);
}
console.log('patch                built     sag, head units        lift it was given      sag over its lift    holed  would hole  sheared  slid');
console.log('                   patches   median    p90    max   median    p90    max    median    p90    max     as    at ' + CONTROL.toFixed(3) + '    quads   off');
const named = [...byName.entries()].sort((x, y) => {
  const h = (g) => pct(g.map((r) => r.ratio).sort((i, j) => i - j), 0.9);
  return h(y[1]) - h(x[1]);
});
for (const [name, g] of named) {
  const bad = g.filter((r) => r.ratio > 1);
  const ctl = g.filter((r) => r.sag > CONTROL);
  const lifts = g.map((r) => r.lift).sort((x, y) => x - y);
  const rays = g.reduce((t, r) => t + r.rays, 0);
  console.log(
    `${name.padEnd(18)} ${String(g.length).padStart(6)}   ${stat3(g.map((r) => r.sag), 4)}   ${stat3(g.map((r) => r.lift), 4)}   ` +
    `${stat3(g.map((r) => r.ratio))}   ${share(bad.length, g.length).padStart(5)}   ${share(ctl.length, g.length).padStart(6)}   ` +
    `${(100 * g.reduce((t, r) => t + r.folded, 0) / g.length).toFixed(0).padStart(4)}%  ${share(g.reduce((t, r) => t + r.bare, 0), rays).padStart(5)}`,
  );
}

console.log('\nworst patches as built — sag past the lift the patch was given:');
const worstBuilt = patchRows.filter((r) => r.ratio > 1).sort((x, y) => y.ratio - x.ratio).slice(0, 6);
if (!worstBuilt.length) console.log(`  none: on every patch built here, the lift surface.js measured for itself was larger than the worst sag this tool could find in it`);
for (const r of worstBuilt) console.log(...patchLines(r, `sag ${r.sag.toFixed(4)} over a lift of ${r.lift.toFixed(4)} = ${r.ratio.toFixed(2)}, ${(100 * r.holed).toFixed(0)}% of ${r.tris} faces holed`));

console.log(`\nworst patches by SAG — the lattices that only the self-measured lift is holding up:`);
for (const r of patchRows.slice().sort((x, y) => y.sag - x.sag).slice(0, 8)) {
  console.log(...patchLines(r, `sag ${r.sag.toFixed(4)} = ${(r.sag / CONTROL).toFixed(1)}x the ${CONTROL} control, lifted ${r.lift.toFixed(4)}, ${(100 * r.sagged).toFixed(0)}% of ${r.tris} faces would hole at the control`));
}

console.log('\nworst patches by STANDOFF — the lift is the defect: a decal floating off the face');
console.log('  (in head units, with the lift as a multiple of the patch\'s own radius beside it)');
for (const r of patchRows.slice().sort((x, y) => y.lift - x.lift).slice(0, 6)) {
  console.log(...patchLines(r, `lifted ${r.lift.toFixed(4)} off a patch of radius ${r.rad.toFixed(4)} = ${r.stand.toFixed(2)}x its own size, to clear a sag of ${r.sag.toFixed(4)}`));
}

function patchLines(r, what) {
  let where = `at x ${(r.at.x / r.S).toFixed(2)}S y ${(r.at.y / r.S).toFixed(2)}S`;
  if (r.name.startsWith('maw') && r.maw) {
    where = `at u ${((r.at.x - r.maw.mx) / Math.max(r.maw.mw, 1e-6)).toFixed(2)} v ${((r.at.y - r.maw.my) / Math.max(r.maw.mh, 1e-6)).toFixed(2)} of the mouth`;
  }
  return [
    `  seed ${String(r.seed).padStart(7)} ${r.name.padEnd(14)} ${what} ${where}\n` +
    `                  | maw ${r.p.mawShape} lips ${r.p.lips.toFixed(2)} open ${r.p.mouthOpen.toFixed(2)}  eyes ${r.p.eyeStyle} ${r.p.eyeSize.toFixed(2)}  nose ${r.p.noseType}  lumps ${r.p.lumps.toFixed(2)} scale ${r.p.lumpScale.toFixed(2)} wear ${r.p.wear.toFixed(2)}`,
  ];
}

// ---- 2 ---------------------------------------------------------------------
console.log('\n2. A TOOTH OUT THROUGH THE FACE');
console.log('   every tooth vertex, radially past the drawn skull, in head radii R.');
console.log('   REACH  how far the furthest point of the tooth stands outside the skin.');
console.log('   OUT    how much of the tooth is outside it, as a share of its vertices.');
console.log('   AWAY   how far across the face, in 3D, the skin under an excursion is from the');
console.log(`          painted mouth. Past ${BARE.toFixed(2)}R it is not the lip it is standing on, it is cheek.`);
console.log('   END    which end of the rod is the one that is out. A fang over the lip is out by');
console.log('          its POINT; a tooth out by its ROOT has been planted through the face.\n');

const anyOut = creatureRows.filter((r) => r.tooth > 0.15);
const rods = creatureRows.filter((r) => r.toothClear > 0.02);
const roots = creatureRows.filter((r) => r.toothRoot > 0.10);
console.log(`creatures with a tooth 0.15R or more out of the skin   ${share(anyOut.length, creatureRows.length).padStart(4)}   worst per creature ${stat3(creatureRows.map((r) => r.tooth), 2, 'R')}`);
console.log(`creatures with an excursion on bare face (away > ${BARE.toFixed(2)}R)  ${share(rods.length, creatureRows.length).padStart(4)}   reach there        ${stat3(creatureRows.map((r) => r.toothClear), 2, 'R')}`);
console.log(`creatures with a tooth 0.10R out by its ROOT           ${share(roots.length, creatureRows.length).padStart(4)}   reach there        ${stat3(creatureRows.map((r) => r.toothRoot), 2, 'R')}`);
const outTeeth = toothRows.filter((r) => r.reach > 0.02);
console.log(`teeth standing out of the skin at all                  ${share(outTeeth.length, toothRows.length).padStart(4)} of ${toothRows.length}  — teeth are PLANTED on the skin, so this is not the finding`);
console.log(`  how far from the mouth those excursions happen:      ${stat3(outTeeth.map((r) => r.far), 2, 'R')}  — the ${BARE.toFixed(2)}R line sits in this distribution\n`);

const byType = new Map();
for (const r of toothRows) {
  let g = byType.get(r.type);
  if (!g) byType.set(r.type, (g = []));
  g.push(r);
}
console.log('toothType    teeth   reach, head radii        out of the skin        away from the mouth     out by      on bare');
console.log('                     median    p90    max     median    p90    max   median    p90    max    its root     face');
const typed = [...byType.entries()].sort((x, y) => {
  const m = (g) => pct(g.map((r) => r.reach).sort((i, j) => i - j), 0.9);
  return m(y[1]) - m(x[1]);
});
for (const [type, g] of typed) {
  const root = g.filter((r) => r.end === 'root' && r.reach > 0.05);
  const clear = g.filter((r) => r.far > BARE && r.farReach > 0.02);
  console.log(
    `${type.padEnd(10)} ${String(g.length).padStart(6)}   ` +
    `${stat3(g.map((r) => r.reach), 2, 'R')}   ${stat3(g.map((r) => r.out * 100), 0, '%')}   ${stat3(g.map((r) => r.far), 2, 'R')}   ` +
    `${share(root.length, g.length).padStart(6)}      ${share(clear.length, g.length).padStart(5)}`,
  );
}

console.log('\nworst teeth by reach — the rods:');
for (const r of toothRows.slice().sort((x, y) => y.reach - x.reach).slice(0, 8)) {
  console.log(
    `  seed ${String(r.seed).padStart(7)} ${r.type.padEnd(8)} ${r.reach.toFixed(2)}R out by its ${r.end.padEnd(5)} with ${(100 * r.out).toFixed(0)}% of the tooth outside the skin, ` +
    `${r.row.padEnd(6)} row, on the ${r.reg.label} (az ${r.reg.az.toFixed(0)}deg el ${r.reg.el.toFixed(0)}deg), ${r.rim.toFixed(2)}R from the mouth`,
  );
  console.log(
    `                  | maw ${r.p.mawShape} open ${r.p.mouthOpen.toFixed(2)} width ${r.p.mouthWidth.toFixed(2)}  teeth ${r.p.toothType} size ${r.p.toothSize.toFixed(2)} jag ${r.p.toothJag.toFixed(2)} top ${r.p.teethTop} bottom ${r.p.teethBottom}`,
  );
}

console.log('\nworst teeth by AWAY — the excursions that are not on the mouth at all:');
const worstTeeth = toothRows.filter((r) => r.far > BARE).sort((x, y) => y.far - x.far).slice(0, 8);
if (!worstTeeth.length) console.log('  none: every excursion happened within ' + BARE.toFixed(2) + 'R of the painted mouth');
for (const r of worstTeeth) {
  console.log(
    `  seed ${String(r.seed).padStart(7)} ${r.type.padEnd(8)} ${r.far.toFixed(2)}R from the mouth and ${r.farReach.toFixed(2)}R out by its ${r.farEnd.padEnd(5)} ` +
    `${r.row.padEnd(6)} row, on the ${r.farReg.label} (az ${r.farReg.az.toFixed(0)}deg el ${r.farReg.el.toFixed(0)}deg)   [furthest out: ${r.reach.toFixed(2)}R by its ${r.end}]`,
  );
  console.log(
    `                  | maw ${r.p.mawShape} open ${r.p.mouthOpen.toFixed(2)} width ${r.p.mouthWidth.toFixed(2)}  teeth ${r.p.toothType} size ${r.p.toothSize.toFixed(2)} jag ${r.p.toothJag.toFixed(2)} top ${r.p.teethTop} bottom ${r.p.teethBottom}`,
  );
}

// ---- the two seeds the art director reported --------------------------------
console.log('\nthe two reported seeds, measured the same way:');
for (const seed of [7013243, 2690228]) {
  patchRows.length = 0;
  toothRows.length = 0;
  const before = creatureRows.length;
  measure(seed);
  const cr = creatureRows[creatureRows.length - 1];
  const wp = patchRows.slice().sort((x, y) => y.sag - x.sag)[0];
  const wt = toothRows.slice().sort((x, y) => y.reach - x.reach)[0];
  console.log(`  seed ${seed}  maw ${cr.p.mawShape} lips ${cr.p.lips.toFixed(2)} open ${cr.p.mouthOpen.toFixed(2)} teeth ${cr.p.toothType} ${cr.p.toothSize.toFixed(2)} ${cr.p.teethTop}/${cr.p.teethBottom} lumps ${cr.p.lumps.toFixed(2)}`);
  const lip = patchRows.filter((r) => r.name === 'maw lip')[0];
  for (const r of [lip, wp].filter(Boolean).filter((r, i, arr) => arr.indexOf(r) === i)) {
    const u = r.maw ? ` at u ${((r.at.x - r.maw.mx) / Math.max(r.maw.mw, 1e-6)).toFixed(2)} v ${((r.at.y - r.maw.my) / Math.max(r.maw.mh, 1e-6)).toFixed(2)}` : '';
    console.log(`    ${r.name.padEnd(12)} lift ${r.lift.toFixed(4)}, sag ${r.sag.toFixed(4)} = ${r.ratio.toFixed(2)} of its lift${r.name.startsWith('maw') ? u : ''}; at the ${CONTROL} control ${(100 * r.sagged).toFixed(0)}% of its ${r.tris} faces would hole`);
  }
  if (wt) console.log(`    worst tooth: ${wt.type} ${wt.reach.toFixed(2)}R out by its ${wt.end} on the ${wt.reg.label}; furthest from the mouth while outside: ${wt.far.toFixed(2)}R at ${wt.farReach.toFixed(2)}R out by its ${wt.farEnd}`);
  creatureRows.length = before;
}
