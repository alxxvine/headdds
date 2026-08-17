import * as THREE from 'three';
import { headSurfaceByDir } from './head.js';

// Features never float in front of the face — each one is planted on the
// actual skin of the skull. For points given in frontal coordinates (x, y) we
// shoot a ray from +Z; if the ray misses (heavy taper, narrow crown) we fall
// back to the analytic surface along a direction.

const raycaster = new THREE.Raycaster();
const DOWN_Z = new THREE.Vector3(0, 0, -1);
const ORIGIN = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Frontal raycast: returns { point, normal } in head-local coordinates. */
export function surfaceAt(headMesh, p, x, y) {
  ORIGIN.set(x, y, 60);
  raycaster.set(ORIGIN, DOWN_Z);
  const hits = raycaster.intersectObject(headMesh, false);
  if (hits.length) {
    const h = hits[0];
    return {
      point: h.point.clone(),
      normal: h.face ? h.face.normal.clone().normalize() : new THREE.Vector3(0, 0, 1),
    };
  }
  // fallback: aim at a point on the ellipsoid of the skull's extents
  const u = THREE.MathUtils.clamp(x / (p.headWidth * 1.05), -0.98, 0.98);
  const v = THREE.MathUtils.clamp(y / (p.headHeight * 1.05), -0.98, 0.98);
  const w = Math.sqrt(Math.max(0.02, 1 - u * u - v * v));
  _dir.set(u, v, w);
  const s = headSurfaceByDir(p, _dir);
  return { point: s.point.clone(), normal: s.normal.clone() };
}

/** Skin point along a direction (for horns, warts, tendrils). */
export function surfaceByDir(p, x, y, z) {
  _dir.set(x, y, z);
  const s = headSurfaceByDir(p, _dir);
  return { point: s.point.clone(), normal: s.normal.clone() };
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/** Places an object at a point with its +Z pointing along the skin normal. */
export function orientTo(obj, point, normal) {
  _z.copy(normal).normalize();
  _y.set(0, 1, 0);
  if (Math.abs(_z.y) > 0.97) _y.set(0, 0, -Math.sign(_z.y) || -1);
  _x.crossVectors(_y, _z).normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(point);
  return obj;
}

/**
 * A decal patch: an elliptical disc (or ring) that hugs the skull.
 * Used for the maw cavity, the lips and hollow eye sockets.
 */
export function decalGeometry(headMesh, p, {
  cx = 0, cy = 0, rx = 0.3, ry = 0.2,
  inner = 0, offset = 0.012, rings = 5, segs = 28,
}) {
  const count = (rings + 1) * segs;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const index = [];

  for (let r = 0; r <= rings; r++) {
    const t = inner + (1 - inner) * (r / rings);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const hit = surfaceAt(headMesh, p, cx + Math.cos(a) * rx * t, cy + Math.sin(a) * ry * t);
      const i = (r * segs + s) * 3;
      positions[i] = hit.point.x + hit.normal.x * offset;
      positions[i + 1] = hit.point.y + hit.normal.y * offset;
      positions[i + 2] = hit.point.z + hit.normal.z * offset;
      normals[i] = hit.normal.x;
      normals[i + 1] = hit.normal.y;
      normals[i + 2] = hit.normal.z;
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      const a = r * segs + s;
      const b = r * segs + s2;
      const c = (r + 1) * segs + s;
      const d = (r + 1) * segs + s2;
      index.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}
