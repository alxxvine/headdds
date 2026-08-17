import * as THREE from 'three';
import { fbm3 } from '../lib/noise.js';

// The skull stopped being a primitive when it became a star-shaped surface of
// its own, and the torso followed. Everything else on the creature is still a
// sphere, a cone or a cylinder — perfect, symmetric, and the same shape on
// every freak that rolls that part. An ear is an ellipsoid, a snout is an
// ellipsoid, a wart is a ball; you can change how big they are and nothing
// else, so a hundred creatures wear a hundred copies of the same ear.
//
// These parts are far too small to deserve a surface function each. What they
// need is to stop being regular, and that is one pass over the vertices:
//
//   taper   one end fatter than the other
//   bend    the whole part curving off its own axis
//   twist   a slow rotation up the axis
//   lumps   fbm displacement along the normal, the same noise the skin uses
//
// Every one is driven by a `seed`, so the left ear and the right ear of one
// creature are different objects rather than a mirrored pair, and no two
// creatures share an ear.

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Warps a geometry in place and returns it.
 *
 * The part's own longest axis is found rather than assumed: an ear is built
 * along Y, a trumpet along Z once it is rotated, a tooth along Y again. Taper
 * and bend are measured along that axis so they mean the same thing whichever
 * way the part happens to have been modelled.
 *
 * @param geo    the geometry to warp, modified in place
 * @param seed   any number — two calls with the same seed give the same part
 * @param opts   amounts, each 0 for "leave it alone"
 */
export function warpGeometry(geo, seed, {
  taper = 0,
  bend = 0,
  twist = 0,
  lumps = 0,
  squash = 0,
} = {}) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  if (!pos || pos.count === 0) return geo;

  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const size = new THREE.Vector3();
  b.getSize(size);
  const mid = new THREE.Vector3();
  b.getCenter(mid);

  // the axis the part is longest along, and the two across it
  const ext = [size.x, size.y, size.z];
  const axis = ext.indexOf(Math.max(...ext));
  const half = Math.max(ext[axis] * 0.5, 1e-6);
  const across = Math.max((ext[(axis + 1) % 3] + ext[(axis + 2) % 3]) * 0.25, 1e-6);
  const key = ['x', 'y', 'z'];
  const A = key[axis];
  const B = key[(axis + 1) % 3];
  const C = key[(axis + 2) % 3];

  // one direction the bend leans in, fixed per part
  const lean = seed * 1.7;
  const bx = Math.cos(lean);
  const bz = Math.sin(lean);

  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    // -1 at one end of the part, +1 at the other
    const t = THREE.MathUtils.clamp((_v[A] - mid[A]) / half, -1, 1);

    // taper: one end drawn in, the other left alone
    if (taper !== 0) {
      const k = Math.max(0.15, 1 + taper * t);
      _v[B] = mid[B] + (_v[B] - mid[B]) * k;
      _v[C] = mid[C] + (_v[C] - mid[C]) * k;
    }

    // squash: flatter across one of the two cross axes than the other
    if (squash !== 0) {
      _v[B] = mid[B] + (_v[B] - mid[B]) * (1 + squash);
      _v[C] = mid[C] + (_v[C] - mid[C]) / (1 + squash);
    }

    // twist: a slow rotation about the long axis, so the part is not the same
    // shape seen from two sides
    if (twist !== 0) {
      const a = twist * t;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const u = _v[B] - mid[B];
      const w = _v[C] - mid[C];
      _v[B] = mid[B] + u * ca - w * sa;
      _v[C] = mid[C] + u * sa + w * ca;
    }

    // bend: the whole part curving away from its own axis, strongest at the far
    // end. Quadratic rather than linear, so the root stays put and only the
    // free end swings — a part bent from its root pulls out of the skin it is
    // planted in.
    if (bend !== 0) {
      const s = bend * across * (t + 1) * (t + 1) * 0.25;
      _v[B] += bx * s;
      _v[C] += bz * s;
    }

    // lumps: the same fbm the skin carries, along the vertex normal, so a
    // knobbly freak is knobbly all the way down to its ears
    if (lumps !== 0 && nor) {
      _n.fromBufferAttribute(nor, i);
      const s = 2.4 / Math.max(half, 1e-6);
      const f = fbm3(_v.x * s + seed * 3.1, _v.y * s + seed * 5.7, _v.z * s + seed * 2.3, 0, 2) - 0.5;
      _v.addScaledVector(_n, f * lumps * across * 2);
    }

    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }

  // Back into the box it started in.
  //
  // Everything that measures this creature — the limb sweep, the arm fitting,
  // the hip spacing — reads a part's size off `geometry.parameters`, and
  // warping does not touch those. A part left free to grow would be measured
  // at the size it was ORDERED at while rendering at some other size, and every
  // one of those checks would quietly go optimistic. Rescaling to the original
  // bounds costs nothing that matters: it is the asymmetry that reads, not the
  // extra millimetre of bulge, and the same normalisation is what makes the
  // torso's own scale mean something.
  geo.computeBoundingBox();
  const nb = geo.boundingBox;
  const ns = new THREE.Vector3();
  nb.getSize(ns);
  const nc = new THREE.Vector3();
  nb.getCenter(nc);
  const kx = ns.x > 1e-9 ? size.x / ns.x : 1;
  const ky = ns.y > 1e-9 ? size.y / ns.y : 1;
  const kz = ns.z > 1e-9 ? size.z / ns.z : 1;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      mid.x + (pos.getX(i) - nc.x) * kx,
      mid.y + (pos.getY(i) - nc.y) * ky,
      mid.z + (pos.getZ(i) - nc.z) * kz,
    );
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The amounts a given creature warps its small parts by, rolled once per part.
 * Kept here so every part reads the same dials: a lumpy freak is lumpy all
 * over, and a lopsided one has two ears that do not match.
 */
export function warpRoll(p, rng, strength = 1) {
  const wonk = 0.35 + p.lopsided * 0.9;
  return {
    taper: (rng() * 2 - 1) * 0.5 * wonk * strength,
    bend: (rng() * 2 - 1) * 0.7 * wonk * strength,
    twist: (rng() * 2 - 1) * 0.6 * wonk * strength,
    squash: (rng() * 2 - 1) * 0.22 * wonk * strength,
    lumps: (0.05 + p.lumps * 0.9) * strength,
  };
}
