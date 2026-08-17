import * as THREE from 'three';
import { surfaceAt, surfaceByDir, orientTo, decalGeometry } from './surface.js';
import { withOutline } from './materials.js';

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

export function addEyes(parent, headMesh, p, mats, rng) {
  const S = headUnit(p);
  const size = p.eyeSize * S;
  // Keep eyes out of the maw: "cluster" and "scatter" otherwise plant an
  // eyeball straight into the teeth on a regular basis.
  const mouthTop = p.mouthY * p.headHeight * 0.8 + p.mouthOpen * p.headHeight * 0.72;
  const positions = eyePositions(p, rng).map(([x, y]) => [x, Math.max(y, mouthTop + size * 0.9)]);

  for (const [x, y] of positions) {
    const hit = surfaceAt(headMesh, p, x, y);

    if (p.eyeStyle === 'hole') {
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size, ry: size * 1.15, offset: 0.01, rings: 2, segs: 16,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(size * 0.34 * (0.5 + p.pupilSize), 8, 6), mats.eye);
      dot.position.copy(hit.point).addScaledVector(hit.normal, size * 0.18);
      parent.add(dot);
      continue;
    }

    if (p.eyeStyle === 'bead') {
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.25, ry: size * 1.25, offset: 0.008, rings: 2, segs: 16,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));
      const bead = new THREE.Mesh(new THREE.SphereGeometry(size * 0.55, 10, 8), mats.pupil);
      bead.position.copy(hit.point).addScaledVector(hit.normal, size * 0.3 * p.eyeBulge);
      withOutline(parent, bead, bead.geometry, p.outline * 0.6 * S, mats.outline);
      continue;
    }

    // ball: sunk into the socket by (1 - bulge)
    const ballGeo = new THREE.SphereGeometry(size, 12, 10);
    const ball = new THREE.Mesh(ballGeo, mats.eye);
    ball.position.copy(hit.point).addScaledVector(hit.normal, size * (p.eyeBulge - 0.62));
    withOutline(parent, ball, ballGeo, p.outline * 0.7 * S, mats.outline);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(size * 0.52 * p.pupilSize + size * 0.08, 10, 8), mats.pupil);
    pupil.position.copy(ball.position).addScaledVector(hit.normal, size * 0.82);
    parent.add(pupil);
  }
}

// ------------------------------------------------------------------ MAW ----

function addTeeth(parent, headMesh, p, mats, rng, { mw, mh, my, side, count }) {
  if (count <= 0) return;
  const S = headUnit(p);

  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) / count) * 2 - 1;
    const u = t * mw * 0.94;
    // the maw's ellipse edge at this point — that is where the tooth grows
    const edge = mh * Math.sqrt(Math.max(0.1, 1 - Math.min(1, (u / (mw * 0.99)) ** 2)));
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
    parent.add(frame);
  }
}

export function addMouth(parent, headMesh, p, mats, rng) {
  const mw = p.mouthWidth * p.headWidth;
  const mh = Math.max(0.03, p.mouthOpen * p.headHeight * 0.55);
  const my = p.mouthY * p.headHeight * 0.8;

  if (p.lips > 0.01) {
    const grow = 1 + p.lips;
    const lips = decalGeometry(headMesh, p, {
      cx: 0, cy: my, rx: mw * grow, ry: mh * grow * 1.25,
      inner: 1 / grow, offset: 0.006, rings: 2, segs: 26,
    });
    parent.add(new THREE.Mesh(lips, mats.lip));
  }

  const cavity = decalGeometry(headMesh, p, {
    cx: 0, cy: my, rx: mw, ry: mh, offset: 0.014, rings: 3, segs: 26,
  });
  parent.add(new THREE.Mesh(cavity, mats.cavity));

  addTeeth(parent, headMesh, p, mats, rng, { mw, mh, my, side: 1, count: p.teethTop });
  addTeeth(parent, headMesh, p, mats, rng, { mw, mh, my, side: -1, count: p.teethBottom });
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
    const len = p.hornLen * S * (0.7 + rng() * 0.5);
    const geo = new THREE.ConeGeometry(S * 0.085, len, 5);
    const frame = new THREE.Group();
    orientTo(frame, hit.point, hit.normal);
    const horn = new THREE.Mesh(geo, mats.growth);
    horn.rotation.x = Math.PI / 2;
    horn.position.set(0, 0, len * 0.42);
    withOutline(frame, horn, geo, p.outline * 0.6 * S, mats.outline);
    parent.add(frame);
  }

  // tendrils are curved tubes sprouting from the crown
  for (let i = 0; i < p.tendrils; i++) {
    const a = (i / Math.max(1, p.tendrils)) * Math.PI * 2;
    const spread = 0.25 + rng() * 0.45;
    dir.set(Math.cos(a) * spread, 1, Math.sin(a) * spread).normalize();
    const hit = surfaceByDir(p, dir.x, dir.y, dir.z);
    const len = p.tendrilLen * S * (0.6 + rng() * 0.8);
    const bend = new THREE.Vector3((rng() - 0.5) * len * 0.9, 0, (rng() - 0.5) * len * 0.9);
    const pts = [0, 0.35, 0.7, 1].map((t) =>
      hit.point.clone()
        .addScaledVector(hit.normal, len * t)
        .addScaledVector(bend, t * t),
    );
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, S * 0.028, 4, false);
    parent.add(new THREE.Mesh(geo, mats.growth));
  }

  // spore cloud above the skull
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
    parent.add(inst);
  }
}
