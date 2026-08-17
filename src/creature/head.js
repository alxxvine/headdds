import * as THREE from 'three';
import { fbm3, noise3 } from '../lib/noise.js';

// The skull is a star-shaped surface: every unit direction d maps to exactly
// one point of skin. Two things follow from that:
//  - the geometry is an icosahedron with every vertex run through headPoint();
//  - anything placed by direction (horns, warts, spores) is solved
//    analytically, with no raycasts at all.
// The face looks towards +Z.

export const HEAD_DETAIL = 4; // 5120 triangles — enough for the silhouette and cheap to raycast

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const bell = (dy, c, w) => {
  const q = (dy - c) / w;
  return Math.exp(-(q * q));
};

/**
 * How wide the skull is at height dy, before normalisation: the taper, the jaw
 * and the three bands, all of which multiply. The jaw's own dependence on dz is
 * taken at its strongest so the peak below is an upper bound whichever way the
 * head is facing.
 */
const flareAt = (p, dy) => Math.max(0.2, clamp(1 + p.taper * dy, 0.18, 2)
  * (dy < 0 ? 1 + p.jaw * (-dy) : 1)
  * Math.max(0.2, 1
    + p.browWide * bell(dy, 0.62, 0.42)
    + p.midWide * bell(dy, 0.05, 0.38)
    + p.chinWide * bell(dy, -0.6, 0.42)));

// How thin the skull is allowed to get, as a fraction of its own widest point.
// Below this it stops being a head with a shape and becomes a blade with a jaw
// on the end: the crown of the worst rolls came out a tenth of the width of the
// chin, which is a wedge, not a face.
const FLARE_FLOOR = 0.46;

/**
 * The profile solved once per head: how far to pull it back towards its widest
 * point, and how much the whole thing then has to be divided by so the skull
 * really is `headWidth` across. One entry of memo is enough — every vertex of
 * one head shares its parameters, and heads are built one at a time.
 */
let flareKey = null;
let flareMemo = { k: 1, rawMax: 1, peak: 1 };
function flareOf(p) {
  const key = `${p.taper},${p.jaw},${p.browWide},${p.midWide},${p.chinWide}`;
  if (key === flareKey) return flareMemo;

  const N = 48;
  const raw = new Array(N + 1);
  let rawMax = 1e-6;
  for (let i = 0; i <= N; i++) {
    raw[i] = flareAt(p, -1 + (i / N) * 2);
    rawMax = Math.max(rawMax, raw[i]);
  }

  // The narrowest latitude of the skull proper. The poles are left out: a
  // sphere comes to a point there whatever the profile is doing, so counting
  // them would say every head is a wedge.
  let lo = 1;
  for (let i = 0; i <= N; i++) {
    if (Math.abs(-1 + (i / N) * 2) > 0.85) continue;
    lo = Math.min(lo, raw[i] / rawMax);
  }

  // An exponent below one pulls the whole profile towards its widest point
  // without changing the ORDER of the widths — a broad brow over narrow
  // temples over a wide jaw is still exactly that, just no longer extreme
  // enough to read as damage. Clamping the widths one by one would flatten the
  // narrow parts into a straight edge instead, which is a worse silhouette
  // than the one being fixed.
  const k = lo < FLARE_FLOOR ? Math.log(FLARE_FLOOR) / Math.log(Math.max(lo, 1e-4)) : 1;

  let peak = 1e-6;
  for (let i = 0; i <= N; i++) {
    const dy = -1 + (i / N) * 2;
    peak = Math.max(peak, (k === 1 ? raw[i] / rawMax : Math.pow(raw[i] / rawMax, k))
      * Math.sqrt(Math.max(0, 1 - dy * dy)));
  }

  flareKey = key;
  flareMemo = { k, rawMax, peak: Math.max(0.35, peak) };
  return flareMemo;
}

/**
 * The horizontal multiplier at height dy, compressed and normalised. It is 1 at
 * the skull's widest latitude and never lets `flare * sqrt(1 - dy²)` exceed 1,
 * so the head really is `headWidth` across and no wider.
 */
function flareNorm(p, dy) {
  const f = flareOf(p);
  const g = flareAt(p, dy) / f.rawMax;
  return (f.k === 1 ? g : Math.pow(g, f.k)) / f.peak;
}

/**
 * The point of skin along direction d (a unit vector), written into out.
 */
export function headPoint(p, d, out = new THREE.Vector3()) {
  const dx = d.x, dy = d.y, dz = d.z;

  // 1. sphere <-> cube
  const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) || 1;
  const k = p.boxiness;
  let x = dx * (1 - k) + (dx / m) * k;
  let y = dy * (1 - k) + (dy / m) * k;
  let z = dz * (1 - k) + (dz / m) * k;

  // 2. Everything that sets how wide the skull is at a given height: the taper,
  // the swollen jaw, and three bands that widen or pinch it at brow, temple and
  // jaw. A head that is only ever one shape reads as a solid; a broad brow over
  // narrow temples over a wide jaw reads as a face.
  //
  // They are divided by their own peak, so together they REDISTRIBUTE width
  // rather than add it. Left to accumulate they multiply: a full taper times a
  // full jaw times three bands takes the bottom of the skull past three times
  // the top, while headHeight stays where the slider put it, and the head
  // renders as a plate. Which is what headWidth is for.
  //
  // And redistributing is not enough on its own — a profile can be normalised
  // and still run from a tenth of its widest point to all of it. It is pulled
  // back towards its own widest point too, so the skull keeps a shape instead
  // of narrowing to an edge.
  const flare = flareNorm(p, dy);
  x *= flare;
  z *= (0.25 + flare * 0.75) * (dy < 0 ? 0.9 : 1);

  // 3. lumps and fine speckle — a radial displacement
  const s = p.lumpScale;
  const lump = fbm3(dx * s + 11.3, dy * s + 4.1, dz * s + 7.7, 0, 3) - 0.5;
  const fine = noise3(dx * 13.7 + 2.5, dy * 13.7, dz * 13.7 + 5.5, 991) - 0.5;
  const r = 1 + lump * p.lumps * 2.2 + fine * p.speckle * 0.09;
  x *= r; y *= r; z *= r;

  // 4. brow ridge: a gaussian band across the front hemisphere
  if (dz > 0 && p.brow > 0) {
    const browY = p.eyeY + 0.3 - p.browDroop * 0.28;
    const q = (dy - browY) * 2.8;
    const band = Math.exp(-(q * q));
    z += p.brow * 0.24 * band * dz * dz;
    y -= p.brow * p.browDroop * 0.06 * band * dz;
  }

  // 5. profile lean: forehead forward (+) or jaw forward (-)
  z *= 1 + p.profile * dy;

  out.set(x * p.headWidth, y * p.headHeight, z * p.headDepth);
  return out;
}

const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);

/**
 * Skin point + normal along a direction. The normal comes from finite
 * differences, because fbm noise has no analytic derivative.
 */
export function headSurfaceByDir(p, dir, out = { point: new THREE.Vector3(), normal: new THREE.Vector3() }) {
  const d = dir.clone().normalize();
  _t1.copy(Math.abs(d.y) > 0.95 ? SIDE : UP).cross(d).normalize();
  _t2.copy(d).cross(_t1).normalize();

  const eps = 0.02;
  headPoint(p, d, _p0);
  headPoint(p, _a.copy(d).addScaledVector(_t1, eps).normalize(), _p1);
  headPoint(p, _b.copy(d).addScaledVector(_t2, eps).normalize(), _p2);

  _p1.sub(_p0);
  _p2.sub(_p0);
  out.point.copy(_p0);
  out.normal.copy(_p1).cross(_p2).normalize();
  if (out.normal.dot(d) < 0) out.normal.negate();
  if (!Number.isFinite(out.normal.x)) out.normal.copy(d);
  return out;
}

export function makeHeadGeometry(p) {
  const geo = new THREE.IcosahedronGeometry(1, HEAD_DETAIL);
  const pos = geo.attributes.position;
  const d = new THREE.Vector3();
  const out = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    headPoint(p, d, out);
    pos.setXYZ(i, out.x, out.y, out.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
