import * as THREE from 'three';
import { headPoint, headSurfaceByDir } from './head.js';

// Features never float in front of the face — each one is planted on the
// actual skin of the skull. For points given in frontal coordinates (x, y) we
// shoot a ray from +Z; if the ray misses (heavy taper, narrow crown) we fall
// back to the analytic surface along a direction.

const raycaster = new THREE.Raycaster();
const DOWN_Z = new THREE.Vector3(0, 0, -1);
const ORIGIN = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hi = new THREE.Vector3();
const _lo = new THREE.Vector3();

/**
 * Frontal raycast: returns { point, normal } in head-local coordinates.
 *
 * A ray can miss even when the caller has checked that the skull is wide
 * enough there: the outline is solved on the analytic surface and the ray hits
 * the TESSELLATED one, whose facets cut the corner near the crown. The old
 * answer to a miss was to aim at an ellipsoid of headWidth by headHeight —
 * which is not the shape of the skull and not even its size — and near the top
 * of the head that came back with a point a third of a head away, wearing a
 * normal that pointed into the screen. Everything planted through it went with
 * it: eyes that had been settled clear of one another arrived on top of one
 * another, facing backwards.
 *
 * Now a miss walks the query in towards the middle of the face until it lands.
 * The feature ends up slightly inside where it was asked for, which is what
 * "as close to there as there is skin" means, and it always ends up on skin
 * that faces the player.
 */
export function surfaceAt(headMesh, p, x, y) {
  const mid = (headPoint(p, _dir.set(0, 1, 0), _hi).y + headPoint(p, _dir.set(0, -1, 0), _lo).y) * 0.5;
  for (let k = 0; k <= 12; k++) {
    const f = 1 - k * 0.07;
    ORIGIN.set(x * f, mid + (y - mid) * f, 60);
    raycaster.set(ORIGIN, DOWN_Z);
    const hits = raycaster.intersectObject(headMesh, false);
    for (const h of hits) {
      const n = h.face ? h.face.normal.clone().normalize() : new THREE.Vector3(0, 0, 1);
      // a facet that faces away is the far side of the head showing through a
      // fold, not the front of it
      if (n.z <= 0.05) continue;
      return { point: h.point.clone(), normal: n };
    }
  }
  // Nothing anywhere down the midline, which should not happen: fall back to
  // the analytic surface along the direction of the request.
  const s = headSurfaceByDir(p, _dir.set(x, y - mid, Math.max(0.35, Math.hypot(x, y - mid))));
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
 * Places an object at a point with its +Y straight up and its +Z out of the
 * skin — the tangent frame with the sideways lean taken out of it.
 *
 * `orientTo` builds its basis from the skin normal alone, which is right for
 * anything glued to the skull and wrong for anything GROWING out of it. A row
 * of teeth is the case: the normal at the corner of a wide mouth points down
 * and out, so the frame's "up" tipped a third of a turn sideways and the tooth
 * grew along the cheek instead of into the mouth. Worse, a curled tooth spins
 * about the frame's X, and a tilted X threw barbs and tusks clean across the
 * face. Here X is horizontal by construction, so a curl is a forward sweep and
 * nothing else, and the growth axis is the mouth's own vertical.
 */
export function orientUpright(obj, point, normal) {
  _y.set(0, 1, 0);
  _z.copy(normal).addScaledVector(_y, -normal.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1); else _z.normalize();
  _x.crossVectors(_y, _z).normalize();
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


/**
 * A patch between two curves, glued to the skin: at each u across the patch it
 * fills from down(u) to up(u), both in units of ry.
 *
 * This exists because the fan above scales its rings towards the decal's
 * CENTRE, and that only works for a shape that contains its own centre. Five of
 * the maw's shapes do not — a grin's corners are hauled above its middle, a
 * crescent lies entirely below it — and on those the inner rings collapsed
 * through a point outside the shape, painting a dark wedge from the corner of
 * the mouth towards its centre. A band has no centre to collapse through.
 */
export function bandGeometry(headMesh, p, {
  cx = 0, cy = 0, rx = 0.3, ry = 0.2,
  up, down, offset = 0.012, cols = 24, rows = 3,
}) {
  const count = (cols + 1) * (rows + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const index = [];

  for (let ci = 0; ci <= cols; ci++) {
    const u = -1 + (ci / cols) * 2;
    const hi = up(u);
    const lo = down(u);
    for (let ri = 0; ri <= rows; ri++) {
      const y = lo + (hi - lo) * (ri / rows);
      const hit = surfaceAt(headMesh, p, cx + u * rx, cy + y * ry);
      const i = (ci * (rows + 1) + ri) * 3;
      positions[i] = hit.point.x + hit.normal.x * offset;
      positions[i + 1] = hit.point.y + hit.normal.y * offset;
      positions[i + 2] = hit.point.z + hit.normal.z * offset;
      normals[i] = hit.normal.x;
      normals[i + 1] = hit.normal.y;
      normals[i + 2] = hit.normal.z;
    }
  }

  for (let ci = 0; ci < cols; ci++) {
    for (let ri = 0; ri < rows; ri++) {
      const a = ci * (rows + 1) + ri;
      const b = a + 1;
      const c = (ci + 1) * (rows + 1) + ri;
      const d = c + 1;
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