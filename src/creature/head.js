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

  // 2. taper along Y and a swollen jaw at the bottom
  const taper = clamp(1 + p.taper * dy, 0.18, 2);
  x *= taper; z *= taper;
  if (dy < 0) {
    const jaw = 1 + p.jaw * (-dy) * (0.6 + 0.4 * Math.abs(dz));
    x *= jaw; z *= jaw * 0.9;
  }

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
