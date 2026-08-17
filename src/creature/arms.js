import * as THREE from 'three';
import { withOutline } from './materials.js';

// Arms are built one at a time so the two sides can differ: length, splay and
// lift all get a per-side wobble from `asymmetry`. Everything hangs along the
// shoulder's local -Y, so the pose is just the shoulder's rotation.

const _v = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * Lowest point of a subtree, measured on the real shapes.
 * Box3.setFromObject takes the AABB of the rotated geometry box, which for a
 * tilted sphere is far bigger than the sphere — that overestimate is exactly
 * what would push every bent arm into a needless splay.
 */
export function lowestPoint(root) {
  let lo = Infinity;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return; // skip outline shells
    const g = o.geometry;
    const par = g.parameters || {};
    // world scale, not the mesh's own: shrinking a whole arm has to shrink the
    // radius it is measured by, otherwise the fitting loop never converges
    o.getWorldScale(_scale);
    const scale = Math.max(_scale.x, _scale.y, _scale.z);

    if (g.type === 'SphereGeometry') {
      o.getWorldPosition(_v);
      lo = Math.min(lo, _v.y - par.radius * scale);
      return;
    }
    if (g.type === 'CapsuleGeometry' || g.type === 'CylinderGeometry' || g.type === 'ConeGeometry') {
      const half = (par.height ?? 0) / 2;
      const r = Math.max(par.radius ?? 0, par.radiusTop ?? 0, par.radiusBottom ?? 0) * scale;
      for (const end of [-half, half]) {
        _v.set(0, end, 0).applyMatrix4(o.matrixWorld);
        lo = Math.min(lo, _v.y - r);
      }
      return;
    }
    // tubes and anything else: bounding box corners are close enough
    g.computeBoundingBox();
    _box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
    lo = Math.min(lo, _box.min.y);
  });
  return lo === Infinity ? 0 : lo;
}

// ------------------------------------------------------------------ HANDS ---

function addHand(parent, p, mats, { limbR, ink, tip, dir }) {
  if (p.handType === 'none') return;

  const frame = new THREE.Group();
  frame.position.copy(tip);
  frame.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
  parent.add(frame);

  const palmGeo = new THREE.SphereGeometry(limbR * (p.handType === 'club' ? 1.5 : 0.9), 8, 6);
  const palm = new THREE.Mesh(palmGeo, mats.body);
  if (p.handType === 'club') palm.scale.set(1.1, 1.3, 1.1);
  withOutline(frame, palm, palmGeo, ink, mats.outline);
  if (p.handType === 'ball' || p.handType === 'club') return;

  // claws and pincers are cones fanned around the tip
  const fingers = p.handType === 'pincer' ? 2 : 3;
  const fingerGeo = new THREE.ConeGeometry(limbR * 0.5, limbR * (p.handType === 'pincer' ? 3.8 : 2.9), 4);
  for (let i = 0; i < fingers; i++) {
    const a = fingers === 2 ? (i === 0 ? -1 : 1) : (i - 1);
    const finger = new THREE.Mesh(fingerGeo, mats.growth);
    const spread = p.handType === 'pincer' ? 0.55 : 0.42;
    finger.rotation.z = a * spread;
    finger.rotation.x = p.handType === 'pincer' ? 0 : (i - 1) * 0.3;
    finger.position.set(0, -limbR * 1.2, 0);
    finger.translateY(-limbR * 0.6);
    // cones point +Y by default; flip so they grow away from the palm
    finger.rotateZ(Math.PI);
    withOutline(frame, finger, fingerGeo, ink * 0.7, mats.outline);
  }
}

// ------------------------------------------------------------------- ARMS ---

/** Builds the limb itself and reports where its tip is and where it points. */
function addSegments(parent, p, mats, { limbR, ink, len, side }) {
  const tip = new THREE.Vector3(0, -len, 0);
  const dir = new THREE.Vector3(0, -1, 0);

  if (p.armType === 'stub') {
    const stubLen = Math.max(limbR * 1.2, len * 0.3);
    const geo = new THREE.CapsuleGeometry(limbR * 1.05, stubLen, 3, 6);
    const stub = new THREE.Mesh(geo, mats.body);
    stub.position.y = -stubLen * 0.5;
    withOutline(parent, stub, geo, ink, mats.outline);
    tip.set(0, -stubLen - limbR * 0.6, 0);
    return { tip, dir };
  }

  if (p.armType === 'noodle') {
    // a limp curl: drifts forward and outward on the way down
    const pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(side * len * 0.05, -len * 0.4, len * 0.1),
      new THREE.Vector3(side * len * 0.18, -len * 0.72, len * 0.26),
      new THREE.Vector3(side * len * 0.3, -len * 0.9, len * 0.46),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 10, limbR * 0.8, 5, false);
    parent.add(new THREE.Mesh(geo, mats.body));
    tip.copy(pts[3]);
    dir.copy(pts[3]).sub(pts[2]).normalize();
    return { tip, dir };
  }

  if (p.armType === 'mantis') {
    // upper arm down-and-out, forearm kicked forward at the elbow
    const upper = len * 0.55;
    const fore = len * 0.5;
    const upGeo = new THREE.CapsuleGeometry(limbR * 0.9, upper, 3, 6);
    const upperMesh = new THREE.Mesh(upGeo, mats.body);
    upperMesh.position.y = -upper * 0.5;
    withOutline(parent, upperMesh, upGeo, ink, mats.outline);

    const elbow = new THREE.Group();
    elbow.position.y = -upper;
    // forearm kicks forward *and* up, otherwise the bend is pure foreshortening
    // and the limb reads as another straight stick head-on
    elbow.rotation.x = -1.95;
    elbow.rotation.z = -0.3;
    parent.add(elbow);

    const foreGeo = new THREE.CapsuleGeometry(limbR * 0.75, fore, 3, 6);
    const foreMesh = new THREE.Mesh(foreGeo, mats.body);
    foreMesh.position.y = -fore * 0.5;
    withOutline(elbow, foreMesh, foreGeo, ink, mats.outline);

    elbow.updateMatrix();
    tip.set(0, -fore - limbR * 0.5, 0).applyMatrix4(elbow.matrix);
    dir.set(0, -1, 0).applyQuaternion(elbow.quaternion);
    return { tip, dir };
  }

  // stick — the plain hanging limb
  const geo = new THREE.CapsuleGeometry(limbR * 0.85, len, 3, 6);
  const arm = new THREE.Mesh(geo, mats.body);
  arm.position.y = -len * 0.5;
  withOutline(parent, arm, geo, ink, mats.outline);
  tip.set(0, -len - limbR * 0.4, 0);
  return { tip, dir };
}

/**
 * One arm, already posed. Returns the shoulder pivot (or null for `none`).
 * The pose is opened up until no part of the arm dips below the feet — bent
 * limbs make an analytic clearance formula useless, so the built arm is
 * measured instead.
 */
export function buildArm(p, mats, rng, opts) {
  if (p.armType === 'none') return null;
  const { side, shoulderX, shoulderY, shoulderZ, limbR, armLen, ink, stance } = opts;

  const wonk = p.asymmetry * (rng() * 2 - 1);
  const len = Math.max(limbR * 2.5, armLen * (1 + wonk * 0.5));

  const shoulder = new THREE.Group();
  shoulder.position.set(side * shoulderX, shoulderY, shoulderZ);
  const { tip, dir } = addSegments(shoulder, p, mats, { limbR, ink, len, side });
  addHand(shoulder, p, mats, { limbR, ink, tip, dir });

  // lift swings the arm forward or back; the wobble keeps the sides apart
  shoulder.rotation.x = -p.armLift * 0.7 + wonk * 0.2;

  let splay = 0.32 + stance * 0.4 + Math.abs(wonk) * 0.3;
  for (let i = 0; i < 14; i++) {
    shoulder.rotation.z = side * splay;
    if (lowestPoint(shoulder) >= 0 || splay >= 1.5) break;
    splay = Math.min(1.5, splay + 0.12);
  }

  // Still scraping the floor (a long arm on a tiny body): shrink to fit.
  // Re-measured each pass — a claw's cone tip and a club's squashed palm do not
  // shrink exactly in step with the arm, so one analytic step lands short.
  for (let i = 0; i < 4; i++) {
    const lo = lowestPoint(shoulder);
    if (lo >= 0 || shoulderY <= 0) break;
    const k = Math.max(0.15, (shoulderY / (shoulderY - lo)) * 0.96);
    shoulder.scale.multiplyScalar(k);
  }

  // the animator lifts and swings this arm; it needs to know how much splay it
  // may spend before the limb would cross the midline
  shoulder.userData.splay = splay;
  shoulder.userData.side = side;
  return shoulder;
}
