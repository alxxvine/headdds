import * as THREE from 'three';
import { surfaceAt, surfaceByDir, orientTo, decalGeometry } from './surface.js';
import { withOutline } from './materials.js';
import { addHair } from './hair.js';

// Feature sizes are expressed in "head units" so that an eye stays an eye
// both on a squashed pancake and on a long cucumber.
export const headUnit = (p) => (p.headWidth + p.headHeight) * 0.5;

// ----------------------------------------------------------------- EYES ----

function eyePositions(p, rng) {
  const n = p.eyeCount;
  if (n <= 0) return [];
  const sx = p.eyeSpread * p.headWidth;
  const cy = p.eyeY * p.headHeight * 0.7;
  if (n === 1) return [[0, cy]];

  const out = [];
  switch (p.eyeLayout) {
    case 'ring':
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.PI / 2;
        out.push([Math.cos(a) * sx, cy + Math.sin(a) * sx * 0.8]);
      }
      break;
    case 'column':
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) - 0.5;
        out.push([t * sx * 0.25, cy - t * sx * 1.7]);
      }
      break;
    case 'cluster':
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng());
        out.push([Math.cos(a) * r * sx, cy + Math.sin(a) * r * sx * 0.85]);
      }
      break;
    case 'scatter':
      for (let i = 0; i < n; i++) {
        out.push([(rng() * 2 - 1) * p.headWidth * 0.72, (rng() * 1.3 - 0.3) * p.headHeight * 0.6]);
      }
      break;
    default: // row
      for (let i = 0; i < n; i++) {
        const x = ((i / (n - 1)) * 2 - 1) * sx;
        out.push([x, cy + x * p.eyeTilt]);
      }
  }
  return out;
}

/**
 * The pupil, sitting on the front of an eyeball of radius `size`.
 * Shapes are built from primitives rather than textures: at this resolution a
 * squashed capsule reads as a slit and a torus reads as a ring.
 */
function addPupil(pivot, p, mats, size) {
  if (p.pupilShape === 'blind') return;

  const r = size * 0.52 * p.pupilSize + size * 0.08;
  const z = size * 0.82;
  const put = (geo, rot) => {
    const m = new THREE.Mesh(geo, mats.pupil);
    m.position.set(0, 0, z);
    if (rot !== undefined) m.rotation.z = rot;
    pivot.add(m);
    return m;
  };

  if (p.pupilShape === 'slit' || p.pupilShape === 'goat') {
    const bar = new THREE.CapsuleGeometry(r * 0.42, size * 1.15, 2, 6);
    const m = put(bar, p.pupilShape === 'goat' ? Math.PI / 2 : 0);
    m.scale.z = 0.4;
    return;
  }
  if (p.pupilShape === 'cross') {
    const bar = new THREE.CapsuleGeometry(r * 0.34, size * 1.1, 2, 6);
    put(bar, 0).scale.z = 0.4;
    put(bar, Math.PI / 2).scale.z = 0.4;
    return;
  }
  if (p.pupilShape === 'ring') {
    const ring = new THREE.TorusGeometry(r * 0.9, r * 0.32, 5, 12);
    put(ring).scale.z = 0.5;
    return;
  }
  put(new THREE.SphereGeometry(r, 10, 8));
}

/** A heavy lid dropping over the top of the eye. */
function addLid(pivot, p, mats, size, S) {
  if (p.eyeLid <= 0.02) return;
  const lidGeo = new THREE.SphereGeometry(size * 1.06, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
  const lid = new THREE.Mesh(lidGeo, mats.skin);
  // rotate the cap down over the eyeball; a full lid covers just past halfway
  lid.rotation.x = Math.PI * (0.5 - 0.42 * p.eyeLid);
  withOutline(pivot, lid, lidGeo, p.outline * 0.35 * S, mats.outline);
}

/**
 * Every eye lives in its own pivot group: the eyeball, its outline shell, the
 * pupil and the lid are children, so blinking and looking around move them
 * together. The outline is a separate mesh (see withOutline), so animating a
 * bare eyeball would leave its own outline behind.
 * Stalk eyes get a second pivot at the root of the stalk for the animator.
 * Returns the pivots so the animator can drive them.
 */
export function addEyes(parent, headMesh, p, mats, rng) {
  const S = headUnit(p);
  const baseSize = p.eyeSize * S;
  // Keep eyes out of the maw: "cluster" and "scatter" otherwise plant an
  // eyeball straight into the teeth on a regular basis.
  const mouthTop = p.mouthY * p.headHeight * 0.8 + p.mouthOpen * p.headHeight * 0.72;
  const positions = eyePositions(p, rng).map(([x, y]) => [x, Math.max(y, mouthTop + baseSize * 0.9)]);
  const eyes = [];

  for (const [x0, y0] of positions) {
    // no two eyes are quite the same once jitter is up
    const size = baseSize * (1 + (rng() * 2 - 1) * p.eyeJitter * 0.55);
    // lopsidedness slides each eye off its neat layout slot
    const x = x0 + (rng() * 2 - 1) * p.lopsided * p.headWidth * 0.16;
    const y = y0 + (rng() * 2 - 1) * p.lopsided * p.headHeight * 0.13;
    const hit = surfaceAt(headMesh, p, x, y);
    const pivot = new THREE.Group();
    let stalk = null;

    if (p.eyeStyle === 'hole') {
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size, ry: size * 1.15, offset: 0.01, rings: 2, segs: 16,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));

      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, size * 0.18), hit.normal);
      pivot.add(new THREE.Mesh(new THREE.SphereGeometry(size * 0.34 * (0.5 + p.pupilSize), 8, 6), mats.eye));
    } else if (p.eyeStyle === 'bead') {
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.25, ry: size * 1.25, offset: 0.008, rings: 2, segs: 16,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));

      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, size * 0.3 * p.eyeBulge), hit.normal);
      const beadGeo = new THREE.SphereGeometry(size * 0.55, 10, 8);
      withOutline(pivot, new THREE.Mesh(beadGeo, mats.pupil), beadGeo, p.outline * 0.6 * S, mats.outline);
    } else if (p.eyeStyle === 'stalk') {
      // the eyeball rides at the end of a stalk growing out of the skull
      const len = size * (2.2 + p.eyeBulge * 2.6);
      stalk = new THREE.Group();
      orientTo(stalk, hit.point, hit.normal);
      parent.add(stalk);

      const stalkGeo = new THREE.CylinderGeometry(size * 0.22, size * 0.3, len, 5);
      const tube = new THREE.Mesh(stalkGeo, mats.growth);
      tube.rotation.x = Math.PI / 2; // grow along the stalk's +Z
      tube.position.set(0, 0, len * 0.5);
      withOutline(stalk, tube, stalkGeo, p.outline * 0.4 * S, mats.outline);

      pivot.position.set(0, 0, len);
      stalk.add(pivot);

      const ballGeo = new THREE.SphereGeometry(size * 0.8, 12, 10);
      withOutline(pivot, new THREE.Mesh(ballGeo, mats.eye), ballGeo, p.outline * 0.6 * S, mats.outline);
      addPupil(pivot, p, mats, size * 0.8);
      addLid(pivot, p, mats, size * 0.8, S);

      eyes.push({ pivot, stalk, kind: 'stalk', base: pivot.position.clone(), size: size * 0.8 });
      continue;
    } else {
      // ball: sunk into the socket by (1 - bulge)
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, size * (p.eyeBulge - 0.62)), hit.normal);

      const ballGeo = new THREE.SphereGeometry(size, 12, 10);
      withOutline(pivot, new THREE.Mesh(ballGeo, mats.eye), ballGeo, p.outline * 0.7 * S, mats.outline);
      addPupil(pivot, p, mats, size);
      addLid(pivot, p, mats, size, S);
    }

    parent.add(pivot);
    eyes.push({ pivot, stalk, kind: p.eyeStyle, base: pivot.position.clone(), size });
  }

  return eyes;
}

// ------------------------------------------------------------------ MAW ----

function addTeeth(parent, headMesh, p, mats, rng, { mw, mh, my, mx = 0, side, count }) {
  if (count <= 0) return;
  const S = headUnit(p);

  for (let i = 0; i < count; i++) {
    // wear knocks teeth out of the row
    if (rng() < p.wear * 0.35) continue;
    const t = ((i + 0.5) / count) * 2 - 1;
    const u = mx + t * mw * 0.94;
    // the maw's ellipse edge at this point — that is where the tooth grows
    const edge = mh * Math.sqrt(Math.max(0.1, 1 - Math.min(1, ((u - mx) / (mw * 0.99)) ** 2)));
    const hit = surfaceAt(headMesh, p, u, my + side * edge * 0.94);

    const w = ((2 * mw) / count) * (1 - p.toothGap) * 0.92;
    const len = mh * (0.7 + 1.7 * p.toothSize) * (0.72 + rng() * 0.56);
    const tip = w * 0.5 * (1 - 0.9 * p.toothJag);
    // a fang grows tip-first from the rim: the narrow end points into the maw
    const geo = side > 0
      ? new THREE.CylinderGeometry(w * 0.5, tip, len, 5)
      : new THREE.CylinderGeometry(tip, w * 0.5, len, 5);

    const frame = new THREE.Group();
    orientTo(frame, hit.point, hit.normal);
    const tooth = new THREE.Mesh(geo, mats.tooth);
    tooth.position.set(0, -side * len * 0.45, 0.02 * S);
    tooth.scale.z = 0.7;
    withOutline(frame, tooth, geo, p.outline * 0.45 * S, mats.outline);
    // The jaw group hangs at the hinge, so its children are stored relative
    // to it — otherwise chewing would swing them around the head's origin.
    frame.position.sub(parent.position);
    parent.add(frame);
  }
}

export function addMouth(parent, headMesh, p, mats, rng) {
  const mw = p.mouthWidth * p.headWidth;
  const mh = Math.max(0.03, p.mouthOpen * p.headHeight * 0.55);
  // a crooked maw sits off centre and off level
  const skew = (rng() * 2 - 1) * p.lopsided;
  const my = p.mouthY * p.headHeight * 0.8 + skew * p.headHeight * 0.06;
  const mx = skew * p.headWidth * 0.1;

  if (p.lips > 0.01) {
    const grow = 1 + p.lips;
    const lips = decalGeometry(headMesh, p, {
      cx: mx, cy: my, rx: mw * grow, ry: mh * grow * 1.25,
      inner: 1 / grow, offset: 0.006, rings: 2, segs: 26,
    });
    parent.add(new THREE.Mesh(lips, mats.lip));
  }

  const cavity = decalGeometry(headMesh, p, {
    cx: mx, cy: my, rx: mw, ry: mh, offset: 0.014, rings: 3, segs: 26,
  });
  parent.add(new THREE.Mesh(cavity, mats.cavity));

  // The cavity and the lips are decals glued to the skull — moving them would
  // peel them off. Only the lower row of teeth swings, on a hinge sitting
  // behind and below the maw.
  const jaw = new THREE.Group();
  jaw.position.set(mx, my - mh * 0.2, -p.headDepth * 0.35);
  parent.add(jaw);

  addTeeth(parent, headMesh, p, mats, rng, { mw, mh, my, mx, side: 1, count: p.teethTop });
  addTeeth(jaw, headMesh, p, mats, rng, { mw, mh, my, mx, side: -1, count: p.teethBottom });

  return { jaw };
}

// ----------------------------------------------------------------- NOSE ----

export function addNose(parent, headMesh, p, mats) {
  if (p.noseType === 'none') return;
  const S = headUnit(p);
  const ny = p.noseY * p.headHeight * 0.7;
  const size = p.noseSize * S;

  if (p.noseType === 'holes') {
    for (const dx of [-1, 1]) {
      const hole = decalGeometry(headMesh, p, {
        cx: dx * size * 0.7, cy: ny, rx: size * 0.42, ry: size * 0.62, offset: 0.008, rings: 2, segs: 12,
      });
      parent.add(new THREE.Mesh(hole, mats.cavity));
    }
    return;
  }

  const hit = surfaceAt(headMesh, p, 0, ny);
  const frame = new THREE.Group();
  orientTo(frame, hit.point, hit.normal);

  let geo;
  let mesh;
  if (p.noseType === 'beak') {
    geo = new THREE.ConeGeometry(size * 0.6, size * 2.6, 6);
    mesh = new THREE.Mesh(geo, mats.skin);
    mesh.rotation.x = Math.PI / 2; // tip along the normal
    mesh.position.set(0, 0, size * 0.9);
  } else if (p.noseType === 'snout') {
    geo = new THREE.SphereGeometry(size, 10, 8);
    mesh = new THREE.Mesh(geo, mats.skin);
    mesh.scale.set(1, 0.75, 1.9);
    mesh.position.set(0, 0, size * 0.45);
  } else {
    geo = new THREE.SphereGeometry(size, 10, 8);
    mesh = new THREE.Mesh(geo, mats.skin);
    mesh.scale.set(1, 1.25, 0.85);
    mesh.position.set(0, 0, -size * 0.15);
  }
  withOutline(frame, mesh, geo, p.outline * 0.7 * S, mats.outline);

  if (p.noseType !== 'beak') {
    for (const dx of [-1, 1]) {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(size * 0.22, 6, 5), mats.cavity);
      nostril.position.set(dx * size * 0.42, -size * 0.3, size * (p.noseType === 'snout' ? 1.3 : 0.55));
      frame.add(nostril);
    }
  }
  parent.add(frame);
}

// ---------------------------------------------------------------- SCARS ----

/**
 * Old damage: a line of small dark patches across the face. decalGeometry only
 * makes axis-aligned ellipses, so a slash is stitched from overlapping dots —
 * which at this resolution reads more like a scar than a clean ellipse would.
 */
export function addScars(parent, headMesh, p, mats, rng) {
  if (p.wear < 0.25) return;
  const S = headUnit(p);
  const scars = 1 + (rng() < p.wear - 0.45 ? 1 : 0);

  for (let n = 0; n < scars; n++) {
    const angle = (rng() * 2 - 1) * 1.1;
    const len = (0.35 + rng() * 0.5) * p.headHeight;
    const cx = (rng() * 2 - 1) * p.headWidth * 0.45;
    const cy = (rng() * 2 - 1) * p.headHeight * 0.3;
    const dots = 6;
    for (let i = 0; i < dots; i++) {
      const t = (i / (dots - 1) - 0.5) * len;
      const geo = decalGeometry(headMesh, p, {
        cx: cx + Math.sin(angle) * t,
        cy: cy + Math.cos(angle) * t,
        rx: S * 0.035,
        ry: S * 0.035,
        offset: 0.016,
        rings: 1,
        segs: 8,
      });
      parent.add(new THREE.Mesh(geo, mats.socket));
    }
  }
}

// -------------------------------------------------------------- GROWTHS ----

function randomDir(rng, v = new THREE.Vector3()) {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return v.set(Math.cos(a) * r, z, Math.sin(a) * r);
}

export function addGrowths(parent, headMesh, p, mats, rng) {
  const S = headUnit(p);
  const dir = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();

  // warts are instanced so that 40 of them cost a single draw call
  if (p.warts > 0) {
    const geo = new THREE.IcosahedronGeometry(p.wartSize * S, 0);
    const inst = new THREE.InstancedMesh(geo, mats.growth, p.warts);
    for (let i = 0; i < p.warts; i++) {
      // do not plant growths straight into the maw
      for (let tries = 0; tries < 8; tries++) {
        randomDir(rng, dir);
        if (!(dir.z > 0.5 && Math.abs(dir.y - p.mouthY * 0.8) < 0.35)) break;
      }
      const hit = surfaceByDir(p, dir.x, dir.y, dir.z);
      const s = 0.55 + rng() * 1.1;
      scl.set(s, s, s * 0.8);
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
      m4.compose(hit.point.addScaledVector(hit.normal, p.wartSize * S * 0.25), q, scl);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    parent.add(inst);
  }

  // horns grow in symmetric pairs across the crown
  for (let i = 0; i < p.horns; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const idx = Math.floor(i / 2);
    dir.set(side * (0.3 + idx * 0.28), 1 - idx * 0.22, -0.12 + idx * 0.1).normalize();
    const hit = surfaceByDir(p, dir.x, dir.y, dir.z);
    // a broken horn is a stump with a flat top
    const broken = rng() < p.wear * 0.45;
    const len = p.hornLen * S * (0.7 + rng() * 0.5) * (broken ? 0.35 : 1) * (1 + (rng() * 2 - 1) * p.lopsided * 0.4);
    const geo = broken
      ? new THREE.CylinderGeometry(S * 0.055, S * 0.085, len, 5)
      : new THREE.ConeGeometry(S * 0.085, len, 5);
    const frame = new THREE.Group();
    orientTo(frame, hit.point, hit.normal);
    const horn = new THREE.Mesh(geo, mats.growth);
    horn.rotation.x = Math.PI / 2;
    horn.position.set(0, 0, len * 0.42);
    withOutline(frame, horn, geo, p.outline * 0.6 * S, mats.outline);
    parent.add(frame);
  }

  // hair of whatever kind lives in hair.js
  const tendrils = addHair(parent, p, mats, rng, S);

  // spore cloud above the skull, in a group of its own so it can drift
  let spores = null;
  if (p.spores > 0) {
    const geo = new THREE.BoxGeometry(S * 0.035, S * 0.035, S * 0.035);
    const inst = new THREE.InstancedMesh(geo, mats.growth, p.spores);
    const top = p.headHeight * 1.02;
    for (let i = 0; i < p.spores; i++) {
      const t = rng();
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * (0.08 + t * 0.75) * S;
      const s = 0.5 + rng() * 1.2;
      scl.set(s, s, s);
      q.setFromAxisAngle(dir.set(rng(), rng(), rng()).normalize(), rng() * Math.PI);
      m4.compose(
        new THREE.Vector3(Math.cos(a) * r, top + t * S * 1.1, Math.sin(a) * r),
        q,
        scl,
      );
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    spores = new THREE.Group();
    spores.add(inst);
    parent.add(spores);
  }

  return { tendrils, spores };
}
