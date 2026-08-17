import * as THREE from 'three';
import { surfaceAt, surfaceByDir, orientTo, decalGeometry } from './surface.js';
import { withOutline } from './materials.js';
import { addHair } from './hair.js';
import { addEars } from './ears.js';

// Feature sizes are expressed in "head units" so that an eye stays an eye
// both on a squashed pancake and on a long cucumber.
export const headUnit = (p) => (p.headWidth + p.headHeight) * 0.5;

/**
 * Where the big features sit on the face, in the frontal coordinates every
 * placement uses. Eyes, nose and maw are built by three separate functions and
 * each used to place itself as if it were alone on the skull, which is how a
 * nose ends up inside the maw and an eye ends up wearing the nose. They all
 * read these limits now, so they agree.
 *
 * The overlaps are not forbidden outright — a freak whose eye crowds its nose
 * is a good freak — only kept from landing one part fully inside another.
 */
export function faceLimits(p) {
  const S = headUnit(p);
  // the top rim of the maw, opening included
  const mouthTop = p.mouthY * p.headHeight * 0.8 + p.mouthOpen * p.headHeight * 0.72;
  const noseSize = p.noseSize * S;
  const noseY = p.noseType === 'none' ? -99
    : Math.max(p.noseY * p.headHeight * 0.7, mouthTop + noseSize * 1.15);
  return {
    S,
    mouthTop,
    noseSize,
    noseY,
    // how much room the nose takes on the face, for whatever has to dodge it
    noseHalfW: noseSize * (p.noseType === 'pig' ? 1.5 : p.noseType === 'tusks' ? 1.6 : 1.1),
    noseTop: noseY + noseSize * (p.noseType === 'beak' ? 0.8 : 1.0),
  };
}

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
// the pupil helper has no rng of its own and does not need a good one: this is
// only here to keep a square pupil from sitting perfectly straight
let rollState = 1;
const rngRoll = () => { rollState = (rollState * 48271) % 2147483647; return rollState / 2147483647; };

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
  if (p.pupilShape === 'square') {
    put(new THREE.BoxGeometry(r * 1.5, r * 1.5, r * 0.5), (rngRoll() - 0.5) * 0.5);
    return;
  }
  if (p.pupilShape === 'double') {
    // two of them, side by side — the eye never quite looks at you
    for (const dx of [-1, 1]) {
      const m = put(new THREE.SphereGeometry(r * 0.62, 8, 6));
      m.position.x = dx * r * 0.7;
      m.position.z = z * 0.97;
    }
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
  const L = faceLimits(p);
  const S = L.S;
  const baseSize = p.eyeSize * S;
  // Keep eyes off the two things already on the face. "cluster" and "scatter"
  // otherwise plant an eyeball straight into the teeth on a regular basis, and
  // a low eye near the midline ends up sitting on the nose.
  // The clearance has to cover the eye's own radius, not just its centre: a
  // margin of less than one radius leaves the bottom of the eyeball sitting in
  // the teeth, which is what it looked like. Jitter can grow an eye by half
  // again, so the margin carries that too.
  const clear = baseSize * (1.35 + p.eyeJitter * 0.4);
  const positions = eyePositions(p, rng).map(([x, y]) => {
    let out = Math.max(y, L.mouthTop + clear);
    const onMidline = Math.abs(x) < L.noseHalfW + baseSize * 0.55;
    if (onMidline && out < L.noseTop + clear * 0.75) out = L.noseTop + clear * 0.75;
    return [x, out];
  });
  const eyes = [];

  for (const [x0, y0] of positions) {
    // No two eyes on one face are quite the same once mismatch is up — not just
    // in size, but in how far each one stands out and how wide its pupil is.
    // `q` is this eye's own copy of the parameters, handed to the helpers.
    const size = baseSize * (1 + (rng() * 2 - 1) * p.eyeJitter * 0.55);
    const bulge = THREE.MathUtils.clamp(p.eyeBulge + (rng() * 2 - 1) * p.eyeJitter * 0.35, 0, 1);
    const q = {
      ...p,
      eyeBulge: bulge,
      pupilSize: THREE.MathUtils.clamp(p.pupilSize * (1 + (rng() * 2 - 1) * p.eyeJitter * 0.5), 0.08, 0.98),
    };
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
      pivot.add(new THREE.Mesh(new THREE.SphereGeometry(size * 0.34 * (0.5 + q.pupilSize), 8, 6), mats.eye));
    } else if (p.eyeStyle === 'bead') {
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.25, ry: size * 1.25, offset: 0.008, rings: 2, segs: 16,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));

      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, size * 0.3 * bulge), hit.normal);
      const beadGeo = new THREE.SphereGeometry(size * 0.55, 10, 8);
      withOutline(pivot, new THREE.Mesh(beadGeo, mats.pupil), beadGeo, p.outline * 0.6 * S, mats.outline);
    } else if (p.eyeStyle === 'stalk') {
      // the eyeball rides at the end of a stalk growing out of the skull
      const len = size * (2.2 + bulge * 2.6);
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
      addPupil(pivot, q, mats, size * 0.8);
      addLid(pivot, q, mats, size * 0.8, S);

      eyes.push({ pivot, stalk, kind: 'stalk', base: pivot.position.clone(), size: size * 0.8 });
      continue;
    } else if (p.eyeStyle === 'compound') {
      // an insect's eye: a dark dome studded with facets, no pupil at all
      const rim = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.5, ry: size * 1.5, offset: 0.02, rings: 3, segs: 14,
      });
      parent.add(new THREE.Mesh(rim, mats.socket));
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, size * (bulge - 0.5)), hit.normal);
      const domeGeo = new THREE.SphereGeometry(size, 10, 8);
      withOutline(pivot, new THREE.Mesh(domeGeo, mats.pupil), domeGeo, p.outline * 0.7 * S, mats.outline);

      const facetGeo = new THREE.SphereGeometry(size * 0.26, 6, 5);
      const facets = new THREE.InstancedMesh(facetGeo, mats.eye, 14);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < 14; i++) {
        // a spiral over the front of the dome, so the facets never line up
        const k = (i + 0.5) / 14;
        const phi = Math.acos(1 - k * 0.75);
        const theta = i * 2.399; // the golden angle: an even scatter, no lattice
        m4.makeTranslation(
          Math.sin(phi) * Math.cos(theta) * size * 0.88,
          Math.sin(phi) * Math.sin(theta) * size * 0.88,
          Math.cos(phi) * size * 0.88,
        );
        facets.setMatrixAt(i, m4);
      }
      pivot.add(facets);
    } else if (p.eyeStyle === 'lantern') {
      // a glowing orb set back in a bony rim
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.15, ry: size * 1.15, offset: 0.008, rings: 2, segs: 16,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));

      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, size * 0.1), hit.normal);
      const rimGeo = new THREE.TorusGeometry(size * 0.92, size * 0.2, 5, 14);
      withOutline(pivot, new THREE.Mesh(rimGeo, mats.growth), rimGeo, p.outline * 0.4 * S, mats.outline);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(size * 0.62, 10, 8), mats.eye);
      orb.position.z = -size * 0.1;
      pivot.add(orb);
      addPupil(pivot, q, mats, size * 0.62);
    } else if (p.eyeStyle === 'gash') {
      // no eyeball: a torn slit with something wet showing through it
      const slit = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: size * 1.5, ry: size * 0.42, offset: 0.01, rings: 2, segs: 18,
      });
      parent.add(new THREE.Mesh(slit, mats.socket));

      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, size * 0.02), hit.normal);
      const barGeo = new THREE.CapsuleGeometry(size * 0.2, size * 1.9, 2, 6);
      const bar = new THREE.Mesh(barGeo, mats.eye);
      bar.rotation.z = Math.PI / 2;
      bar.scale.z = 0.35;
      pivot.add(bar);
      addPupil(pivot, q, mats, size * 0.45);
    } else {
      // A ring of darker skin around the eyeball. Without it a pale eye on a
      // pale face is a lump with a dot on it: the black outline is one pixel
      // wide at this resolution and cannot separate the two on its own. The
      // more the eye bulges, the wider the shadow it would cast.
      // A decal is a fan of concentric rings, each raycast onto the skull and
      // pushed out along its normal. Two rings is fine for a small patch and
      // useless for a wide one: the flat triangles between them cut inside the
      // curve of the skull and the middle of the ring is buried. Hence five
      // rings and a bigger lift.
      const r = size * (1.45 + bulge * 0.2);
      const socket = decalGeometry(headMesh, p, {
        cx: x, cy: y, rx: r, ry: r, offset: 0.02, rings: 3, segs: 14,
      });
      parent.add(new THREE.Mesh(socket, mats.socket));

      // ball: sunk into the socket by (1 - bulge)
      orientTo(pivot, hit.point.clone().addScaledVector(hit.normal, size * (bulge - 0.62)), hit.normal);

      const ballGeo = new THREE.SphereGeometry(size, 12, 10);
      withOutline(pivot, new THREE.Mesh(ballGeo, mats.eye), ballGeo, p.outline * 0.7 * S, mats.outline);
      addPupil(pivot, q, mats, size);
      addLid(pivot, q, mats, size, S);
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

    const w = ((2 * mw) / count) * (1 - p.toothGap) * 0.92
      * (1 + (rng() * 2 - 1) * p.toothVary * 0.3);
    // A row of identical spikes is what makes a maw look stamped out. `vary`
    // spreads the lengths — at the top of the slider one mouth holds anything
    // from a stub to a fang three times its neighbour.
    const vary = 1 + (rng() * 2 - 1) * p.toothVary * 0.85;
    let len = mh * (0.7 + 1.7 * p.toothSize) * Math.max(0.18, vary);
    if (rng() < p.toothVary * 0.22) len *= 0.35; // and a few barely came through
    const tip = w * 0.5 * (1 - 0.9 * p.toothJag);

    // A tooth grows tip-first from the rim: whatever the kind, the narrow end
    // has to point into the maw, which flips with the row.
    let geo;
    let flat = 0.7;
    let curl = 0;
    if (p.toothType === 'needles') {
      len *= 1.35;
      geo = new THREE.CylinderGeometry(w * 0.16, w * 0.05, len, 4);
      flat = 1;
    } else if (p.toothType === 'blocks') {
      len *= 0.55;
      geo = new THREE.BoxGeometry(w * 0.88, len, w * 0.8);
      flat = 1;
    } else if (p.toothType === 'tusks') {
      len *= 1.5;
      geo = new THREE.CylinderGeometry(w * 0.42, w * 0.1, len, 5);
      flat = 0.9;
      curl = -side * 0.5; // tusks sweep back out of the mouth
    } else {
      geo = side > 0
        ? new THREE.CylinderGeometry(w * 0.5, tip, len, 5)
        : new THREE.CylinderGeometry(tip, w * 0.5, len, 5);
    }

    const frame = new THREE.Group();
    orientTo(frame, hit.point, hit.normal);
    const tooth = new THREE.Mesh(geo, mats.tooth);
    tooth.position.set(0, -side * len * 0.45, 0.02 * S);
    if (curl) {
      tooth.rotation.x = curl;
      tooth.position.z += len * 0.3;
    }
    tooth.scale.z = flat;
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

export function addNose(parent, headMesh, p, mats, rng) {
  if (p.noseType === 'none') return;
  const L = faceLimits(p);
  const S = L.S;
  const ny = L.noseY;   // already lifted clear of the maw
  const size = L.noseSize;
  // Every bump used to be the same oval. Give this one its own proportions:
  // wide and flat, or narrow and long, or pushed out from the face.
  const wide = 0.65 + rng() * 0.95;
  const tall = 0.65 + rng() * 0.95;
  const deep = 0.7 + rng() * 0.9;

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

  if (p.noseType === 'tusks') {
    // not a nose so much as what grows either side of one
    for (const dx of [-1, 1]) {
      const h = surfaceAt(headMesh, p, dx * size * 0.9, ny);
      const f = new THREE.Group();
      orientTo(f, h.point, h.normal);
      const g = new THREE.ConeGeometry(size * 0.34, size * 3.2, 5);
      const tusk = new THREE.Mesh(g, mats.tooth);
      tusk.rotation.x = Math.PI * 0.34;   // up and out of the face
      tusk.rotation.z = dx * 0.3;
      tusk.position.set(0, size * 1.1, size * 1.1);
      withOutline(f, tusk, g, p.outline * 0.5 * S, mats.outline);
      parent.add(f);
    }
    return;
  }

  if (p.noseType === 'trunk') {
    // a heavy hanging tube, built from segments so it can droop
    const h = surfaceAt(headMesh, p, 0, ny);
    const frame = new THREE.Group();
    orientTo(frame, h.point, h.normal);
    const links = 5;
    for (let i = 0; i < links; i++) {
      const k = i / (links - 1);
      const r = size * (0.85 - k * 0.45);
      const g = new THREE.SphereGeometry(r, 8, 6);
      const seg = new THREE.Mesh(g, mats.trim);
      // Out along the normal first, then increasingly down — and further out
      // than feels necessary, or it hangs flat against the face and reads as a
      // line drawn through the teeth rather than as a trunk in front of them.
      seg.position.set(0, -k * k * size * 2.5, size * (0.4 + k * 2.3 - k * k * 0.5));
      withOutline(frame, seg, g, p.outline * 0.55 * S, mats.outline);
    }
    parent.add(frame);
    return;
  }

  let geo;
  let mesh;
  if (p.noseType === 'pig') {
    // a flat disc pressed onto the face, two holes punched through it
    geo = new THREE.CylinderGeometry(size * 1.3 * wide, size * 1.15 * wide, size * 0.55 * deep, 10);
    mesh = new THREE.Mesh(geo, mats.trim);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(0, 0, size * 0.3);
  } else if (p.noseType === 'beak') {
    geo = new THREE.ConeGeometry(size * 0.6 * wide, size * 2.6 * deep, 6);
    mesh = new THREE.Mesh(geo, mats.skin);
    mesh.rotation.x = Math.PI / 2; // tip along the normal
    mesh.position.set(0, 0, size * 0.9);
  } else if (p.noseType === 'snout') {
    geo = new THREE.SphereGeometry(size, 10, 8);
    mesh = new THREE.Mesh(geo, mats.trim);
    mesh.scale.set(wide, 0.75 * tall, 1.9 * deep);
    mesh.position.set(0, 0, size * 0.45);
  } else {
    geo = new THREE.SphereGeometry(size, 10, 8);
    mesh = new THREE.Mesh(geo, mats.trim);
    mesh.scale.set(wide, 1.25 * tall, 0.85 * deep);
    mesh.position.set(0, 0, -size * 0.15);
  }
  withOutline(frame, mesh, geo, p.outline * 0.7 * S, mats.outline);

  if (p.noseType !== 'beak') {
    const wide = p.noseType === 'pig';
    for (const dx of [-1, 1]) {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(size * (wide ? 0.34 : 0.22), 6, 5), mats.cavity);
      nostril.position.set(
        dx * size * (wide ? 0.55 : 0.42),
        wide ? 0 : -size * 0.3,
        size * (p.noseType === 'snout' ? 1.3 : wide ? 0.5 : 0.55),
      );
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
  // Ears sway with the hair, so they join the same list the animator drives.
  const tendrils = addHair(parent, p, mats, rng, S).concat(addEars(parent, p, mats, S, rng));

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
