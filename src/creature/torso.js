import * as THREE from 'three';
import { fbm3 } from '../lib/noise.js';
import { sculptTerm } from './head.js';

// The torso used to be whichever primitive its kind named — a squashed sphere,
// a cylinder, a box — and next to a skull that is a star-shaped surface with a
// silhouette of its own, a primitive reads as a placeholder. This is the same
// construction as head.js, one level down: every unit direction maps to one
// point of skin, so the body is an icosahedron run through bodyPoint().
//
// It carries no ornaments on purpose. The body is a small object on this
// creature and anything hung off it competes with the head; the interest has to
// come from the shape itself.

const TORSO_DETAIL = 3; // 1280 triangles — the body is a fraction of the frame

/**
 * Half-width of the torso at height `t`, where t runs -1 at the hips to +1 at
 * the shoulders. Three bands, exactly like the skull's brow / temple / jaw, so
 * a body can be broad-shouldered and pinched at the waist instead of being one
 * width all the way down.
 *
 * The limbs are spaced using this, so it has to be callable without building
 * any geometry.
 */
export function bodyProfile(p, t) {
  const band = (c, w) => {
    const q = (t - c) / w;
    return Math.exp(-(q * q));
  };
  return Math.max(0.18, 1
    + p.chestWide * band(0.7, 0.5)
    + p.waistWide * band(0.0, 0.45)
    + p.hipWide * band(-0.75, 0.5));
}

/** The point of skin along direction d (a unit vector), written into out. */
export function bodyPoint(p, d, out = new THREE.Vector3()) {
  const dx = d.x, dy = d.y, dz = d.z;

  // 1. sphere <-> cube, the same dial the skull has
  const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) || 1;
  const k = p.bodyBox;
  let x = dx * (1 - k) + (dx / m) * k;
  let y = dy * (1 - k) + (dy / m) * k;
  let z = dz * (1 - k) + (dz / m) * k;

  // 2. the width profile up the trunk
  const w = bodyProfile(p, dy);
  x *= w;
  z *= 0.3 + w * 0.7;   // depth follows, but less: this is a silhouette

  // 3. a gut: the front swells low down and the back stays flat
  if (dz > 0) z *= 1 + p.belly * 0.55 * (1 - dy) * 0.5;

  // 4. lumps, on a coarser scale than the skull's so the two do not read as
  // the same noise at two sizes
  const lump = fbm3(dx * 2.6 + 31.7, dy * 2.6 + 8.3, dz * 2.6 + 19.1, 5, 3) - 0.5;
  const r = 1 + lump * p.bodyLumps * 2.4;
  x *= r; y *= r; z *= r;

  // 5. the player's sculpt dabs, same mechanism as the skull's
  const sc = sculptTerm(p, 'body', dx, dy, dz);
  if (sc !== 1) { x *= sc; y *= sc; z *= sc; }

  out.set(x, y, z);
  return out;
}

/**
 * A unit torso: exactly 1 in half-width and half-depth, whatever the profile
 * does, so the caller's scale really is the body's size.
 *
 * Without that normalisation the profile multiplies the geometry — three bands
 * at their limit take the half-width to 3.4 — and every ceiling the caller puts
 * on its own scale is off by that factor. That is how a torso ended up sixty
 * times wider than it was tall while the code that sized it believed it had
 * capped the ratio at two.
 */
export function makeTorsoGeometry(p) {
  const geo = new THREE.IcosahedronGeometry(1, TORSO_DETAIL);
  const pos = geo.attributes.position;
  const d = new THREE.Vector3();
  const out = new THREE.Vector3();
  let maxX = 1e-6;
  let maxZ = 1e-6;
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    bodyPoint(p, d, out);
    pos.setXYZ(i, out.x, out.y, out.z);
    maxX = Math.max(maxX, Math.abs(out.x));
    maxZ = Math.max(maxZ, Math.abs(out.z));
  }
  // Normalise the two horizontal axes only: the height stays as the surface
  // made it, so a pinched waist or a swollen gut still reads, and only the
  // overall spread is brought back to one.
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) / maxX, pos.getY(i), pos.getZ(i) / maxZ);
  }
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

/**
 * The same normalisation, solved rather than measured, so body.js can ask how
 * wide the trunk is at a given height without building the mesh first.
 */
export function profilePeak(p) {
  let peak = 1e-6;
  for (let i = 0; i <= 40; i++) {
    const t = -1 + (i / 40) * 2;
    peak = Math.max(peak, bodyProfile(p, t) * Math.sqrt(Math.max(0, 1 - t * t)));
  }
  return peak;
}
