// Every decal on a head, and whether the skin comes through it:
//   node tools/decal-sag.mjs [creatures] [--seed N] [--csv]
//
// A decal is a lattice of points raycast onto the skull and pushed out along
// their own normals by `offset`. The FACES between those points are flat, and a
// flat face between two points of a convex skull passes UNDER the skin between
// them. The drop is a sagitta: for a sample spacing h across a surface of
// normal curvature k it is about k*h^2/8, and the two directions of a quad add.
// Where that drop beats the lift, the skull is drawn in front of its own decal
// and bare skin shows through the middle of the patch.
//
// Nothing here is predicted from the numbers that built a patch. Every figure
// is read off the geometry that was actually built, and the skin it is compared
// against is the TESSELLATED skull the player sees, not the analytic surface —
// the facets cut the corner, and a decal is not required to clear a shape that
// is never drawn.

import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { mawProfile } from '../src/creature/maw.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const N = Number(args.find((a) => /^\d+$/.test(a)) || 200);
const FOCUS = val('--seed', null);

// The offset each call site asks for, so a measured drop can be put next to the
// lift it had to beat. Keyed by the patch names below.
const SPEC = {
  'eye hole':      { off: 0.010, rings: 2, segs: 16, line: 'features.js:740' },
  'eye bead':      { off: 0.008, rings: 2, segs: 16, line: 'features.js:748' },
  'eye compound':  { off: 0.020, rings: 3, segs: 14, line: 'features.js:799' },
  'eye pit':       { off: 0.006, rings: 3, segs: 16, line: 'features.js:825' },
  'eye cluster':   { off: 0.008, rings: 3, segs: 16, line: 'features.js:843' },
  'eye visor':     { off: 0.010, rings: 2, segs: 20, line: 'features.js:862' },
  'eye button':    { off: 0.012, rings: 2, segs: 16, line: 'features.js:904' },
  'eye slot':      { off: 0.008, rings: 2, segs: 12, line: 'features.js:912' },
  'eye lantern':   { off: 0.008, rings: 2, segs: 16, line: 'features.js:929' },
  'eye gash':      { off: 0.010, rings: 2, segs: 18, line: 'features.js:943' },
  'eye ball':      { off: 0.020, rings: 3, segs: 14, line: 'features.js:966' },
  'maw lip':       { off: 0.018, cols: 30, rows: 11, line: 'features.js:1271' },
  'maw cavity':    { off: 0.040, cols: 30, rows: 13, line: 'features.js:1285' },
  'nose holes':    { off: 0.008, rings: 2, segs: 12, line: 'features.js:1342' },
  'nose slits':    { off: 0.008, rings: 2, segs: 10, line: 'features.js:1419' },
  'scar dot':      { off: 0.016, rings: 1, segs: 8,  line: 'features.js:1595' },
};

/** Which call site built this mesh, from the mesh alone. */
function classify(o, p) {
  const n = o.geometry.attributes.position.count;
  if (o.userData.maw) return n === (SPEC['maw lip'].cols + 1) * (SPEC['maw lip'].rows + 1) ? 'maw lip' : 'maw cavity';
  if (o.userData.nose) return n === 36 ? 'nose holes' : n === 30 ? 'nose slits' : null;
  if (n === 16) return 'scar dot';
  const k = `eye ${p.eyeStyle === undefined ? '?' : p.eyeStyle}`;
  return SPEC[k] ? k : (SPEC[`eye ${p.eyeStyle}`] ? `eye ${p.eyeStyle}` : null);
}

/**
 * The skull as a depth image, queried at any (x, y): the z of the frontmost
 * FRONT-FACING facet there, which is exactly the fragment the depth buffer
 * keeps. A uniform xy grid over the 5120 triangles, because the sweep asks a
 * few hundred thousand times and three's raycaster walks every triangle.
 */
function depthOf(headMesh) {
  const pos = headMesh.geometry.attributes.position;
  const tris = pos.count / 3;
  const ax = new Float64Array(tris), ay = new Float64Array(tris), az = new Float64Array(tris);
  const bx = new Float64Array(tris), by = new Float64Array(tris), bz = new Float64Array(tris);
  const cx = new Float64Array(tris), cy = new Float64Array(tris), cz = new Float64Array(tris);
  const front = new Uint8Array(tris);
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (let t = 0; t < tris; t++) {
    const i = t * 3;
    ax[t] = pos.getX(i); ay[t] = pos.getY(i); az[t] = pos.getZ(i);
    bx[t] = pos.getX(i + 1); by[t] = pos.getY(i + 1); bz[t] = pos.getZ(i + 1);
    cx[t] = pos.getX(i + 2); cy[t] = pos.getY(i + 2); cz[t] = pos.getZ(i + 2);
    // +Z component of (b-a) x (c-a): the sign of the winding as seen from the front
    front[t] = ((bx[t] - ax[t]) * (cy[t] - ay[t]) - (by[t] - ay[t]) * (cx[t] - ax[t])) > 0 ? 1 : 0;
    minx = Math.min(minx, ax[t], bx[t], cx[t]); maxx = Math.max(maxx, ax[t], bx[t], cx[t]);
    miny = Math.min(miny, ay[t], by[t], cy[t]); maxy = Math.max(maxy, ay[t], by[t], cy[t]);
  }
  const G = 48;
  const sx = (maxx - minx) / G || 1;
  const sy = (maxy - miny) / G || 1;
  const cell = Array.from({ length: G * G }, () => []);
  const ci = (x) => Math.min(G - 1, Math.max(0, Math.floor((x - minx) / sx)));
  const cj = (y) => Math.min(G - 1, Math.max(0, Math.floor((y - miny) / sy)));
  for (let t = 0; t < tris; t++) {
    if (!front[t]) continue;
    const i0 = ci(Math.min(ax[t], bx[t], cx[t])), i1 = ci(Math.max(ax[t], bx[t], cx[t]));
    const j0 = cj(Math.min(ay[t], by[t], cy[t])), j1 = cj(Math.max(ay[t], by[t], cy[t]));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) cell[j * G + i].push(t);
  }
  return (x, y) => {
    const list = cell[cj(y) * G + ci(x)];
    let best = -Infinity;
    for (let k = 0; k < list.length; k++) {
      const t = list[k];
      const v0x = bx[t] - ax[t], v0y = by[t] - ay[t];
      const v1x = cx[t] - ax[t], v1y = cy[t] - ay[t];
      const den = v0x * v1y - v1x * v0y;
      if (den === 0) continue;
      const px = x - ax[t], py = y - ay[t];
      const u = (px * v1y - v1x * py) / den;
      const v = (v0x * py - px * v0y) / den;
      if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
      const z = az[t] + u * (bz[t] - az[t]) + v * (cz[t] - az[t]);
      if (z > best) best = z;
    }
    return best;
  };
}

// barycentric samples inside a triangle: the three edge midpoints (a flat
// quad's worst point is the middle of its diagonal, which is an edge midpoint
// of both of its triangles) plus an interior grid
const SAMPLES = [];
for (const [a, b, c] of [[1, 1, 0], [0, 1, 1], [1, 0, 1]]) SAMPLES.push([a / 2, b / 2, c / 2]);
for (let i = 1; i <= 4; i++) for (let j = 1; i + j <= 5; j++) SAMPLES.push([i / 6, j / 6, (6 - i - j) / 6]);

const acc = new Map();
const note = (name, row) => {
  if (!acc.has(name)) acc.set(name, []);
  acc.get(name).push(row);
};

function sweepOne(seed, verbose) {
  const p = randomize(seed);
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);
  const headMesh = c.rig.headPivot.children[0].children.find((o) => o.geometry?.type === 'IcosahedronGeometry')
    || c.rig.headPivot.children[0];
  const depth = depthOf(headMesh);
  const S = (p.headWidth + p.headHeight) * 0.5;

  const inv = new THREE.Matrix4().copy(headMesh.matrixWorld).invert();
  const v = new THREE.Vector3();

  // What is drawn ON TOP of a patch, and so hides a hole in it. The lip is a
  // border by construction — the cavity is the same shape a size smaller
  // standing further off the skin, so everything the cavity covers is lip the
  // player never sees, and a hole there costs nothing. An eye socket is a ring
  // around a ball in the same way.
  const maw = c.rig.maw;
  const prof = mawProfile(p.mawShape);
  const underCavity = maw ? (x, y) => {
    const u = (x - maw.mx) / Math.max(maw.mw, 1e-6);
    if (Math.abs(u) > 1) return false;
    const dy = (y - maw.my) / Math.max(maw.mh, 1e-6);
    return dy >= prof.down(u) && dy <= prof.up(u);
  } : null;

  // the biggest ball each eye actually got, in the skull's frame
  const balls = [];
  for (const e of c.rig.eyes || []) {
    const node = e.pivot ?? e;
    node.updateMatrixWorld(true);
    let big = 0, bx = 0, by = 0, brx = 0, bry = 0;
    node.traverse((o) => {
      if (!o.isMesh || o.material?.side === THREE.BackSide) return;
      const r = o.geometry?.parameters?.radius;
      if (!r) return;
      const sc = new THREE.Vector3(); o.getWorldScale(sc);
      const area = r * r * sc.x * sc.y;
      if (area <= big) return;
      const c2 = new THREE.Vector3(); o.getWorldPosition(c2); c2.applyMatrix4(inv);
      big = area; bx = c2.x; by = c2.y; brx = r * sc.x; bry = r * sc.y;
    });
    if (big > 0) balls.push({ x: bx, y: by, rx: brx, ry: bry });
  }
  const underBall = balls.length ? (x, y) => balls.some((b) =>
    ((x - b.x) / b.rx) ** 2 + ((y - b.y) / b.ry) ** 2 <= 1) : null;

  c.rig.headPivot.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    if (o.geometry.type !== 'BufferGeometry') return;
    if (o === headMesh) return;
    const g = o.geometry;
    if (!g.index || !g.attributes.normal) return;
    const name = classify(o, p);
    if (!name) return;
    const off = SPEC[name].off;
    const covered = name === 'maw lip' ? underCavity : name.startsWith('eye ') ? underBall : null;

    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const idx = g.index.array;
    // decal vertices to the skull's own frame (identity in practice, taken
    // properly anyway)
    const P = [];
    const NZ = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      P.push(v.x, v.y, v.z);
      NZ.push(nor.getZ(i));
    }

    // The lattice's own edge lengths. Two very different things make a long
    // edge: the patch is simply big, and `surfaceAt` MISSED and walked the
    // query in towards the middle of the face, dropping one vertex a long way
    // from where the lattice asked for it. The second makes a quad that spans
    // half a cheek, and its sag is not a sag — it is a torn patch. Told apart
    // by the median edge of the patch itself.
    const edges = [];
    for (let t = 0; t < idx.length; t += 3) {
      const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3;
      const e = (I, J) => Math.hypot(P[I] - P[J], P[I + 1] - P[J + 1], P[I + 2] - P[J + 2]);
      edges.push(e(A, B), e(B, C), e(C, A));
    }
    edges.sort((a, b) => a - b);
    const medEdge = edges[Math.floor(edges.length / 2)] || 1e-6;
    const TORN = medEdge * 2.5;

    let spacing = 0;      // longest edge of the lattice, in head units
    let dip = -Infinity;  // how far the skin pokes in front of the patch
    let dipTight = -Infinity;  // ...ignoring quads torn open by a surfaceAt miss
    let dipShown = -Infinity;  // ...and ignoring anything the cavity covers
    let sag = 0;          // the chord's own drop below the skin
    let torn = 0;
    let vertClear = Infinity;
    let dipAt = null;
    let shown = 0;      // interior samples the player can see
    let holed = 0;      // ...of which the skin is in front of the patch

    for (let t = 0; t < idx.length; t += 3) {
      const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3;
      const e = (I, J) => Math.hypot(P[I] - P[J], P[I + 1] - P[J + 1], P[I + 2] - P[J + 2]);
      const long = Math.max(e(A, B), e(B, C), e(C, A));
      spacing = Math.max(spacing, long);
      const isTorn = long > TORN;
      if (isTorn) torn++;
      // the lift these three corners actually carry, in z
      const liftZ = off * (NZ[idx[t]] + NZ[idx[t + 1]] + NZ[idx[t + 2]]) / 3;
      for (const [wa, wb, wc] of SAMPLES) {
        const x = P[A] * wa + P[B] * wb + P[C] * wc;
        const y = P[A + 1] * wa + P[B + 1] * wb + P[C + 1] * wc;
        const z = P[A + 2] * wa + P[B + 2] * wb + P[C + 2] * wc;
        const sk = depth(x, y);
        if (!Number.isFinite(sk)) continue;
        if (sk - z > dip) { dip = sk - z; dipAt = { x, y, z, sk }; }
        if (!isTorn) {
          dipTight = Math.max(dipTight, sk - z);
          sag = Math.max(sag, sk - z + liftZ);
          if (!covered || !covered(x, y)) {
            dipShown = Math.max(dipShown, sk - z);
            shown++;
            if (sk - z > 0) holed++;
          }
        }
      }
    }
    for (let i = 0; i < pos.count; i++) {
      const sk = depth(P[i * 3], P[i * 3 + 1]);
      if (Number.isFinite(sk)) vertClear = Math.min(vertClear, P[i * 3 + 2] - sk);
    }

    note(name, { seed, S, spacing, medEdge, spacingS: spacing / S, medS: medEdge / S,
      dip, dipTight, dipShown, sag, off, vertClear, dipAt, p, torn, tris: idx.length / 3,
      holeFrac: shown ? holed / shown : 0 });
    if (verbose) {
      console.log(`  ${name.padEnd(12)} ${SPEC[name].line.padEnd(18)}`
        + ` spacing ${(spacing / S).toFixed(4)}S  worst sagitta ${(sag / S).toFixed(4)}S`
        + `  offset ${off.toFixed(3)} (${(off / S).toFixed(4)}S)`
        + `  skin through by ${(dip / S).toFixed(4)}S  ${dip > 0 ? '<-- BARE SKIN' : 'ok'}`);
    }
  });
  c.dispose();
  return p;
}

if (FOCUS !== null) {
  console.log(`seed ${FOCUS}`);
  const p = sweepOne(Number(FOCUS), true);
  console.log(`  maw ${p.mawShape} lips ${p.lips.toFixed(3)} open ${p.mouthOpen.toFixed(2)}`
    + ` lumps ${p.lumps.toFixed(3)} eyes ${p.eyeStyle} nose ${p.noseType}`);
  process.exit(0);
}

for (let i = 0; i < N; i++) sweepOne(i * 11 + 3, false);

const q = (v, f) => (v.length ? v[Math.min(v.length - 1, Math.floor(f * (v.length - 1)))] : 0);
const rows = [];
for (const [name, list] of acc) {
  const sp = list.map((r) => r.medS).sort((a, b) => a - b);
  const spx = list.map((r) => r.spacingS).sort((a, b) => a - b);
  const sg = list.map((r) => r.sag / r.S).sort((a, b) => a - b);
  const dp = list.map((r) => r.dipTight / r.S).sort((a, b) => a - b);
  const dv = list.map((r) => r.dipShown / r.S).sort((a, b) => a - b);
  rows.push({
    name, n: list.length, line: SPEC[name].line,
    spMed: q(sp, 0.5), spMax: q(spx, 1),
    sagMed: q(sg, 0.5), sagP90: q(sg, 0.9), sagMax: q(sg, 1),
    off: SPEC[name].off, offS: SPEC[name].off / list[0].S,
    dipMax: q(dp, 1), shownMax: q(dv, 1), allMax: q(list.map((r) => r.dip / r.S).sort((a, b) => a - b), 1),
    pct: 100 * list.filter((r) => r.dip > 0).length / list.length,
    pctTight: 100 * list.filter((r) => r.dipTight > 0).length / list.length,
    pctShown: 100 * list.filter((r) => r.dipShown > 0).length / list.length,
    pctTorn: 100 * list.filter((r) => r.torn > 0).length / list.length,
    areaMed: q(list.map((r) => 100 * r.holeFrac).sort((a, b) => a - b), 0.5),
    areaP90: q(list.map((r) => 100 * r.holeFrac).sort((a, b) => a - b), 0.9),
    needOff: q(list.map((r) => r.sag / 0.85).sort((a, b) => a - b), 0.9),
    tornMed: q(list.map((r) => 100 * r.torn / r.tris).sort((a, b) => a - b), 0.5),
    worst: list.slice().sort((a, b) => b.dipShown - a.dipShown)[0],
  });
}
rows.sort((a, b) => b.pctShown - a.pctShown || b.shownMax - a.shownMax);

console.log(`${N} random creatures - every decal measured against the tessellated skull it sits on`);
console.log('all lengths in head units S = (headWidth + headHeight) / 2');
console.log('spacing = the lattice\'s own median / worst edge.  sagitta = how far a flat face drops');
console.log('below the skin between its corners.  "skin through" = the sag beat the lift and the');
console.log('skull is drawn in front of its own decal, on faces the lattice did NOT tear open.');
console.log('"shown" excludes what the cavity (lip) or the eyeball (sockets) covers anyway.\n');
console.log('patch        where              n   spacing med/max   sagitta med/p90/max   offset  off/S   thru all/untorn  of it shown   long cells');
for (const r of rows) {
  console.log(
    r.name.padEnd(13)
    + r.line.padEnd(19)
    + String(r.n).padStart(4) + '  '
    + `${r.spMed.toFixed(3)}/${r.spMax.toFixed(3)}`.padStart(15) + '  '
    + `${r.sagMed.toFixed(4)}/${r.sagP90.toFixed(4)}/${r.sagMax.toFixed(4)}`.padStart(21) + '  '
    + r.off.toFixed(3).padStart(6) + '  '
    + r.offS.toFixed(4).padStart(7) + '  '
    + `${r.pct.toFixed(0)}%/${r.pctTight.toFixed(0)}%`.padStart(9) + '  '
    + `${r.pctShown.toFixed(0)}% max ${r.shownMax.toFixed(4)}S`.padStart(18) + '  '
    + `${r.areaMed.toFixed(0)}%/${r.areaP90.toFixed(0)}%`.padStart(10) + '  '
    + r.needOff.toFixed(3).padStart(7),
  );
}
console.log('\nworst VISIBLE hole per patch:');
for (const r of rows) {
  if (r.pctShown === 0) continue;
  const w = r.worst;
  console.log(`  ${r.name.padEnd(13)} seed ${String(w.seed).padStart(6)}  skin ${(w.dipShown / w.S).toFixed(4)}S in front`
    + `  maw ${w.p.mawShape} lips ${w.p.lips.toFixed(2)} lumps ${w.p.lumps.toFixed(2)} eyes ${w.p.eyeStyle}`);
}
