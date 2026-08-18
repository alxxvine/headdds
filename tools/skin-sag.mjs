// How far a straight line between two points of skin passes UNDER the skin:
//   node tools/skin-sag.mjs [creatures]
//
// Every decal is a lattice of points ON the skull with flat faces stretched
// between them, so the one number that decides whether the skin comes through a
// patch is this: for a sample spacing h, how deep is the skin's own bulge over
// that span? Answer it once, on the skull the player is actually shown, and
// every call site's `offset` can be read straight off the table — an offset
// below the sag at its own spacing is a hole, whatever else is true.
//
// Measured against the TESSELLATED skull, because that is what is drawn. And
// the tessellation matters more than the shape does: HEAD_DETAIL 4 is 500
// triangles, not the 5120 the comment at head.js:11 claims (three subdivides
// each of the 20 faces into (detail+1)^2, not 4^detail), so one facet is about
// a quarter of a head across and a decal cell mostly lives inside one.

import * as THREE from 'three';
import { randomize } from '../src/creature/schema.js';
import { makeHeadGeometry } from '../src/creature/head.js';

const N = Number(process.argv[2] || 120);
const HS = [0.02, 0.04, 0.06, 0.09, 0.12, 0.16, 0.20, 0.25, 0.30, 0.40];

function depthOf(geo) {
  const pos = geo.attributes.position, tris = pos.count / 3;
  const T = [];
  for (let t = 0; t < tris; t++) {
    const i = t * 3;
    const a = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const b = [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)];
    const c = [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)];
    if (((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) <= 0) continue;
    T.push([a, b, c]);
  }
  return (x, y) => {
    let best = -Infinity;
    for (const [a, b, c] of T) {
      const v0x = b[0] - a[0], v0y = b[1] - a[1], v1x = c[0] - a[0], v1y = c[1] - a[1];
      const den = v0x * v1y - v1x * v0y; if (den === 0) continue;
      const px = x - a[0], py = y - a[1];
      const u = (px * v1y - v1x * py) / den, v = (v0x * py - px * v0y) / den;
      if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
      const z = a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2]);
      if (z > best) best = z;
    }
    return best;
  };
}

const acc = HS.map(() => []);
for (let n = 0; n < N; n++) {
  const p = randomize(n * 11 + 3);
  const S = (p.headWidth + p.headHeight) * 0.5;
  const geo = makeHeadGeometry(p);
  const depth = depthOf(geo);
  const bb = geo.boundingBox;
  for (let hi = 0; hi < HS.length; hi++) {
    const h = HS[hi] * S;
    let worst = 0;
    // the front of the face, where every decal lives: the middle half of the
    // skull's own outline box
    for (let ix = 0; ix <= 22; ix++) {
      for (let iy = 0; iy <= 22; iy++) {
        const x = bb.min.x + (bb.max.x - bb.min.x) * (0.25 + 0.50 * ix / 22);
        const y = bb.min.y + (bb.max.y - bb.min.y) * (0.25 + 0.50 * iy / 22);
        for (const [dx, dy] of [[1, 0], [0, 1], [0.707, 0.707]]) {
          const a = depth(x - dx * h / 2, y - dy * h / 2);
          const b = depth(x + dx * h / 2, y + dy * h / 2);
          const m = depth(x, y);
          if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(m)) continue;
          // Only where the skin faces the player. Near the silhouette the depth
          // graph turns over and the chord between two samples is not a chord
          // of anything — that is the outline, not a sagitta, and no offset was
          // ever meant to clear it.
          if (Math.abs(a - b) > h * 1.2) continue;
          worst = Math.max(worst, m - (a + b) / 2);
        }
      }
    }
    acc[hi].push(worst / S);
  }
  geo.dispose();
}

console.log(`${N} random skulls — the skin's own bulge over a span, in head units S\n`);
console.log('span h    sagitta median   p90      max      offsets that clear it');
const OFFS = [['0.006 (pit)', 0.006], ['0.008 (lip, bead, cluster, slot, lantern, nose)', 0.008],
  ['0.010 (hole, visor, gash)', 0.010], ['0.012 (button)', 0.012],
  ['0.016 (scar)', 0.016], ['0.020 (compound, plain eye)', 0.020], ['0.022 (cavity)', 0.022]];
for (let i = 0; i < HS.length; i++) {
  const v = acc[i].slice().sort((a, b) => a - b);
  const q = (f) => v[Math.floor(f * (v.length - 1))];
  // an offset is spent along the normal; a typical decal cell sits where nz is
  // about 0.9, so this is what is actually between the patch and the camera
  const clears = OFFS.filter(([, o]) => o * 0.9 > q(0.9) * 1).map(([l]) => l.split(' ')[0]);
  console.log(`${HS[i].toFixed(2)}S    ${q(0.5).toFixed(4)}S        ${q(0.9).toFixed(4)}S  ${q(1).toFixed(4)}S   `
    + (clears.length ? clears.join(' ') : 'NONE of them'));
}
