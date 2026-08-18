// Checks that every part is actually SITTING ON the thing it grows out of:
//   node tools/seat-sweep.mjs [creatures] [azimuths]
//
// The art director's report was two lines: the skin-coloured eyelid covers the
// whole eyeball, and "big eyes climb out of the head — I don't want that
// breaking other parts or poking out somewhere". The screenshots that came with
// it were three-quarter views: pale lumps standing off the temple silhouette, a
// spike crossing the crown. Every sweep in this directory called those
// creatures clean.
//
// They called them clean because they all measure the frontal plane and nothing
// else. face-sweep imports headHalfWidth, documented in head.js as "the skull's
// FRONTAL outline at height y" — it compares |x| to a half-width and knows
// nothing about z, so an eye pushed forward off a temple is inside the outline
// and outside the head. limb-sweep derives the floor from the legs and then
// only asks about the arms; it never reads rig.torso or rig.headPivot at all.
// float-sweep asks headPivot.children[0] for the skull mesh and gets the head
// GROUP, so its loop skips its only child and visits nothing: its 0% is a count
// of the parts it looked at, not of the parts that were wrong.
//
// The three questions here are the ones none of them can answer:
//
//  1. IS IT SEATED. The skull is star-shaped, so the skin under a vertex v is
//     the surface point along v's own direction and gap = |v| - |skin|. A part
//     with no vertex at or under the skin is not planted on anything — it is
//     beside the head. Asked per PART and never per mesh: a trunk is five
//     spheres in a row of which only the first touches, and an eye on a stalk
//     is held up by its tube, so asking each mesh alone calls half a head
//     debris. Instanced parts (warts, halo shards) are asked per INSTANCE: one
//     wart touching says nothing about the other thirty-nine, and a min over
//     the whole InstancedMesh is how they were being excused.
//
//  2. IS IT INSIDE THE SILHOUETTE, FROM EVERY ANGLE. The skull's outline is
//     solved analytically for a ring of camera azimuths — skin points from
//     headPoint, projected along the view; the widest skin at a height IS the
//     outline at that height, which is the argument headHalfWidth makes on the
//     z = 0 circle, made on every circle instead. Nothing is rasterised and
//     headHalfWidth is deliberately not used. A part is only asked about at
//     heights where there IS skull, so a horn above the crown is not a defect
//     while a lump on the temple is. Reported by camera band, because a nose
//     leaving the outline in a PROFILE view is the shape of a face and an eye
//     leaving it in a three-quarter view is the bug that was reported.
//     Outline shells are included here and nowhere else: the shell is what
//     draws the silhouette, and it is more often the outermost thing on a part
//     than the part is.
//
//  3. DOES IT COME OUT THE OTHER SIDE. On the head: a part with vertices under
//     the skin AND vertices proud of it on the far hemisphere — a tooth curled
//     back through the jaw, a plate planted through the face. On the body:
//     limbs reduced to capsules and spheres (never bounding boxes — a rotated
//     sphere's AABB is far bigger than the sphere, and this project has been
//     burned by exactly that) against the real star-shaped torso surface from
//     bodyPoint, and against each other.
//
// Two things were checked before any of it was believed. The analytic outline
// was run against the skull's own mesh vertices — no vertex of a head is more
// than 0.004 head units outside the outline this tool solves for it — and,
// incidentally, that outline is WIDER than headHalfWidth by a median 0.03 and up
// to 0.83 world units, because headHalfWidth only walks the z = 0 circle and the
// widest skin at a height is often not on it. And SEAT_SWEEP_SELFTEST=1 drives a
// rod through every skull, parks a chip of debris beside it and shoves a bar
// through every torso: all four numbers below light up on them, so a 0% here is
// a fact about the creatures and not about the tool.
//
// Every claimed defect is re-measured against the TESSELLATED skull by raycast
// before it is reported, because the star-shaped solve has a tail (see
// radialSkin) and a tool that reports its own numerical noise as art defects is
// worse than no tool. Every distance is divided by rig.scale, so the same
// defect on a big and a small creature is the same number.

import * as THREE from 'three';

// ---------------------------------------------------------- provenance ----
// A number without a culprit sends a whole round of work at the wrong part.
// Nothing in src/ is named or tagged and this tool may not edit src/, so the
// builder is taken from the stack the first time an object is parented.
// materials.js and warp.js are skipped: withOutline is what calls add, but the
// caller of withOutline is whose part it is.
const SITE = new WeakMap();
const realAdd = THREE.Object3D.prototype.add;
THREE.Object3D.prototype.add = function seatSweepAdd(...kids) {
  let site = null;
  for (const k of kids) {
    if (!k || SITE.has(k)) continue;
    if (!site) {
      const frames = new Error().stack.split('\n').slice(2);
      const f = frames.find((l) => /src[/\\]creature[/\\]/.test(l) && !/materials\.js|warp\.js/.test(l)) || frames[0] || '';
      const m = /at (?:new )?([\w.<>]+) .*[/\\]([\w.-]+\.js):(\d+)/.exec(f);
      site = m ? { fn: m[1], file: m[2], line: Number(m[3]) } : { fn: '?', file: '?', line: 0 };
    }
    SITE.set(k, site);
  }
  return realAdd.apply(this, kids);
};

const { buildCreature } = await import('../src/creature/build.js');
const { randomize } = await import('../src/creature/schema.js');
const { headPoint } = await import('../src/creature/head.js');
const { bodyPoint } = await import('../src/creature/torso.js');

const N = Number(process.argv[2] || 400);
const AZ = Number(process.argv[3] || 24);

// A defect has to be bigger than the measurement is uncertain. Calibrated, not
// guessed: the analytic outline is out by at most 0.004 head units against the
// skull's own mesh vertices (40 creatures x 24 azimuths), and the star-shaped
// skin solve sits within 0.03 of a raycast on the drawn mesh at p90. Anything
// claimed below LOUD is not claimed at all; SOFT is printed beside it so a
// drift upwards is visible before it becomes a screenshot.
const LOUD = 0.06;   // head units — float-sweep's own line, so the two compare
const SOFT = 0.03;
const SELFTEST = process.env.SEAT_SWEEP_SELFTEST === '1';

// ------------------------------------------------------- the skin solve ----
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _dd = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);

/**
 * How far the skin reaches ALONG a ray out of the middle of the body it belongs
 * to. Used for the skull and, one level down, for the torso.
 *
 * headPoint maps a direction to a point, but the point does not lie along the
 * direction it was asked for — the taper, the brow and the lumps all push it
 * sideways. Everything in the repo that wants "the skin under this vertex"
 * writes |headPoint(v.normalize())| and lives with it; measured on the skull's
 * own surface points that one-shot answer is out by up to 0.86 world units on a
 * head two units in radius. So the direction is solved for instead:
 * d <- normalize(d + 0.7*(u - dir(headPoint(d)))), keeping the OUTERMOST radius
 * that really does point along u, because a folded surface crosses one ray more
 * than once and the outer crossing is the one that is skin. A small ring about
 * the answer catches the sheet a degree away.
 *
 * Residual against a raycast on the drawn mesh, 2050 part vertices of 25
 * creatures: median -0.004, p10 -0.055, p90 +0.031, worst +0.17 world units.
 * It leans towards saying a part is closer to the skin than it is, which is the
 * safe direction — and every defect it does claim is re-measured by raycast
 * before being reported.
 */
function radialSkin(surf, u) {
  _d.copy(u);
  let best = 0;
  for (let k = 0; k < 20; k++) {
    surf(_d, _s);
    _sh.copy(_s).normalize();
    const err = 1 - _sh.dot(u);
    if (err < 1e-5) best = Math.max(best, _s.length());
    if (err < 1e-9) break;
    _d.addScaledVector(u, 0.7).addScaledVector(_sh, -0.7).normalize();
  }
  _t1.copy(Math.abs(_d.y) > 0.95 ? SIDE : UP).cross(_d).normalize();
  _t2.copy(_d).cross(_t1).normalize();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    _dd.copy(_d).addScaledVector(_t1, Math.cos(a) * 0.02).addScaledVector(_t2, Math.sin(a) * 0.02).normalize();
    surf(_dd, _s);
    if (1 - _sh.copy(_s).normalize().dot(u) < 1e-5) best = Math.max(best, _s.length());
  }
  if (best === 0) { surf(u, _s); best = _s.length(); }
  return best;
}

/**
 * The same question asked of the mesh that is actually drawn: a ray from well
 * outside, in along the vertex's own direction, first hit wins. Slower than the
 * solve above and free of its assumptions — so it is what every reported number
 * is finally measured with.
 *
 * The answer is turned into a distance FROM THE SKIN rather than along the ray:
 * a radial gap over a steeply oblique bit of skull — a temple, the underside of
 * a jaw — is far longer than the daylight a player would see, and reporting the
 * ray length would inflate every number taken off the side of a head. Projecting
 * it onto the face normal only ever makes a claim smaller.
 */
const _rc = new THREE.Raycaster();
const _o0 = new THREE.Vector3();
const _o1 = new THREE.Vector3();
function meshGap(skull, toHead, v) {
  const u = _o0.copy(v).normalize().clone();
  _o1.copy(u).multiplyScalar(60).applyMatrix4(skull.matrixWorld);
  _o0.copy(u).multiplyScalar(59).applyMatrix4(skull.matrixWorld).sub(_o1).normalize();
  _rc.set(_o1, _o0);
  const hit = _rc.intersectObject(skull, false)[0];
  if (!hit) return null;
  const along = v.length() - hit.point.applyMatrix4(toHead).length();
  const n = hit.face ? Math.abs(hit.face.normal.dot(u)) : 1;
  return along * Math.max(0.15, n);
}

// ------------------------------------------------- what kind of part it is --
function siteOf(obj) {
  for (let o = obj; o; o = o.parent) { const s = SITE.get(o); if (s) return s; }
  return { fn: '?', file: '?', line: 0 };
}

/** the part's kind, in the words the sliders use */
function kindOf(part, p, rig) {
  const s = siteOf(part);
  if (s.file === 'build.js') return 'skull';
  if (s.file === 'hair.js') return `hair:${p.hairType}`;
  if (s.file === 'ears.js') return `ear:${p.earType}`;
  if (s.file === 'aura.js') return `aura:${p.aura}`;
  switch (s.fn) {
    case 'addGrowths':
      if (part === rig.spores) return `aura:${p.aura}`;
      return part.isInstancedMesh ? 'wart' : 'horn';
    case 'addEyes': return `eye:${p.eyeStyle}`;
    case 'addPupil': return `eye:${p.eyeStyle}/pupil`;
    case 'addLid': return `eye:${p.eyeStyle}/lid`;
    case 'addNose': case 'buildNose': return `nose:${p.noseType}`;
    case 'addTeeth': return `tooth:${p.toothType}`;
    case 'addMouth': return 'maw';
    case 'addScars': return 'scar';
    case 'addHand': return `hand:${p.handType}`;
    case 'addSegments': case 'buildArm': return `arm:${p.armType}`;
    case 'buildBody': return part.geometry?.type === 'CapsuleGeometry' ? `leg:${p.legType}` : `foot:${p.footType}`;
    default: return s.fn;
  }
}

// Hair reaches away from the scalp and an aura floats: neither is asked to sit
// on the skin. They are still measured for going THROUGH things, and still
// printed, under their own heading — a number that is by design must not be
// confusable with one that is not.
const reaches = (kind) => kind.startsWith('hair:') || kind.startsWith('aura:');
// An ear's whole job is to stick out sideways and a horn's is to stick up.
const outboard = (kind) => reaches(kind) || kind.startsWith('ear:') || kind === 'horn';
// The face — everything the art director was pointing at.
const isEye = (kind) => kind.startsWith('eye:');

// ------------------------------------------------------------- collecting --
const _m4 = new THREE.Matrix4();
const _im = new THREE.Matrix4();
const _v = new THREE.Vector3();

/** every vertex of a mesh, in the skull's own frame, as a flat array */
function vertsOf(mesh, toHead, instance = -1) {
  const pos = mesh.geometry.attributes.position;
  _m4.multiplyMatrices(toHead, mesh.matrixWorld);
  if (instance >= 0) { mesh.getMatrixAt(instance, _im); _m4.multiply(_im); }
  // A decal is 168 vertices and a warped cone 200. The stride is even rather
  // than clever: both questions turn on the extremes, and there is no cheap way
  // to know which vertex is extreme before transforming it.
  const step = Math.max(1, Math.floor(pos.count / 200));
  const out = [];
  for (let i = 0; i < pos.count; i += step) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(_m4);
    out.push(_v.x, _v.y, _v.z);
  }
  return out;
}

/**
 * The head's parts, each as { kind, skin[], ink[] } in the skull's frame.
 *
 * A PART is one seated unit. That is a child of the head group — except the
 * jaw, which is a container for teeth that are each planted on their own bit of
 * rim, and except an instanced cloud, whose instances are each planted
 * separately. A compound eye's facets are instanced too but placed in the eye's
 * own frame, so they stay part of the eye: the rule is that instances split into
 * parts only when there is nothing else in the part holding them up.
 */
function headParts(c, p) {
  const headGroup = c.rig.headPivot.children[0];
  const toHead = new THREE.Matrix4().copy(headGroup.matrixWorld).invert();
  const parts = [];

  const take = (root) => {
    const kind = kindOf(root, p, c.rig);
    if (kind === 'skull') return;
    if (root.isInstancedMesh) {
      for (let i = 0; i < root.count; i++) parts.push({ kind, skin: vertsOf(root, toHead, i), ink: [] });
      return;
    }
    const solid = [];
    const inst = [];
    root.traverse((o) => { if (o.isMesh) (o.isInstancedMesh ? inst : solid).push(o); });
    const carried = solid.some((o) => o.material?.side !== THREE.BackSide);
    const part = { kind, skin: [], ink: [] };
    for (const o of solid) {
      const v = vertsOf(o, toHead);
      if (o.material?.side === THREE.BackSide) part.ink.push(...v); else part.skin.push(...v);
    }
    for (const o of inst) {
      for (let i = 0; i < o.count; i++) {
        const v = vertsOf(o, toHead, i);
        if (carried) part.skin.push(...v);
        else parts.push({ kind, skin: v, ink: [] });
      }
    }
    if (part.skin.length || part.ink.length) parts.push(part);
  };

  for (const child of headGroup.children) {
    if (child === c.rig.jaw) for (const g of child.children) take(g);
    else take(child);
  }

  // A tool that reports 0% has to be able to report anything else.
  // SEAT_SWEEP_SELFTEST=1 drives a rod through every skull, temple to temple,
  // plus a chip of debris parked beside the head: the pierce number and the
  // unseated number must both light up on them. Run it after any change here.
  if (SELFTEST) {
    const R = 1.4 * (Math.abs(p.headWidth) + Math.abs(p.headHeight));
    const rod = [];
    for (let k = 0; k <= 40; k++) rod.push(-R + (2 * R * k) / 40, 0.05, 0.02);
    parts.push({ kind: 'selftest:rod', skin: rod, ink: [] });
    parts.push({ kind: 'selftest:chip', skin: [R * 0.9, R * 0.5, 0, R * 0.95, R * 0.5, 0, R * 0.9, R * 0.55, 0], ink: [] });
  }
  return parts;
}

// --------------------------------------------------- the skull's outline ----
/**
 * The skull's outline for a ring of camera azimuths, solved from headPoint.
 *
 * A view azimuth th looks along (sin th, 0, cos th); the screen's across axis is
 * (cos th, 0, -sin th) and up is y, so a point projects to a = x·cos th - z·sin th
 * at height y.
 *
 * Two envelopes, because one of them lies. Sideways at a height is the natural
 * reading of "the skull is narrower here than the part reaches" and it is right
 * down the middle of the head — but where the outline runs nearly horizontal, at
 * the chin and over the crown, it explodes: a wart on the jaw of seed 3204 sits
 * on the skin, 0.09 units proud of it, and reads as 0.96 units past the outline
 * because the head at the wart's LOWEST vertex is a chin's width across. So the
 * same skin is also binned by angle about the middle of the projection, and a
 * part is only as far out as the SMALLER of the two says. Both are upper bounds
 * on the real distance out of the silhouette; the smaller is the honest one.
 *
 * Heights and angles are binned and a query takes the widest of its bin and the
 * two beside it, so nothing is called out for one bin's worth of taper. Checked
 * against the skull's own mesh vertices over 40 creatures and 24 azimuths: no
 * vertex of a head is more than 0.004 head units outside what this returns.
 */
const BINS = 64;
const PBINS = 96;
const NA = 160;
const NP = 112;
function outlines(p, azimuths) {
  const s = new THREE.Vector3();
  const pts = [];
  for (let j = 0; j <= NP; j++) {
    const phi = (j / NP) * Math.PI;
    const sy = Math.cos(phi);
    const sr = Math.sin(phi);
    for (let i = 0; i < NA; i++) {
      const th = (i / NA) * Math.PI * 2;
      headPoint(p, s.set(sr * Math.cos(th), sy, sr * Math.sin(th)), s);
      pts.push(s.x, s.y, s.z);
      if (j === 0 || j === NP) break;   // the poles are one point, not NA of them
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 1; i < pts.length; i += 3) { if (pts[i] < lo) lo = pts[i]; if (pts[i] > hi) hi = pts[i]; }
  const span = Math.max(1e-6, hi - lo);

  const views = azimuths.map((th) => {
    const ca = Math.cos(th);
    const sa = Math.sin(th);
    const right = new Float64Array(BINS).fill(-Infinity);
    const left = new Float64Array(BINS).fill(Infinity);
    let amin = Infinity;
    let amax = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const a = pts[i] * ca - pts[i + 2] * sa;
      const b = Math.min(BINS - 1, Math.max(0, Math.floor(((pts[i + 1] - lo) / span) * BINS)));
      if (a > right[b]) right[b] = a;
      if (a < left[b]) left[b] = a;
      if (a < amin) amin = a;
      if (a > amax) amax = a;
    }
    // the same skin, binned by angle about the middle of the projection
    const cx = (amin + amax) / 2;
    const cy = (lo + hi) / 2;
    const rad = new Float64Array(PBINS).fill(0);
    for (let i = 0; i < pts.length; i += 3) {
      const dx = pts[i] * ca - pts[i + 2] * sa - cx;
      const dy = pts[i + 1] - cy;
      const b = Math.min(PBINS - 1, Math.max(0, Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * PBINS)));
      const r = Math.hypot(dx, dy);
      if (r > rad[b]) rad[b] = r;
    }
    return { th, right, left, rad, cx, cy };
  });
  return { views, lo, hi, span };
}

/** how far past the outline a projected point sits, 0 if it is inside */
function past(view, o, a, y) {
  if (y < o.lo || y > o.hi) return 0;   // above the crown or below the chin: no skull there to be outside of
  const b = Math.min(BINS - 1, Math.max(0, Math.floor(((y - o.lo) / o.span) * BINS)));
  let r = -Infinity;
  let l = Infinity;
  for (let k = Math.max(0, b - 1); k <= Math.min(BINS - 1, b + 1); k++) {
    if (view.right[k] > r) r = view.right[k];
    if (view.left[k] < l) l = view.left[k];
  }
  if (!Number.isFinite(r)) return 0;
  const across = Math.max(0, a - r, l - a);
  if (across <= 0) return 0;

  const dx = a - view.cx;
  const dy = y - view.cy;
  const pb = Math.min(PBINS - 1, Math.max(0, Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * PBINS)));
  let rr = 0;
  for (let k = pb - 1; k <= pb + 1; k++) {
    const kk = (k + PBINS) % PBINS;
    if (view.rad[kk] > rr) rr = view.rad[kk];
  }
  return Math.min(across, Math.max(0, Math.hypot(dx, dy) - rr));
}

// The camera bands. The creature is looked at from the front and turns; the
// screenshots that started this were the second band.
const BANDS = [
  ['head-on', 0, 15],
  ['three-quarter', 15, 65],
  ['profile', 65, 115],
  ['from behind', 115, 181],
];
const bandOf = (deg) => {
  const d = Math.min(deg, 360 - deg);
  return BANDS.findIndex(([, lo, hi]) => d >= lo && d < hi);
};

// ------------------------------------------------------ limbs as capsules ---
/**
 * Every limb reduced to capsules and spheres — limb-sweep's reduction, kept
 * because a rotated sphere's bounding box is far larger than the sphere.
 */
function capsules(root, inv, p, rig, out = []) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    const g = o.geometry;
    const par = g.parameters || {};
    const sc = new THREE.Vector3();
    o.getWorldScale(sc);
    const k = Math.max(Math.abs(sc.x), Math.abs(sc.y), Math.abs(sc.z));
    const kind = kindOf(o, p, rig);
    const put = (a, b, r) => out.push({ a: a.applyMatrix4(inv), b: b.applyMatrix4(inv), r, kind });
    if (g.type === 'SphereGeometry') {
      // A squashed sphere is an ellipsoid; the tight enclosure is a capsule down
      // its long axis with the radius of the other two.
      const r0 = par.radius ?? 0;
      const semi = [Math.abs(sc.x) * r0, Math.abs(sc.y) * r0, Math.abs(sc.z) * r0];
      const long = semi.indexOf(Math.max(...semi));
      const rad = Math.max(...semi.filter((_, i) => i !== long));
      const axis = new THREE.Vector3(long === 0 ? 1 : 0, long === 1 ? 1 : 0, long === 2 ? 1 : 0);
      const half = Math.max(0, semi[long] - rad);
      const c = new THREE.Vector3();
      o.getWorldPosition(c);
      const q = new THREE.Quaternion();
      o.getWorldQuaternion(q);
      axis.applyQuaternion(q).multiplyScalar(half);
      put(c.clone().add(axis), c.clone().sub(axis), rad);
    } else if (['CapsuleGeometry', 'CylinderGeometry', 'ConeGeometry'].includes(g.type)) {
      const h = (par.height ?? par.length ?? 0) / 2;
      const r = Math.max(par.radius ?? 0, par.radiusTop ?? 0, par.radiusBottom ?? 0) * k;
      put(new THREE.Vector3(0, -h, 0).applyMatrix4(o.matrixWorld), new THREE.Vector3(0, h, 0).applyMatrix4(o.matrixWorld), r);
    } else if (g.type === 'TubeGeometry') {
      // A curved tube's AABB is the size of the room; rebuild the real segments.
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

/** distance between two segments (limb-sweep's, unchanged) */
function segDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;
  if (a < 1e-9 && e < 1e-9) return r.length();
  if (a < 1e-9) { t = Math.min(1, Math.max(0, f / e)); } else {
    const c = d1.dot(r);
    if (e < 1e-9) { s = Math.min(1, Math.max(0, -c / a)); } else {
      const b = d1.dot(d2);
      const den = a * e - b * b;
      s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  return d1.multiplyScalar(s).add(p1).sub(d2.multiplyScalar(t).add(p2)).length();
}

// -------------------------------------------------------------- the sweep --
const azimuths = [];
for (let i = 0; i < AZ; i++) azimuths.push((i / AZ) * Math.PI * 2);

const rows = [];
const airByKind = new Map();
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  const seed = i * 11 + 3;
  const p = randomize(seed);
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);
  const S = c.rig.scale;
  const headGroup = c.rig.headPivot.children[0];
  const skull = headGroup.children[0];
  const toHead = new THREE.Matrix4().copy(headGroup.matrixWorld).invert();
  const surf = (d, out) => headPoint(p, d, out);
  const o = outlines(p, azimuths);
  const parts = headParts(c, p);

  const row = {
    seed,
    p,
    float: 0,
    floatKind: '',
    pierce: 0,
    pierceKind: '',
    through: 0,
    throughKind: '',
    hand: 0,
    handKind: '',
    limb: 0,
    limbKind: '',
  };
  for (let b = 0; b < BANDS.length; b++) {
    row[`out${b}`] = 0; row[`outKind${b}`] = ''; row[`outAz${b}`] = 0; row[`eye${b}`] = 0;
  }

  for (const part of parts) {
    const v = part.skin;

    // ---- 1. is it seated -------------------------------------------------
    let air = 0;
    let seen = 0;
    let deep = -Infinity;
    const gaps = [];
    for (let k = 0; k < v.length; k += 3) {
      _v.set(v[k], v[k + 1], v[k + 2]);
      if (_v.lengthSq() < 1e-9) { gaps.push(-Infinity); continue; }
      const gap = _v.length() - radialSkin(surf, _v.clone().normalize());
      gaps.push(gap);
      seen++;
      if (gap > 0) air++;
      if (-gap > deep) deep = -gap;
    }
    if (!seen) continue;

    if (!reaches(part.kind)) {
      const tally = airByKind.get(part.kind) || [];
      tally.push(air / seen);
      airByKind.set(part.kind, tally);

      // The candidate is the analytic minimum; it under-reports (see
      // radialSkin), so anything not clearly buried is put to the raycast, and
      // the raycast's answer is the one that is reported.
      const order = gaps.map((g, k) => [g, k]).filter(([g]) => Number.isFinite(g)).sort((a, b) => a[0] - b[0]);
      if (order.length && order[0][0] > -0.05 * S) {
        let lift = Infinity;
        for (const [, k] of order.slice(0, 12)) {
          const g = meshGap(skull, toHead, _v.set(v[k * 3], v[k * 3 + 1], v[k * 3 + 2]));
          if (g !== null && g < lift) lift = g;
        }
        if (lift / S > row.float) { row.float = lift / S; row.floatKind = part.kind; }
      }
    }

    // ---- 3a. in one side of the skull and out the other -------------------
    // A part that goes THROUGH the skull surfaces twice: it stands proud of the
    // skin somewhere, it is buried in between, and it stands proud again
    // somewhere else. So: the most protruding vertex is one emergence; a second
    // emergence is any other proud vertex far enough round the skull from it —
    // with two conditions that keep a decal wrapped round a cheek out of it,
    // since a scar's two ends are also proud and also far apart. The chord
    // between the two emergences has to run INSIDE the skull, and the part has
    // to have geometry of its own down there. A scar has neither: the skin
    // between its ends is under it, not through it.
    if (deep > SOFT * S) {
      const proud = [];
      for (let k = 0; k < gaps.length; k++) if (gaps[k] > SOFT * S) proud.push(k);
      if (proud.length > 1) {
        let a1 = proud[0];
        for (const k of proud) if (gaps[k] > gaps[a1]) a1 = k;
        const d1 = new THREE.Vector3(v[a1 * 3], v[a1 * 3 + 1], v[a1 * 3 + 2]);
        const u1 = d1.clone().normalize();
        let a2 = -1;
        for (const k of proud) {
          const u2 = _v.set(v[k * 3], v[k * 3 + 1], v[k * 3 + 2]).normalize();
          if (u2.dot(u1) > 0.64) continue;                       // under 50 degrees round: same emergence
          if (a2 < 0 || gaps[k] > gaps[a2]) a2 = k;
        }
        if (a2 >= 0) {
          const d2 = new THREE.Vector3(v[a2 * 3], v[a2 * 3 + 1], v[a2 * 3 + 2]);
          // Is there skull between the two emergences? Walk the chord and find
          // the deepest point of it that is under the skin.
          const step = new THREE.Vector3();
          const buriedAt = new THREE.Vector3();
          let under = 0;
          let deepest = 0;
          for (let t = 1; t < 16; t++) {
            step.lerpVectors(d1, d2, t / 16);
            const g = step.length() - radialSkin(surf, _v.copy(step).normalize());
            if (g < -0.01 * S) under++;
            if (-g > deepest) { deepest = -g; buriedAt.copy(step); }
          }
          // ...and is the PART down there, or only the chord? A scar wrapped
          // round a cheek has both ends proud and a chord that cuts through the
          // skull, and it is not through anything: the skin between its ends is
          // under it, not pierced by it.
          const near = d1.distanceTo(d2) * 0.3;
          let own = false;
          for (let k = 0; k < gaps.length && !own; k++) {
            if (!(gaps[k] < -0.01 * S)) continue;
            own = _v.set(v[k * 3], v[k * 3 + 1], v[k * 3 + 2]).distanceTo(buriedAt) < near;
          }
          if (under >= 3 && own) {
            const g = meshGap(skull, toHead, d2);
            if (g !== null && g / S > row.pierce) { row.pierce = g / S; row.pierceKind = part.kind; }
          }
        }
      }
    }

    // ---- 2. does it leave the outline, and from where ---------------------
    for (const [arr, ink] of [[part.skin, false], [part.ink, true]]) {
      for (const view of o.views) {
        const ca = Math.cos(view.th);
        const sa = Math.sin(view.th);
        let worst = 0;
        for (let k = 0; k < arr.length; k += 3) {
          const q = past(view, o, arr[k] * ca - arr[k + 2] * sa, arr[k + 1]);
          if (q > worst) worst = q;
        }
        worst /= S;
        if (worst <= 0) continue;
        const b = bandOf(Math.round((view.th * 180) / Math.PI));
        if (outboard(part.kind)) {
          if (worst > (row.reach || 0)) { row.reach = worst; row.reachKind = part.kind + (ink ? ' (ink)' : ''); }
          continue;
        }
        if (worst > row[`out${b}`]) {
          row[`out${b}`] = worst;
          row[`outKind${b}`] = part.kind + (ink ? ' (ink)' : '');
          row[`outAz${b}`] = Math.round((view.th * 180) / Math.PI);
        }
        if (isEye(part.kind) && worst > row[`eye${b}`]) row[`eye${b}`] = worst;
      }
    }
  }
  row.reach = row.reach || 0;
  row.reachKind = row.reachKind || '';

  // ---- 3b / 3c. the body -------------------------------------------------
  // The torso is the skull's construction one level down, so it gets the same
  // treatment: an analytic star-shaped surface, not a box and not a capsule.
  // makeTorsoGeometry normalises its two horizontal axes against the icosahedron
  // it is built from, so the same vertex set gives back the same divisor.
  const torso = c.rig.torso;
  const ico = new THREE.IcosahedronGeometry(1, 3).attributes.position;
  let mx = 1e-6;
  let mz = 1e-6;
  const bd = new THREE.Vector3();
  const bo = new THREE.Vector3();
  for (let k = 0; k < ico.count; k++) {
    bd.fromBufferAttribute(ico, k).normalize();
    bodyPoint(p, bd, bo);
    mx = Math.max(mx, Math.abs(bo.x));
    mz = Math.max(mz, Math.abs(bo.z));
  }
  const torsoSurf = (d, out) => { bodyPoint(p, d, out); out.x /= mx; out.z /= mz; return out; };

  const rootInv = new THREE.Matrix4().copy(c.rig.root.matrixWorld).invert();
  const toTorso = new THREE.Matrix4().copy(torso.matrixWorld).invert().multiply(c.rig.root.matrixWorld);
  const limbs = [];
  for (const sh of c.rig.shoulders) limbs.push({ side: sh.userData.side || Math.sign(sh.position.x) || 1, caps: capsules(sh, rootInv, p, c.rig) });
  for (const lg of c.rig.legs) limbs.push({ side: Math.sign(lg.position.x) || 1, caps: capsules(lg, rootInv, p, c.rig) });
  if (SELFTEST) {
    // the body half of the self-test: a bar shoved through the trunk, side to
    // side, which the through-the-far-side number must see
    const w = torso.scale.x * 2.5;
    const y = torso.position.y;
    limbs.push({
      side: 1,
      caps: [{ a: new THREE.Vector3(-w, y, 0), b: new THREE.Vector3(w, y, 0), r: torso.scale.x * 0.05, kind: 'selftest:bar' }],
    });
  }

  // The torso's scale is not uniform, so a length in its local frame is not a
  // length on the creature. Every distance below is taken between two points
  // carried back into the root's frame, never scaled by one axis and hoped for.
  const fromTorso = new THREE.Matrix4().copy(toTorso).invert();
  const q3 = new THREE.Vector3();
  const ql = new THREE.Vector3();
  const skinPt = new THREE.Vector3();
  const centre = new THREE.Vector3(0, 0, 0).applyMatrix4(fromTorso);
  for (const limb of limbs) {
    for (const cap of limb.caps) {
      // Sampled first and judged afterwards. Judging as it walks makes the
      // answer depend on which end of the capsule three.js happened to build
      // first — the self-test bar goes in the far side and out the near one,
      // and a one-pass loop misses exactly that.
      const walk = [];
      for (let t = 0; t <= 12; t++) {
        q3.lerpVectors(cap.a, cap.b, t / 12);
        ql.copy(q3).applyMatrix4(toTorso);
        if (ql.lengthSq() < 1e-9) { walk.push({ frac: 1, out: false, x: 0, by: 0 }); continue; }
        const r = radialSkin(torsoSurf, _v.copy(ql).normalize());
        skinPt.copy(ql).setLength(r).applyMatrix4(fromTorso);
        const out = ql.length() > r;                       // is the axis outside the trunk
        // the capsule's own surface, not its axis, and in root units
        const past0 = (out ? -1 : 1) * q3.distanceTo(skinPt) + cap.r;
        const toCentre = skinPt.distanceTo(centre);
        walk.push({
          frac: past0 / Math.max(toCentre, 1e-6),          // 1 = the middle of the body
          out,
          x: ql.x,
          by: (q3.distanceTo(skinPt) - cap.r) / c.rig.scale,
        });
      }
      const inside = walk.some((w) => w.frac > 0.25);
      for (const w of walk) {
        if (inside && w.out && Math.sign(w.x) === -limb.side && w.by > row.through) {
          row.through = w.by;
          row.throughKind = cap.kind;
        }
        if (cap.kind.startsWith('hand:') && w.frac > row.hand) { row.hand = w.frac; row.handKind = cap.kind; }
      }
    }
  }
  // the two arms, the two legs, and the arm against the leg beside it —
  // limb-sweep excludes that last pair on purpose, and it is the pair
  // body.js:207 claims to have made impossible
  for (let a = 0; a < limbs.length; a++) {
    for (let b = a + 1; b < limbs.length; b++) {
      for (const x of limbs[a].caps) {
        for (const y of limbs[b].caps) {
          const over = (x.r + y.r - segDist(x.a, x.b, y.a, y.b)) / c.rig.scale;
          if (over > row.limb) { row.limb = over; row.limbKind = `${x.kind} in ${y.kind}`; }
        }
      }
    }
  }

  rows.push(row);
  c.dispose();
  if ((i + 1) % 25 === 0) process.stderr.write(`  ${i + 1}/${N}\r`);
}

// ------------------------------------------------------------- reporting --
const share = (key, over) => (100 * rows.filter((r) => r[key] > over).length / rows.length).toFixed(0);
const stat = (key, dp = 3) => {
  const v = rows.map((r) => r[key]).sort((a, b) => a - b);
  const q = (f) => v[Math.floor(f * (v.length - 1))].toFixed(dp);
  return `median ${q(0.5)}  p90 ${q(0.9)}  max ${q(1)}`;
};
const blame = (key, kind, over) => {
  const tally = new Map();
  for (const r of rows) if (r[key] > over) tally.set(r[kind], (tally.get(r[kind]) || 0) + 1);
  const t = [...tally].sort((a, b) => b[1] - a[1]);
  return t.length ? t.slice(0, 6).map(([k, n]) => `${k} ${n}`).join(',  ') : '(nothing)';
};
const worstOf = (key, n = 4) => rows.slice().sort((a, b) => b[key] - a[key]).slice(0, n);
const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

console.log(`${N} random creatures x ${AZ} camera azimuths   (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
console.log('re-run with SEAT_SWEEP_SELFTEST=1 to see all four numbers fire on planted defects');
console.log(`defects below ${LOUD} head units are not claimed: the outline solve is good to 0.004 and the skin solve to 0.03\n`);

console.log('1. SEATED ON THE HEAD — is there any skull under the part at all');
console.log(`   parts with nothing under them   ${share('float', LOUD).padStart(3)}%   clearance off the skin, head units: ${stat('float')}`);
console.log(`   ...and at ${SOFT} or more         ${share('float', SOFT).padStart(3)}%`);
console.log(`   blame: ${blame('float', 'floatKind', LOUD)}`);
for (const r of worstOf('float')) {
  console.log(`     seed ${String(r.seed).padStart(5)}  ${r.float.toFixed(3)}  ${r.floatKind.padEnd(20)}`,
    `eyes ${r.p.eyeStyle}/${r.p.eyeLayout} size ${r.p.eyeSize.toFixed(2)} bulge ${r.p.eyeBulge.toFixed(2)} pupil ${r.p.pupilSize.toFixed(2)}`,
    `| warts ${r.p.warts}@${r.p.wartSize.toFixed(3)} | ears ${r.p.earType}@${r.p.earSize.toFixed(2)}`);
}
{
  const rank = [...airByKind].map(([k, v]) => [k, med(v), v.length]).filter(([, , n]) => n >= 20)
    .sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('   how much of a part hangs over open air (median share of its own surface, kinds seen 20+ times).');
  console.log('   A tooth stands in a mouth and a scar is a decal a hair above the skin, so most of both is air by design:');
  console.log(`     ${rank.map(([k, m]) => `${k} ${m.toFixed(2)}`).join('  ')}`);
}

console.log('\n2. INSIDE THE SILHOUETTE — from every camera angle, not just head-on');
console.log('   face parts (eyes, nose, teeth, maw, warts, scars) past the skull\'s own outline:');
for (let b = 0; b < BANDS.length; b++) {
  const [name, lo, hi] = BANDS[b];
  console.log(`     ${`${name} (${lo}-${hi}deg)`.padEnd(26)} ${share(`out${b}`, LOUD).padStart(3)}%   overshoot in head units: ${stat(`out${b}`)}`);
}
console.log(`   eyes alone, which is what was reported:   head-on ${share('eye0', LOUD).padStart(3)}%   three-quarter ${share('eye1', LOUD).padStart(3)}%   profile ${share('eye2', LOUD).padStart(3)}%`);
console.log(`   blame (three-quarter): ${blame('out1', 'outKind1', LOUD)}`);
console.log(`   blame (profile):       ${blame('out2', 'outKind2', LOUD)}`);
for (const r of worstOf('out1', 6)) {
  console.log(`     seed ${String(r.seed).padStart(5)}  ${r.out1.toFixed(3)} at ${String(r.outAz1).padStart(3)}deg (head-on ${r.out0.toFixed(3)})  ${r.outKind1.padEnd(22)}`,
    `eyes ${r.p.eyeStyle}@${r.p.eyeSize.toFixed(2)} bulge ${r.p.eyeBulge.toFixed(2)} | nose ${r.p.noseType}@${r.p.noseSize.toFixed(2)} | teeth ${r.p.toothType}@${r.p.toothSize.toFixed(2)}`);
}
console.log(`   for scale, the parts whose job is to leave the outline (ears, horns, hair, aura): ${stat('reach')}`);
console.log(`     ${blame('reach', 'reachKind', 0.4)}`);

console.log('\n3. THROUGH ANOTHER PART');
console.log(`   head: in one side of the skull and out the other  ${share('pierce', LOUD).padStart(3)}%   past the far skin: ${stat('pierce')}`);
console.log(`   blame: ${blame('pierce', 'pierceKind', LOUD)}`);
for (const r of worstOf('pierce', 4)) {
  console.log(`     seed ${String(r.seed).padStart(5)}  ${r.pierce.toFixed(3)}  ${r.pierceKind.padEnd(20)}`,
    `teeth ${r.p.toothType}@${r.p.toothSize.toFixed(2)} open ${r.p.mouthOpen.toFixed(2)} | hair ${r.p.hairType}@${r.p.tendrilLen.toFixed(2)} | nose ${r.p.noseType} | horns ${r.p.horns}@${r.p.hornLen.toFixed(2)}`);
}
console.log(`   body: a limb through the trunk and out the far side  ${share('through', SOFT).padStart(3)}%   past the far skin: ${stat('through')}`);
if (rows.some((r) => r.through > SOFT)) console.log(`   blame: ${blame('through', 'throughKind', SOFT)}`);
console.log(`   body: a hand inside the trunk    ${share('hand', 0.2).padStart(3)}%   depth from skin to centre (1 = the middle): ${stat('hand', 2)}`);
console.log(`   blame: ${blame('hand', 'handKind', 0.2)}`);
for (const r of worstOf('hand', 3)) {
  console.log(`     seed ${String(r.seed).padStart(5)}  ${r.hand.toFixed(2)}  ${r.handKind.padEnd(14)}`,
    `arms ${r.p.armType} len ${r.p.armLen.toFixed(2)} | body ${r.p.bodyWidth.toFixed(2)} hips ${r.p.hipWide.toFixed(2)} stance ${r.p.stance.toFixed(2)}`);
}
console.log(`   body: limb inside limb, at rest  ${share('limb', SOFT).padStart(3)}%   overlap in head units: ${stat('limb')}`);
console.log(`   blame: ${blame('limb', 'limbKind', SOFT)}`);
for (const r of worstOf('limb', 3)) {
  console.log(`     seed ${String(r.seed).padStart(5)}  ${r.limb.toFixed(3)}  ${r.limbKind.padEnd(34)}`,
    `arms ${r.p.armType} legs ${r.p.legType}/${r.p.footType} stance ${r.p.stance.toFixed(2)} thick ${r.p.limbThick.toFixed(2)}`);
}
