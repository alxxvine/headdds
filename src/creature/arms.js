import * as THREE from 'three';
import { withOutline } from './materials.js';
import { warpGeometry, warpRoll } from './warp.js';

// Arms are built one at a time so the two sides can differ: length, splay and
// lift all get a per-side wobble from `asymmetry`. Everything hangs along the
// shoulder's local -Y, so the pose is just the shoulder's rotation.

const _v = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * Every shape in a subtree, reported as balls in world space: a centre and a
 * radius the shape stays inside of.
 * Box3.setFromObject takes the AABB of the rotated geometry box, which for a
 * tilted sphere is far bigger than the sphere — that overestimate is exactly
 * what would push every bent arm into a needless splay.
 */
function forEachBall(root, cb) {
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
      cb(_v, par.radius * scale);
      return;
    }
    if (g.type === 'CapsuleGeometry' || g.type === 'CylinderGeometry' || g.type === 'ConeGeometry') {
      const half = (par.height ?? 0) / 2;
      const r = Math.max(par.radius ?? 0, par.radiusTop ?? 0, par.radiusBottom ?? 0) * scale;
      for (const end of [-half, half]) {
        _v.set(0, end, 0).applyMatrix4(o.matrixWorld);
        cb(_v, r);
      }
      return;
    }
    // tubes and anything else: bounding box corners are close enough
    g.computeBoundingBox();
    _box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
    for (const x of [_box.min.x, _box.max.x]) {
      for (const y of [_box.min.y, _box.max.y]) {
        for (const z of [_box.min.z, _box.max.z]) cb(_v.set(x, y, z), 0);
      }
    }
  });
}

/** Lowest point of a subtree, measured on the real shapes. */
export function lowestPoint(root) {
  let lo = Infinity;
  forEachBall(root, (c, r) => { lo = Math.min(lo, c.y - r); });
  return lo === Infinity ? 0 : lo;
}

/**
 * How far the nearest part of a subtree stays from the midline, on the side it
 * grows from. Negative means it has crossed to the other half of the body.
 *
 * The floor is not the only thing an arm can be swung into. A hand reaches
 * sideways well past the limb it is on — a claw's fingers fan out by more than
 * a whole limb radius — so an arm rooted a hand's width from the middle of a
 * narrow freak can be tucked in until the two sets of fingers interlock, while
 * every check made on the limb alone still passes.
 */
export function innerReach(root, side) {
  let inner = Infinity;
  forEachBall(root, (c, r) => { inner = Math.min(inner, side * c.x - r); });
  return inner === Infinity ? 0 : inner;
}

/** How far from straight down the hand actually sits, in radians. */
const _lean = new THREE.Vector3();
function armLean(shoulder, tip) {
  _lean.copy(tip).applyQuaternion(shoulder.quaternion);
  const len = _lean.length();
  if (len < 1e-9) return 0;
  return Math.acos(Math.min(1, Math.max(-1, -_lean.y / len)));
}

/** 60 degrees from straight down. Past this the arm reads as a T-pose. */
const MAX_LEAN = 1.05;

// ------------------------------------------------------------------ HANDS ---

function addHand(parent, p, mats, rng, { limbR, ink, tip, dir }) {
  if (p.handType === 'none') return;

  const frame = new THREE.Group();
  frame.position.copy(tip);
  frame.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
  parent.add(frame);

  if (p.handType === 'fist') {
    // a blocky mitt — knuckles, no fingers to speak of
    const geo = warpGeometry(
      new THREE.BoxGeometry(limbR * 1.7, limbR * 1.5, limbR * 1.7, 2, 2, 2),
      rng(), warpRoll(p, rng, 0.45));
    const fist = new THREE.Mesh(geo, mats.trim);
    fist.position.y = -limbR * 0.5;
    fist.rotation.y = (rng() - 0.5) * 0.5;
    withOutline(frame, fist, geo, ink, mats.outline);
    return;
  }

  // A hand is a ball at this size, and a perfect ball is the one thing that
  // never reads as flesh. Knocked out of true like everything else.
  const palmGeo = warpGeometry(
    new THREE.SphereGeometry(limbR * (p.handType === 'club' ? 1.5 : 0.9), 9, 7),
    rng(), warpRoll(p, rng, 0.6));
  const palm = new THREE.Mesh(palmGeo, mats.trim);
  if (p.handType === 'club') palm.scale.set(1.1, 1.3, 1.1);
  withOutline(frame, palm, palmGeo, ink, mats.outline);
  if (p.handType === 'ball' || p.handType === 'club') return;

  if (p.handType === 'spikes') {
    // a morning-star: short thorns all round the ball. Directions are a fixed
    // fan, not random — a spike pointing back up the arm reads as a glitch.
    const spikeGeo = new THREE.ConeGeometry(limbR * 0.3, limbR * 1.2, 5, 2);
    const dirs = [
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0.8, -0.5, 0.2), new THREE.Vector3(-0.8, -0.5, 0.2),
      new THREE.Vector3(0.3, -0.4, 0.85), new THREE.Vector3(-0.3, -0.4, 0.85),
      new THREE.Vector3(0.5, -0.4, -0.75), new THREE.Vector3(-0.5, -0.4, -0.75),
    ];
    for (const d of dirs) {
      d.normalize();
      const spike = new THREE.Mesh(spikeGeo, mats.growth);
      // cones point +Y; aim each one outward from the palm's centre
      spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      spike.position.copy(d).multiplyScalar(limbR * 1.15);
      withOutline(frame, spike, spikeGeo, ink * 0.6, mats.outline);
    }
    return;
  }

  if (p.handType === 'hook') {
    // one heavy talon curling forward: two cones chained at a knuckle, the
    // same nested-group trick the mantis elbow uses
    const baseLen = limbR * 2.6;
    const baseGeo = new THREE.ConeGeometry(limbR * 0.55, baseLen, 6, 3);
    const base = new THREE.Mesh(baseGeo, mats.growth);
    base.position.y = -limbR * 0.6 - baseLen * 0.5;
    base.rotateZ(Math.PI);
    withOutline(frame, base, baseGeo, ink * 0.8, mats.outline);

    const knuckle = new THREE.Group();
    knuckle.position.set(0, -limbR * 0.6 - baseLen * 0.85, 0);
    knuckle.rotation.x = 1.05;   // the curl: tip swings forward
    frame.add(knuckle);
    const tipLen = limbR * 1.9;
    const tipGeo = new THREE.ConeGeometry(limbR * 0.36, tipLen, 5, 2);
    const claw = new THREE.Mesh(tipGeo, mats.growth);
    claw.position.y = -tipLen * 0.42;
    claw.rotateZ(Math.PI);
    withOutline(knuckle, claw, tipGeo, ink * 0.6, mats.outline);
    return;
  }

  if (p.handType === 'fingers') {
    // three limp digits hanging off the palm — the closest thing to a hand
    // a freak gets
    const fingerLen = limbR * 1.9;
    const fingerGeo = warpGeometry(
      new THREE.CapsuleGeometry(limbR * 0.27, fingerLen, 3, 5),
      rng(), warpRoll(p, rng, 0.5));
    for (let i = -1; i <= 1; i++) {
      const digit = new THREE.Mesh(fingerGeo, mats.trim);
      digit.rotation.z = i * 0.2;
      digit.rotation.x = 0.1;
      digit.position.set(i * limbR * 0.55, -limbR * 0.8 - fingerLen * 0.5, limbR * 0.1);
      withOutline(frame, digit, fingerGeo, ink * 0.6, mats.outline);
    }
    return;
  }

  // claws and pincers are cones fanned around the tip
  const fingers = p.handType === 'pincer' ? 2 : 3;
  const fingerGeo = warpGeometry(
    new THREE.ConeGeometry(limbR * 0.5, limbR * (p.handType === 'pincer' ? 3.8 : 2.9), 5, 3),
    rng(), warpRoll(p, rng, 0.7));
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
    // Mirrored, like every other joint on this creature: unsigned, both
    // forearms kicked the same way in world space, so one folded in over its
    // own chest while the other swung out. The sign is `+side` and not `-side`
    // — the shoulder above has already been turned by `side * splay`, so the
    // elbow inherits the mirroring once and must not undo it. Getting that
    // backwards points both forearms at the midline; the limb sweep says so
    // immediately, with 56 arm crossings where there had been none.
    elbow.rotation.z = side * 0.3;
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

  if (p.armType === 'tentacle') {
    // a tapering curl: three capsule segments, each thinner and kicked a
    // little further forward — chained groups, like the mantis elbow
    const segLens = [len * 0.42, len * 0.34, len * 0.28];
    const radii = [0.95, 0.62, 0.38];
    const chain = [];
    let node = parent;
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      if (i > 0) {
        g.position.y = -segLens[i - 1];
        g.rotation.x = -0.55;             // curl forward
        g.rotation.z = side * 0.16;       // ...and a touch outward
      }
      node.add(g);
      const geo = new THREE.CapsuleGeometry(limbR * radii[i], segLens[i], 3, 6);
      const seg = new THREE.Mesh(geo, mats.body);
      seg.position.y = -segLens[i] * 0.5;
      withOutline(g, seg, geo, ink * (1 - i * 0.25), mats.outline);
      g.updateMatrix();
      chain.push(g);
      node = g;
    }
    // fold the chain to get the tip and its direction in shoulder space
    tip.set(0, -segLens[2] - limbR * 0.3, 0);
    dir.set(0, -1, 0);
    for (let i = chain.length - 1; i >= 0; i--) {
      tip.applyMatrix4(chain[i].matrix);
      dir.applyQuaternion(chain[i].quaternion);
    }
    return { tip, dir };
  }

  if (p.armType === 'wing') {
    // three bony spars fanned down-and-out with a membrane stretched between
    // them — a bat wing that has seen better days
    const sparLens = [len * 0.95, len * 0.72, len * 0.48];
    const angles = [0.12, 0.5, 0.88];   // from straight down, opening outward
    const tips = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.rotation.z = side * angles[i];
      parent.add(g);
      const geo = new THREE.CapsuleGeometry(limbR * (0.42 - i * 0.06), sparLens[i], 3, 5);
      const spar = new THREE.Mesh(geo, mats.body);
      spar.position.y = -sparLens[i] * 0.5;
      withOutline(g, spar, geo, ink * 0.7, mats.outline);
      // R_z(side*a) applied to (0, -L, 0)
      tips.push(new THREE.Vector3(
        side * Math.sin(angles[i]) * sparLens[i],
        -Math.cos(angles[i]) * sparLens[i],
        0,
      ));
    }
    // the membrane: a fan of two triangles pinned at the shoulder. Slightly
    // behind the spars so it never z-fights them.
    const verts = new Float32Array([
      0, 0, -limbR * 0.1, tips[0].x, tips[0].y, -limbR * 0.1, tips[1].x, tips[1].y, -limbR * 0.1,
      0, 0, -limbR * 0.1, tips[1].x, tips[1].y, -limbR * 0.1, tips[2].x, tips[2].y, -limbR * 0.1,
    ]);
    const memGeo = new THREE.BufferGeometry();
    memGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    memGeo.computeVertexNormals();
    // the shared toon material is single-sided; the membrane is a sheet seen
    // from both, so it gets its own two-sided copy (dispose() collects it)
    const memMat = mats.body.clone();
    memMat.side = THREE.DoubleSide;
    parent.add(new THREE.Mesh(memGeo, memMat));

    tip.copy(tips[0]).addScaledVector(new THREE.Vector3(side * Math.sin(angles[0]), -Math.cos(angles[0]), 0), limbR * 0.3);
    dir.set(side * Math.sin(angles[0]), -Math.cos(angles[0]), 0);
    return { tip, dir };
  }

  if (p.armType === 'branch') {
    // one bough that forks into two twigs at a knot
    const mainLen = len * 0.55;
    const mainGeo = new THREE.CapsuleGeometry(limbR * 0.8, mainLen, 3, 6);
    const bough = new THREE.Mesh(mainGeo, mats.body);
    bough.position.y = -mainLen * 0.5;
    withOutline(parent, bough, mainGeo, ink, mats.outline);

    const fork = new THREE.Group();
    fork.position.y = -mainLen;
    parent.add(fork);
    const twigLens = [len * 0.48, len * 0.36];
    const twigRots = [
      { z: side * 0.38, x: 0.12 },
      { z: side * -0.32, x: -0.2 },
    ];
    let mainTwig = null;
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      g.rotation.z = twigRots[i].z;
      g.rotation.x = twigRots[i].x;
      fork.add(g);
      const geo = new THREE.CapsuleGeometry(limbR * (0.5 - i * 0.08), twigLens[i], 3, 5);
      const twig = new THREE.Mesh(geo, mats.body);
      twig.position.y = -twigLens[i] * 0.5;
      withOutline(g, twig, geo, ink * 0.7, mats.outline);
      g.updateMatrix();
      if (i === 0) mainTwig = g;
    }
    // the hand rides the longer twig
    fork.updateMatrix();
    tip.set(0, -twigLens[0] - limbR * 0.3, 0).applyMatrix4(mainTwig.matrix).applyMatrix4(fork.matrix);
    dir.set(0, -1, 0).applyQuaternion(mainTwig.quaternion);
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
  shoulder.userData.part = 'arm';
  shoulder.position.set(side * shoulderX, shoulderY, shoulderZ);
  const { tip, dir } = addSegments(shoulder, p, mats, { limbR, ink, len, side });
  addHand(shoulder, p, mats, rng, { limbR, ink, tip, dir });

  // lift swings the arm forward or back; the wobble keeps the sides apart
  shoulder.rotation.x = -p.armLift * 0.7 + wonk * 0.2;

  // The arm is fitted to clear the floor with a margin, not to touch it. The
  // animator's idle lag swings the limb by a fifth of a radian on its own, and
  // an arm built resting exactly on the ground dips through it every cycle.
  //
  // Part of that margin has to scale with the shoulder rather than the limb: a
  // tired creature leans and squashes for as long as the mood lasts, and both
  // of those drop the shoulder by a fraction of its own height, carrying the
  // whole arm down with it. A margin measured only in limb radii covers a fat
  // arm and leaves a thin one on a tall body scraping the ground.
  //
  // And part of it with how far FORWARD the tip sits: the same tired lean
  // pitches the whole body, and a point out in front of the chest drops by its
  // forward reach times the pitch — which is what put a curled tentacle's tip
  // through the floor while every straight arm cleared it.
  const clearance = limbR * 0.9 + shoulderY * 0.12 + Math.max(0, tip.z) * 0.25;

  // Opening the arm outward is the cheap way to hold a hand off the floor, and
  // it was allowed to run to 1.5 radians — 86 degrees, an arm pointing straight
  // out sideways. A freak in a T-pose does not read as a freak with long arms,
  // it reads as a rig that failed to load.
  //
  // The limit has to be on where the HAND ends up, not on the shoulder's angle:
  // a noodle curls a third of its own length outward and a mantis kicks its
  // forearm forward, so those two reach sideways well past whatever the pivot
  // was turned by. Solve for the widest splay whose hand is still inside 60
  // degrees of straight down, and let the shrink below take whatever is left —
  // a slightly shorter arm is a proportion, an arm out sideways is a bug.
  let splayCap = 0;
  for (let a = 1.2; a >= -0.001; a -= 0.08) {
    shoulder.rotation.z = side * Math.max(0, a);
    if (armLean(shoulder, tip) <= MAX_LEAN) { splayCap = Math.max(0, a); break; }
  }
  let splay = Math.min(splayCap, 0.32 + stance * 0.4 + Math.abs(wonk) * 0.3);
  for (let i = 0; i < 14; i++) {
    shoulder.rotation.z = side * splay;
    if (lowestPoint(shoulder) >= clearance || splay >= splayCap) break;
    splay = Math.min(splayCap, splay + 0.12);
  }

  // Still scraping the floor (a long arm on a tiny body): shrink to fit.
  // Re-measured each pass — a claw's cone tip and a club's squashed palm do not
  // shrink exactly in step with the arm, so one analytic step lands short.
  for (let i = 0; i < 4; i++) {
    const lo = lowestPoint(shoulder);
    if (lo >= clearance || shoulderY <= 0) break;
    const k = Math.max(0.15, ((shoulderY - clearance) / (shoulderY - lo)) * 0.96);
    shoulder.scale.multiplyScalar(k);
  }

  // How far the arm may swing back in towards the body. Two different limits
  // meet here: the midline (never cross the chest) and the floor. Most of the
  // splay above exists to hold a long arm up, so an action that tucks the arm
  // in — a scratch, a hug — would spend exactly that clearance and drive the
  // hand through the ground. Measure what is actually spare.
  //
  // Against the same margin the splay was fitted to, not against the floor
  // itself: the animator adds a lift on top of the swing, and a budget that
  // puts the hand exactly on the ground at full tuck has nothing left for it.
  const midline = limbR * 0.35;
  let tuck = 0;
  for (let d = 0.08; d <= splay - 0.05; d += 0.08) {
    shoulder.rotation.z = side * (splay - d);
    if (lowestPoint(shoulder) < clearance * 0.5) break;
    if (innerReach(shoulder, side) < midline) break;
    tuck = d;
  }

  // And how far it may swing forward or back. Lift turns the arm about its own
  // X axis, which the splay has already tilted outward — so the further it
  // swings the less of that splay is left holding the hand out from the body,
  // and at a quarter turn none of it is. A fixed cap works for a freak with
  // room to spare and lets a narrow one wave its two hands through each other.
  // Measured from the tucked pose, which is the least room the gesture will
  // ever have.
  const baseX = shoulder.rotation.x;
  shoulder.rotation.z = side * (splay - tuck);
  // Every value this returns is one that was actually tried. It used to start
  // at a fifth of a radian on the grounds that so little must be inside the
  // slack the fitting above left — and on a long-armed freak it is not: the
  // budget said 0.20, the animator spent exactly 0.20, and the hand went a
  // seventh of a head-height below the feet. An unverified floor is not a
  // floor, it is a guess with a number on it.
  const baseY = shoulder.rotation.y;
  const scanLift = () => {
    let best = 0;
    for (let a = 0.1; a <= 1.4001; a += (a < 0.4 ? 0.1 : 0.2)) {
      let ok = true;
      // Both directions of lift, and at each of them both extremes of the twist
      // the animator is allowed. Measuring one axis at a time is measuring a
      // pose the gesture never strikes: a scratch spends its lift, its tuck and
      // its twist at the same instant, and the hand then reaches somewhere none
      // of the three budgets was ever asked about.
      for (const dir of [1, -1]) {
        for (const w of [0, 0.5, -0.5]) {
          shoulder.rotation.x = baseX + dir * a;
          shoulder.rotation.y = baseY + w;
          if (innerReach(shoulder, side) < midline || lowestPoint(shoulder) < 0) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (!ok) break;
      best = a;
    }
    shoulder.rotation.x = baseX;
    shoulder.rotation.y = baseY;
    return best;
  };

  let lift = scanLift();
  // An arm with no budget at all is an arm that cannot move, and a creature
  // with two of those reads as a statue with a face. Rather than let it sit
  // rigid, take length off it until it has room: a slightly shorter arm is a
  // proportion, an arm nailed to the body is a missing animation.
  for (let i = 0; i < 4 && lift < 0.2; i++) {
    shoulder.scale.multiplyScalar(0.9);
    lift = scanLift();
  }
  shoulder.rotation.z = side * splay;

  // the animator lifts and swings this arm; it needs to know how much splay it
  // may spend before the limb would cross the midline
  shoulder.userData.splay = splay;
  shoulder.userData.tuck = tuck;
  shoulder.userData.lift = lift;
  shoulder.userData.side = side;
  return shoulder;
}
