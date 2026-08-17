// Checks that the face is a face:
//   node tools/face-sweep.mjs [creatures]
//
// Each part of a head is planted correctly on its own terms — an eye sits on
// the skin, a tooth grows from the rim of the maw — and nothing has ever
// checked them against EACH OTHER, or against the edge of the skull they are
// on. That is where a player's read of "the character is broken" comes from:
// two eyeballs inside one another, an eye sliced flat on the silhouette, a fang
// lying across the chin on bare skin.
//
// Measured on the built creature rather than on a model of it, and in the
// frontal plane the player is looking at. The skull's own outline at a given
// height is solved from headPoint, not rasterised.

import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { headPoint } from '../src/creature/head.js';
import { mawProfile } from '../src/creature/maw.js';

const N = Number(process.argv[2] || 300);

const _d = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Half-width of the skull's frontal silhouette at height y, in the head's own
 * frame. Walked latitude by latitude, taking the widest point that reaches
 * that height — the surface is star-shaped, so that is its outline there.
 */
function silhouetteAt(p, y) {
  let best = 0;
  for (let i = 0; i <= 48; i++) {
    const dy = -0.999 + (i / 48) * 1.998;
    const c = Math.sqrt(Math.max(0, 1 - dy * dy));
    headPoint(p, _d.set(c, dy, 0).normalize(), _p);
    if (Math.abs(_p.y - y) < 0.05 * p.headHeight) best = Math.max(best, Math.abs(_p.x));
  }
  // Nothing landed near that height — it is above the crown or below the chin,
  // so there is no skull there at all.
  return best;
}

/** The biggest sphere in a subtree, as {x, y, r} in the head's frame. */
function ballOf(node, headMesh) {
  let r = 0;
  const c = new THREE.Vector3();
  node.updateMatrixWorld(true);
  node.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    if (o.geometry.type !== 'SphereGeometry') return;
    const s = new THREE.Vector3(); o.getWorldScale(s);
    const rad = (o.geometry.parameters.radius ?? 0) * Math.max(s.x, s.y);
    if (rad > r) { r = rad; o.getWorldPosition(c); }
  });
  if (r === 0) return null;
  headMesh.worldToLocal(c);
  return { x: c.x, y: c.y, r };
}

const rows = [];
for (let i = 0; i < N; i++) {
  const p = randomize(i * 11 + 3);
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);
  const headMesh = c.rig.headPivot.children[0];

  const eyes = c.rig.eyes.map((e) => ballOf(e.pivot ?? e, headMesh)).filter(Boolean);

  // --- eyes against each other -------------------------------------------
  let pair = 0;
  for (let a = 0; a < eyes.length; a++) {
    for (let b = a + 1; b < eyes.length; b++) {
      const need = eyes[a].r + eyes[b].r;
      const got = Math.hypot(eyes[a].x - eyes[b].x, eyes[a].y - eyes[b].y);
      if (got < need) pair = Math.max(pair, (need - got) / need);
    }
  }

  // --- eyes against the edge of the skull ---------------------------------
  // A ball on a curved skull is allowed to sit a little proud of the outline;
  // what reads as broken is the eye being cut in half by the edge of the head.
  let edge = 0;
  for (const e of eyes) {
    const half = silhouetteAt(p, e.y);
    if (half === 0) { edge = Math.max(edge, 1); continue; }  // off the skull entirely
    const over = (Math.abs(e.x) + e.r * 0.55) - half;
    if (over > 0) edge = Math.max(edge, over / Math.max(e.r, 1e-6));
  }

  // --- teeth against the mouth they grow from ------------------------------
  // The maw is a decal on a solid skull, not a hole, so a tooth longer than the
  // opening does not disappear behind a lip — it lies across the face.
  let tooth = 0;
  const maw = c.rig.maw;
  if (maw) {
    c.rig.headPivot.traverse((o) => {
      const tag = o.userData.tooth;
      if (!tag) return;
      // the biting end, in the tooth's own frame, taken to the head's
      const tip = new THREE.Vector3(0, -tag.side * tag.len * 0.5, 0)
        .applyMatrix4(o.matrixWorld);
      headMesh.worldToLocal(tip);
      // How far past the FAR rim the tip sits, in mouth-heights. Measured on
      // the maw's own profile rather than on an ellipse: the moment the mouth
      // stopped being an ellipse, an ellipse stopped being the thing to
      // measure it against.
      const u = (tip.x - maw.mx) / Math.max(maw.mw, 1e-6);
      const prof = mawProfile(p.mawShape);
      const dy = (tip.y - maw.my) / Math.max(maw.mh, 1e-6);
      const far = tag.side > 0 ? prof.down(u) : prof.up(u);
      const past = tag.side > 0 ? far - dy : dy - far;
      tooth = Math.max(tooth, Math.abs(u) > 1.05 ? 4 : Math.max(0, past));
    });
  }

  // --- the nose against the mouth ------------------------------------------
  // faceLimits reserves room for the nose and the maw dodges it; the mesh that
  // actually gets built is scaled by a roll the limits never saw.
  let nose = 0;
  // A trunk hangs in front of the mouth on purpose, so it is not asked about.
  if (maw && !['none', 'holes', 'trunk'].includes(p.noseType)) {
    c.rig.headPivot.traverse((o) => {
      if (!o.isMesh || o.material?.side === THREE.BackSide) return;
      if (!o.userData.nose) return;
      const box = new THREE.Box3().setFromObject(o);
      const low = headMesh.worldToLocal(new THREE.Vector3(0, box.min.y, 0));
      // how far the bottom of the nose reaches past the top rim of the maw,
      // in maw heights — positive means it is in the mouth
      nose = Math.max(nose, ((maw.my + maw.mh) - low.y) / Math.max(maw.mh, 1e-6));
    });
  }

  rows.push({ seed: i * 11 + 3, p, pair, edge, tooth, nose });
  c.dispose();
}

const share = (key, over) => (100 * rows.filter((r) => r[key] > over).length / rows.length).toFixed(0);
const stat = (key) => {
  const v = rows.map((r) => r[key]).sort((a, b) => a - b);
  const q = (f) => v[Math.floor(f * (v.length - 1))].toFixed(2);
  return `median ${q(0.5)}  p90 ${q(0.9)}  max ${q(1)}`;
};

console.log(`${N} random creatures\n`);
console.log(`eyeballs inside one another    ${share('pair', 0.02).padStart(3)}%   overlap over the pair's radii: ${stat('pair')}`);
console.log(`eyes past the skull's outline  ${share('edge', 0.05).padStart(3)}%   overshoot in eye radii:        ${stat('edge')}`);
// A fang overhanging the rim is the look this thing is for, so the line is not
// at the rim: it is where the tooth stops being a fang and starts being a rod
// lying across the face.
console.log(`teeth lying across the face    ${share('tooth', 1.6).padStart(3)}%   past the far rim, in mouth-heights: ${stat('tooth')}`);
console.log(`noses reaching into the maw    ${share('nose', 0.1).padStart(3)}%   reach in maw heights:         ${stat('nose')}`);

for (const [key, label] of [['pair', 'eyes inside one another'], ['edge', 'eyes off the silhouette'], ['tooth', 'teeth past the lips']]) {
  const worst = rows.slice().sort((a, b) => b[key] - a[key]).slice(0, 3);
  console.log(`\nworst ${label}:`);
  for (const r of worst) {
    console.log(`  seed ${r.seed} ${r[key].toFixed(2)}  eyes ${r.p.eyeLayout}/${r.p.eyeCount}`,
      `spread ${r.p.eyeSpread.toFixed(2)} size ${r.p.eyeSize.toFixed(2)}`,
      `| teeth ${r.p.toothType} size ${r.p.toothSize.toFixed(2)} open ${r.p.mouthOpen.toFixed(2)} count ${r.p.teethTop}`);
  }
}
