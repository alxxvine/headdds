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
const _mid = new THREE.Vector3();
const _sagd = new THREE.Vector3();

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

const _rayFrom = new THREE.Vector3();
const _rayDir = new THREE.Vector3();

/**
 * How far the DRAWN skull reaches along a direction from the head's centre.
 *
 * headPoint answers the same question about the analytic surface the skull is
 * generated from, and on a lumpy head the mesh and that surface disagree by a
 * tenth of a head radius — which is the same size as the distances anything
 * burying itself in the skull cares about. Whatever has to end up hidden BEHIND
 * the skin has to be measured against the skin that is drawn.
 */
export function skinAlong(headMesh, dir) {
  _rayDir.copy(dir).normalize();
  _rayFrom.copy(_rayDir).multiplyScalar(60);
  raycaster.set(_rayFrom, _rayDir.clone().negate());
  const hits = raycaster.intersectObject(headMesh, false);
  return hits.length ? hits[0].point.length() : 0;
}

/**
 * Moves a point found on the ANALYTIC surface onto the skull that is drawn.
 *
 * `headPoint` is the field the skull is generated from; the mesh is a
 * polyhedron through samples of it, and with a lump field finer than the
 * tessellation the two disagree by a good fraction of a head radius. Anything
 * seated by direction — a wart, a horn, a strand — therefore lands on a surface
 * the player never sees, and floats or sinks by that difference. The direction
 * is right either way; only the distance along it is wrong.
 */
export function snapToMesh(headMesh, point) {
  const r = skinAlong(headMesh, point);
  if (r > 0) point.setLength(r);
  return point;
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
  // Every call site picked its ring and segment counts by eye, and a socket
  // two rings deep spans a fifth of a face with three points across it. The
  // skull between those points is not flat, and a lift measured at a few
  // sample quads cannot cover a lump field finer than the sampling — so the
  // patch gets a floor on its density instead, set by how big it is on this
  // head rather than by how big it looked when it was written. Sag falls with
  // the square of the spacing, so this is the cheap half of the fix and the
  // measured lift below is the rest.
  // With the lift measured honestly the lattice no longer has to be fine enough
  // to make the sag small — it only has to be fine enough that a lift big enough
  // to clear the sag does not stand the patch visibly off the face. That is a
  // much cheaper bar.
  const near = (p.headWidth + p.headHeight) * 0.036;
  rings = Math.min(9, Math.max(rings, Math.ceil(Math.max(rx, ry) * (1 - inner) / near)));
  segs = Math.min(44, Math.max(segs, Math.ceil((Math.max(rx, ry) * 6.28) / near)));
  const count = (rings + 1) * segs;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const index = [];

  const pts = new Array(count);
  const nrm = new Array(count);
  for (let r = 0; r <= rings; r++) {
    const t = inner + (1 - inner) * (r / rings);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const hit = surfaceAt(headMesh, p, cx + Math.cos(a) * rx * t, cy + Math.sin(a) * ry * t);
      const i = r * segs + s;
      pts[i] = hit.point;
      nrm[i] = hit.normal;
    }
  }

  // The same self-measured lift the bands use: the faces are flat triangles
  // between points ON the skin, so the skull rises between them by the sag of
  // the chord, and a lump field finer than the sampling puts that sag well over
  // any fixed offset. Nearly half the creatures in a random population had bare
  // face punched through a socket, a nostril or a scar. Measured on the ring
  // spacing, which is the coarse direction — the segments around a decal are
  // close together, the rings across it are not.
  // Every quad, not a sample of them. Sampling the sag at a tenth of the quads
  // gets the median right and the MAXIMUM wrong, and it is the maximum that
  // decides whether a hole opens — the sockets that still leaked were the ones
  // whose worst quad the sampling had stepped over.
  // One lift for the whole patch, measured at the middle of every quad — where
  // the lattice sags furthest under a curved skull — and then CAPPED. Both
  // halves matter. Without the measurement the lift is a guess that fits calm
  // skulls and holes on lumpy ones; without the cap, one sample that came back
  // from somewhere else entirely raises the whole patch with it, and the tool
  // caught a socket floating a head radius in front of a face. A decal that has
  // left the head is a worse defect than the hole it was closing.
  // ...and the lift belongs to the VERTEX, not to the patch. One lift for the
  // whole thing means the worst quad in it decides where every other quad goes,
  // so a socket with one bad chord at its rim floated bodily off the face —
  // measured at a whole head radius on the worst of them, and a decal that has
  // left the head is a worse defect than the hole it was closing. Each corner
  // takes the deepest sag of the quads that meet there, so a lumpy rim rises
  // and a calm middle stays down.
  const lift = new Float32Array(count).fill(offset);
  const cap = offset + Math.min(rx, ry) * 0.3;
  for (let s = 0; s < segs; s++) {
    const s2 = (s + 1) % segs;
    for (let r = 0; r < rings; r++) {
      const t = inner + (1 - inner) * ((r + 0.5) / rings);
      const a = ((s + 0.5) / segs) * Math.PI * 2;
      const mid = surfaceAt(headMesh, p, cx + Math.cos(a) * rx * t, cy + Math.sin(a) * ry * t);
      const c0 = r * segs + s;
      const c1 = (r + 1) * segs + s;
      const c2 = r * segs + s2;
      const c3 = (r + 1) * segs + s2;
      _mid.copy(pts[c0]).add(pts[c1]).add(pts[c2]).add(pts[c3]).multiplyScalar(0.25);
      const one = quadSag(mid, _mid, Math.min(rx, ry) * 0.35, pts[c0].distanceTo(pts[c3]));
      if (one === null) continue;
      const want = Math.min(offset + one * 2.6, cap);
      for (const c of [c0, c1, c2, c3]) if (want > lift[c]) lift[c] = want;
    }
  }

  for (let i = 0; i < count; i++) {
    positions[i * 3] = pts[i].x + nrm[i].x * lift[i];
    positions[i * 3 + 1] = pts[i].y + nrm[i].y * lift[i];
    positions[i * 3 + 2] = pts[i].z + nrm[i].z * lift[i];
    normals[i * 3] = nrm[i].x;
    normals[i * 3 + 1] = nrm[i].y;
    normals[i * 3 + 2] = nrm[i].z;
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
 * One quad's sag, or null if the sample cannot be trusted.
 *
 * The measurement is "how far is the skin above the flat quad", and it is only
 * that when the sample landed where it was asked to. surfaceAt walks a query
 * that misses the mesh in towards the middle of the face until it lands, so a
 * sample taken near the edge of a patch can come back from somewhere else
 * entirely — and the difference then reads as a sag of half a head, which lifts
 * the WHOLE patch by half a head. A socket floating a head radius in front of
 * the face is a worse defect than the hole it was trying to close.
 *
 * A real sag is almost pure normal: the sample sits over the middle of the
 * quad. So a sample that has moved mostly sideways is thrown away, and one that
 * claims more than a third of the patch's own size is thrown away too.
 */
function quadSag(mid, corner, cap, span) {
  _sagd.copy(mid.point).sub(corner);
  const along = _sagd.dot(mid.normal);
  if (along <= 0) return 0;
  if (along > cap) return null;
  // How far sideways the sample landed, judged against the QUAD's own size —
  // not against the sag, which on a coarse lattice is legitimately much smaller
  // than the sideways spread of four corners around a curved middle. A sample
  // that has moved further than the quad is wide did not land in the quad.
  if (_sagd.lengthSq() - along * along > span * span) return null;
  return along;
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
  up, down, offset = 0.012, cols = 24, rows = 3, minLift = 0,
}) {
  const count = (cols + 1) * (rows + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const index = [];
  const pts = new Array(count);
  const nrm = new Array(count);

  for (let ci = 0; ci <= cols; ci++) {
    const u = -1 + (ci / cols) * 2;
    const hi = up(u);
    const lo = down(u);
    for (let ri = 0; ri <= rows; ri++) {
      const y = lo + (hi - lo) * (ri / rows);
      const hit = surfaceAt(headMesh, p, cx + u * rx, cy + y * ry);
      const i = ci * (rows + 1) + ri;
      pts[i] = hit.point;
      nrm[i] = hit.normal;
    }
  }

  // How far the skull rises between two samples, which is the thing that lets
  // bare face through a patch. The faces are FLAT triangles between points ON
  // the skin, so between them the skull is outside the patch by the sag of the
  // chord — and a lump field finer than the sampling makes that sag much bigger
  // than the fixed lift the patch was given. A quarter of the mouths in a
  // random population had the face showing through the lip ring.
  //
  // Rather than guess a lift that covers the lumpiest skull and stands the
  // calmest one off its face, the patch measures its own worst chord and lifts
  // by that. Sampled every fourth column, because the answer varies slowly and
  // each sample is a raycast.
  // Measured and capped, for the reasons given in decalGeometry.
  // A lift per VERTEX, for the reason given in decalGeometry: one lift for the
  // whole band lets its worst quad decide where the rest of it sits, and the
  // mouth is the biggest patch on the creature.
  const lift = new Float32Array(count).fill(offset);
  const cap = offset + Math.min(rx, ry) * 0.3;
  for (let ci = 0; ci < cols; ci++) {
    const u = -1 + ((ci + 0.5) / cols) * 2;
    const hi = up(u);
    const lo = down(u);
    for (let ri = 0; ri < rows; ri++) {
      const y = lo + (hi - lo) * ((ri + 0.5) / rows);
      const mid = surfaceAt(headMesh, p, cx + u * rx, cy + y * ry);
      const i = ci * (rows + 1) + ri;
      const j = (ci + 1) * (rows + 1) + ri;
      _mid.copy(pts[i]).add(pts[i + 1]).add(pts[j]).add(pts[j + 1]).multiplyScalar(0.25);
      const one = quadSag(mid, _mid, Math.min(rx, ry) * 0.35, pts[i].distanceTo(pts[j + 1]));
      if (one === null) continue;
      const want = Math.min(offset + one * 2.6, cap);
      for (const c of [i, i + 1, j, j + 1]) if (want > lift[c]) lift[c] = want;
    }
  }
  let worst = 0;
  for (let i = 0; i < count; i++) {
    if (minLift > lift[i]) lift[i] = minLift;
    if (lift[i] > worst) worst = lift[i];
  }

  for (let i = 0; i < count; i++) {
    positions[i * 3] = pts[i].x + nrm[i].x * lift[i];
    positions[i * 3 + 1] = pts[i].y + nrm[i].y * lift[i];
    positions[i * 3 + 2] = pts[i].z + nrm[i].z * lift[i];
    normals[i * 3] = nrm[i].x;
    normals[i * 3 + 1] = nrm[i].y;
    normals[i * 3 + 2] = nrm[i].z;
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
  geo.userData.lift = worst;   // so whatever must sit over this can clear it
  return geo;
}