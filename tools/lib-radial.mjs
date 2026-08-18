// The ANALYTIC skin along a ray out of the head's centre.
//
// headPoint(p, d) is not a radial map: it scales x, y and z by different
// amounts (headWidth / headHeight / headDepth, the flare on x and z, the
// profile lean on z), so the skin point in direction d does not lie along d.
// Comparing |v| with |headPoint(v.normalized())| — which is what hair.js's sink
// pass, float-sweep and pruneBuriedOutlines all do — therefore answers a
// question about a different direction. Run it over the skull's own 20 000
// vertices, every one of which is a skin point and so must answer 0: median
// -0.033, 31% called proud of the skin, 44% called buried past 0.05, worst 1.08.
//
// Star-shapedness still guarantees one skin point per ray, so solve for it:
// Gauss-Newton on d, seeded by undoing the three axis scales.
import * as THREE from 'three';
import { headPoint } from '../src/creature/head.js';

const _p = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);

export function radialSkin(p, u, out = new THREE.Vector3(), dirOut = null) {
  const t = _t.copy(u).normalize();
  _t1.copy(Math.abs(t.y) > 0.95 ? SIDE : UP).cross(t).normalize();
  _t2.copy(t).cross(_t1).normalize();
  // seed: undo the three axis scales, which is most of what makes headPoint
  // non-radial
  const d = _d.set(t.x / p.headWidth, t.y / p.headHeight, t.z / p.headDepth);
  if (d.lengthSq() < 1e-16) d.copy(t); else d.normalize();

  let best = Infinity;
  const bestD = new THREE.Vector3().copy(d);
  const eps = 3e-3;
  for (let it = 0; it < 60; it++) {
    headPoint(p, d, out);
    const n = out.length() || 1;
    const cx = out.dot(_t1) / n;
    const cy = out.dot(_t2) / n;
    const err = cx * cx + cy * cy;
    if (err < best) { best = err; bestD.copy(d); }
    if (err < 1e-16) break;
    const j = [];
    for (const ax of [_t1, _t2]) {
      headPoint(p, _n.copy(d).addScaledVector(ax, eps).normalize(), _p);
      const m = _p.length() || 1;
      j.push([(_p.dot(_t1) / m - cx) / eps, (_p.dot(_t2) / m - cy) / eps]);
    }
    const [[a, c], [b, e]] = j;
    const det = a * e - b * c;
    let s1, s2;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-10) { s1 = -cx * 0.5; s2 = -cy * 0.5; }
    else { s1 = (-cx * e + cy * b) / det; s2 = (-cy * a + cx * c) / det; }
    const step = Math.hypot(s1, s2);
    if (step > 0.3) { s1 *= 0.3 / step; s2 *= 0.3 / step; }
    _n.copy(d).addScaledVector(_t1, s1).addScaledVector(_t2, s2).normalize();
    d.copy(_n);
    if (step < 1e-10) break;
  }
  headPoint(p, bestD, out);
  if (dirOut) dirOut.copy(bestD);
  return out;
}

/** signed distance of a head-local point off the ANALYTIC skin */
export function proudAnalytic(p, v, out = new THREE.Vector3()) {
  const n = v.length();
  if (n < 1e-9) return -Infinity;
  radialSkin(p, v, out);
  return n - out.length();
}
