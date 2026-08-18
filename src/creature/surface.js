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
const _bandHit = { point: new THREE.Vector3(), normal: new THREE.Vector3() };
const _du = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _dp = new THREE.Vector3();
const _dhit = { point: new THREE.Vector3(), normal: new THREE.Vector3() };
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

const _radFrom = new THREE.Vector3();
const _radDir = new THREE.Vector3();

/**
 * The skin along a direction from the head's centre, as {point, normal}, taken
 * off the mesh that is drawn.
 *
 * `surfaceAt` shoots from the FRONT at a point in the frontal plane, which is
 * the same thing only while the skin faces the camera. Out towards the
 * silhouette the surface turns edge-on to that ray, and an even lattice of
 * screen positions becomes a wildly uneven lattice on the skin. Asking along
 * the sample's own radial direction has no such preferred axis.
 */
export function surfaceRadial(headMesh, point, out = { point: new THREE.Vector3(), normal: new THREE.Vector3() }, p = null) {
  if (point.lengthSq() < 1e-9) point.set(0, 0, 1);
  _radDir.copy(point).normalize();
  // A ray that runs exactly along a shared edge of the mesh can pass between
  // two triangles and hit neither — and a mouth is built on the midline, where
  // every ray has x = 0 and the icosahedron has its seams. Six vertices of one
  // lip band came back with no hit at all, and the fallback left each of them
  // where it was ASKED to be, which is out in the air off the tangent plane: an
  // eighth of a head radius clear of the face, and the widest thing hanging
  // outside the outline on that creature. So a miss is retried off the seam
  // before it is believed.
  for (let k = 0; k < 4; k++) {
    if (k) {
      _radDir.copy(point).normalize();
      _radDir.x += (k === 1 ? 1 : k === 2 ? -1 : 0.5) * 2e-3;
      _radDir.y += (k === 3 ? 1 : 0) * 2e-3;
      _radDir.normalize();
    }
    _radFrom.copy(_radDir).multiplyScalar(60);
    raycaster.set(_radFrom, _radDir.clone().negate());
    const hits = raycaster.intersectObject(headMesh, false);
    if (!hits.length) continue;
    out.point.copy(hits[0].point);
    out.normal.copy(hits[0].face ? hits[0].face.normal : _radDir).normalize();
    if (out.normal.dot(_radDir) < 0) out.normal.negate();
    return out;
  }
  // Nothing anywhere along the ray, which should not happen on a closed skull:
  // the analytic surface, which is defined in every direction, rather than the
  // query point, which is defined nowhere.
  _radDir.copy(point).normalize();
  if (p) {
    const s = headSurfaceByDir(p, _radDir);
    out.point.copy(s.point);
    out.normal.copy(s.normal);
  } else {
    out.point.copy(point);
    out.normal.copy(_radDir);
  }
  return out;
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
 * A patch's own frame on the skin: where its middle sits, and a pair of tangent
 * axes there. Every sample a patch takes is then a step ACROSS THE SKIN dropped
 * onto the skull along its own direction, rather than a step across the SCREEN
 * dropped along the camera's.
 *
 * The two agree on the front of a face and part company towards the
 * silhouette, where the skin turns edge-on to the camera's ray. A frontal
 * query out there misses the head altogether and walks in towards the middle
 * of the face until it lands, so the sample comes back from somewhere else
 * entirely: a socket asked to be a tenth of a head across came out as a black
 * streak nearly three times the width of the face, and the corners of a wide
 * mouth were dragged inward and then LIFTED, because the lift is measured from
 * how far the skin stands above the quad and a walked-in sample makes that
 * look like a third of a mouth. The maw stood an eighth of a head radius clear
 * of the cheek for it.
 */
export function patchFrame(headMesh, p, cx, cy, span = 0) {
  const seat = surfaceAt(headMesh, p, cx, cy);
  const point = seat.point.clone();
  // The frame's own normal is the seat's RADIAL direction, not the facet's.
  // A five-hundred-face skull has facets a quarter of a radius across and the
  // face normal under a patch is whichever way one of them happens to point:
  // on a lumpy head that came out forty degrees round the azimuth, and the
  // mouth built on it was laid diagonally across the cheek. The radial
  // direction of a star-shaped skull is smooth by construction, so a patch
  // near the front of the face gets a frame near the front of the face. The
  // per-vertex normals the patch is LIFTED along stay the mesh's own — the
  // lift is a local question and this is not.
  // ...averaged over the patch's own span rather than taken from the one facet
  // the seat happens to land on. A five-hundred-face skull has facets a quarter
  // of a radius across, and one of them pointing forty degrees round the
  // azimuth laid a whole mouth diagonally across a cheek. Averaging keeps the
  // frame lying along the skin — which a purely radial normal does not, and a
  // patch built on a plane that cuts into the head smears as it is projected
  // back out onto it. The per-vertex normals the patch is LIFTED along stay the
  // mesh's own: the lift is a local question and this is not.
  const normal = seat.normal.clone();
  // Only when the facet actually disagrees with the skull under it: on a calm
  // seat the average is the facet, and the probes are six raycasts each patch
  // pays for nothing.
  const radial = point.lengthSq() > 1e-9 ? _dp.copy(point).normalize().dot(normal) : 1;
  if (span > 0 && radial < 0.985) {
    const a0 = new THREE.Vector3(Math.abs(normal.y) > 0.9 ? 1 : 0, Math.abs(normal.y) > 0.9 ? 0 : 1, 0)
      .cross(normal).normalize();
    const a1 = new THREE.Vector3().crossVectors(normal, a0).normalize();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      _dp.copy(point).addScaledVector(a0, Math.cos(a) * span).addScaledVector(a1, Math.sin(a) * span);
      normal.add(surfaceRadial(headMesh, _dp, _dhit, p).normal);
    }
    normal.normalize();
  }
  if (point.lengthSq() > 1e-9 && normal.dot(point) < 0) normal.negate();
  const du = new THREE.Vector3(Math.abs(normal.y) > 0.9 ? 1 : 0, Math.abs(normal.y) > 0.9 ? 0 : 1, 0)
    .cross(normal).normalize();
  const dv = new THREE.Vector3().crossVectors(normal, du).normalize();
  return {
    point,
    normal,
    du,
    dv,
    /** the skin at a tangent offset from the middle of the patch */
    at(ox, oy, out = _dhit) {
      _dp.copy(point).addScaledVector(du, ox).addScaledVector(dv, oy);
      return surfaceRadial(headMesh, _dp, out, p);
    },
  };
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

  // The patch's own frame: where its middle sits on the skin, and a pair of
  // tangent axes there. Every sample is then taken as a step ACROSS THE SKIN
  // and dropped onto the skull along its own direction, rather than as a step
  // across the SCREEN dropped along the camera's. The two agree on the front of
  // a face and part company towards the silhouette, where the skin turns
  // edge-on to the camera's ray: a socket asked to be a tenth of a head across
  // came out as a black streak nearly three times the width of the face, and
  // half of all creatures had a decal past half again its own size.
  const { at } = patchFrame(headMesh, p, cx, cy, Math.min(rx, ry) * 0.7);

  const pts = new Array(count);
  const nrm = new Array(count);
  for (let r = 0; r <= rings; r++) {
    const t = inner + (1 - inner) * (r / rings);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const hit = at(Math.cos(a) * rx * t, Math.sin(a) * ry * t);
      const i = r * segs + s;
      pts[i] = hit.point.clone();
      nrm[i] = hit.normal.clone();
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
  // A disc is a socket or a nostril: small, and nowhere near the silhouette,
  // so it can afford the lift it needs to cover its own sag. The mouth cannot —
  // see the band below.
  const cap = offset + Math.min(rx, ry) * 0.3;
  for (let s = 0; s < segs; s++) {
    const s2 = (s + 1) % segs;
    for (let r = 0; r < rings; r++) {
      const t = inner + (1 - inner) * ((r + 0.5) / rings);
      const a = ((s + 0.5) / segs) * Math.PI * 2;
      const mid = at(Math.cos(a) * rx * t, Math.sin(a) * ry * t);
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
  geo.userData.rx = rx;   // what it was asked to be, so a tool can see if it got it
  geo.userData.ry = ry;
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

  // Sampled in the band's own frame on the skin rather than by a frontal query
  // — see patchFrame. The mouth is the widest patch on the creature and its
  // corners are the furthest round the skull, which is exactly where a frontal
  // query stops telling the truth.
  const frame = patchFrame(headMesh, p, cx, cy, Math.min(rx, ry) * 0.7);
  for (let ci = 0; ci <= cols; ci++) {
    const u = -1 + (ci / cols) * 2;
    const hi = up(u);
    const lo = down(u);
    for (let ri = 0; ri <= rows; ri++) {
      const y = lo + (hi - lo) * (ri / rows);
      const hit = frame.at(u * rx, y * ry);
      const i = ci * (rows + 1) + ri;
      pts[i] = hit.point.clone();
      nrm[i] = hit.normal.clone();
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
  // A ceiling on the lift, because a lift is a patch standing off the face and
  // a patch standing off the face comes out through the outline from the side.
  // It used to be a third of the patch's own size, which on a mouth is an
  // eighth of a head radius of dark fin hanging off the cheek. The bands win
  // their ordering against the skin on depth now (see mats.lip and mats.maw),
  // so height only has to cover an honest sag.
  const cap = offset + Math.min(rx, ry) * 0.12;
  for (let ci = 0; ci < cols; ci++) {
    const u = -1 + ((ci + 0.5) / cols) * 2;
    const hi = up(u);
    const lo = down(u);
    for (let ri = 0; ri < rows; ri++) {
      const i = ci * (rows + 1) + ri;
      const j = (ci + 1) * (rows + 1) + ri;
      _mid.copy(pts[i]).add(pts[i + 1]).add(pts[j]).add(pts[j + 1]).multiplyScalar(0.25);
      // The skin over the middle of the quad, found along the quad's OWN ray
      // out of the head rather than by a frontal query. A frontal query at the
      // corner of a wide mouth is grazing the skull, misses, and walks in
      // towards the middle of the face until it lands — and where the skin
      // faces sideways that walk is almost pure normal, so a sample that came
      // back from somewhere else entirely reads as a sag of a third of the
      // mouth and lifts that corner of the band bodily off the head. The maw
      // was standing an eighth of a head radius clear of the face at its
      // corners, which from three quarters on is a dark fin off the cheek.
      surfaceRadial(headMesh, _mid, _bandHit, p);
      const one = quadSag(_bandHit, _mid, Math.min(rx, ry) * 0.35, pts[i].distanceTo(pts[j + 1]));
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