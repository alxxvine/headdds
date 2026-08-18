// What hangs outside the head's OUTLINE, seen from all the way round:
//   node tools/outline-sweep.mjs [creatures] [seeds:1,2,3]
//
// The maw is a decal on a solid skull rather than a hole in it, so everything
// that belongs to the mouth — the cavity band, the lip band, every tooth — is
// drawn ON the head and must therefore project INSIDE the head's outline from
// every direction. Nothing checked that. A row of teeth stood a quarter of a
// head radius clear of the cheek: dead on from the front it read as a mouth,
// and from three quarters on it was a row of white rods hanging in the air off
// the side of the face with the background showing between them.
//
// Two earlier sweeps between them nearly saw it and neither did:
//
//   face-sweep works in the FRONTAL plane, where a tooth standing out of a
//   cheek still covers the same pixels as the cheek.
//   teeth-sweep measures a tooth's RADIAL excess over the skull, which is the
//   right direction, but it passed anything under a threshold that had been
//   set — by me — at 0.28R, which is the defect.
//
// So this measures the thing itself: the head is rasterised into a silhouette
// mask from forty-eight directions, every candidate vertex is projected into
// the same view, and the answer is how far outside the mask it lands, in head
// radii. A number here is a distance on screen, not a proxy for one.
//
// The head's own growths are not candidates. A horn that leaves the skull is a
// horn; a tooth that leaves it is a bug.

import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { headRadius } from '../src/creature/features.js';

const ARG = process.argv[2] || '120';
const SEEDS = ARG.startsWith('seeds:') ? ARG.slice(6).split(',').map(Number) : null;
const N = SEEDS ? SEEDS.length : Number(ARG);

const RES = 256;
const VIEWS = [];
for (const el of [-0.4, 0, 0.4]) {
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    VIEWS.push(new THREE.Vector3(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el)));
  }
}

const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** an orthographic silhouette of `meshes` seen down `dir` */
function silhouette(meshes, dir, centre, radius) {
  const f = dir.clone().normalize();
  const up = Math.abs(f.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const rx = new THREE.Vector3().crossVectors(up, f).normalize();
  const ry = new THREE.Vector3().crossVectors(f, rx).normalize();
  const scale = RES / (radius * 2.4);
  const mask = new Uint8Array(RES * RES);
  const px = (v) => {
    _p.copy(v).sub(centre);
    return [_p.dot(rx) * scale + RES / 2, _p.dot(ry) * scale + RES / 2];
  };
  const tri = (A, B, C) => {
    const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
    const x1 = Math.min(RES - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
    const y1 = Math.min(RES - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    const d = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    if (Math.abs(d) < 1e-12) return;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const qx = x + 0.5;
        const qy = y + 0.5;
        const w0 = ((B[0] - A[0]) * (qy - A[1]) - (qx - A[0]) * (B[1] - A[1])) / d;
        const w1 = ((qx - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (qy - A[1])) / d;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) mask[y * RES + x] = 1;
      }
    }
  };
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    const idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;
      _a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
      _b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
      _c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
      tri(px(_a), px(_b), px(_c));
    }
  }
  return { mask, px, scale };
}

/** how far outside the mask a point lands, in world units */
function outside(sil, v) {
  const [x, y] = sil.px(v);
  const ix = Math.round(x - 0.5);
  const iy = Math.round(y - 0.5);
  if (ix >= 0 && iy >= 0 && ix < RES && iy < RES && sil.mask[iy * RES + ix]) return 0;
  for (let r = 1; r <= 80; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const ay = iy + dy;
      if (ay < 0 || ay >= RES) continue;
      const dx = r - Math.abs(dy);
      const xs = dx === 0 ? [ix] : [ix - dx, ix + dx];
      for (const ax of xs) {
        if (ax >= 0 && ax < RES && sil.mask[ay * RES + ax]) return (r - 0.5) / sil.scale;
      }
    }
  }
  return 80 / sil.scale;
}

function scan(seed) {
  const p = randomize(seed);
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);
  let head = null;
  c.rig.headPivot.traverse((o) => {
    if (!head && o.isMesh && o.geometry.type === 'IcosahedronGeometry'
      && o.material?.side !== THREE.BackSide) head = o;
  });
  const R = headRadius(p) * head.getWorldScale(new THREE.Vector3()).x;
  const centre = head.getWorldPosition(new THREE.Vector3());
  const parts = [];
  c.rig.headPivot.traverse((o) => {
    if (!o.isMesh || o === head || o.material?.side === THREE.BackSide) return;
    // the shell around a tooth is drawn too, so it counts as much as the tooth
    const own = o.userData.tooth ? 'tooth' : o.userData.maw ? 'maw' : null;
    if (own) parts.push({ o, kind: own });
  });
  const worst = new Map();
  for (const dir of VIEWS) {
    const sil = silhouette([head], dir, centre, R * 1.3);
    for (const { o, kind } of parts) {
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 60));
      for (let k = 0; k < pos.count; k += step) {
        _p.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
        const d = outside(sil, _p) / R;
        if (d > (worst.get(kind) ?? 0)) worst.set(kind, d);
      }
    }
  }
  c.dispose();
  return { p, worst };
}

const rows = [];
for (let i = 0; i < N; i++) {
  const seed = SEEDS ? SEEDS[i] : 40000 + i * 7;
  const { p, worst } = scan(seed);
  rows.push({ seed, p, tooth: worst.get('tooth') ?? 0, maw: worst.get('maw') ?? 0 });
  if (SEEDS) {
    console.log(`seed ${String(seed).padStart(8)} ${p.toothType.padEnd(8)} ${p.mawShape.padEnd(8)}`
      + ` teeth ${(worst.get('tooth') ?? 0).toFixed(3)}R  maw ${(worst.get('maw') ?? 0).toFixed(3)}R`);
  }
}

const q = (a, f) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))];
console.log(`\n=== ${rows.length} creatures: how far outside the head's outline ===`);
for (const k of ['tooth', 'maw']) {
  const v = rows.map((r) => r[k]);
  console.log(`  ${k.padEnd(6)} mean ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)}R`
    + `  p50 ${q(v, 0.5).toFixed(3)}R  p90 ${q(v, 0.9).toFixed(3)}R  max ${Math.max(...v).toFixed(3)}R`
    + `  | over 0.05R ${(v.filter((x) => x > 0.05).length / v.length * 100).toFixed(0)}%`
    + `  over 0.12R ${(v.filter((x) => x > 0.12).length / v.length * 100).toFixed(0)}%`);
}
console.log('\n=== worst creatures ===');
for (const r of rows.slice().sort((a, b) => Math.max(b.tooth, b.maw) - Math.max(a.tooth, a.maw)).slice(0, 12)) {
  console.log(`  seed ${String(r.seed).padStart(8)} teeth ${r.tooth.toFixed(3)}R maw ${r.maw.toFixed(3)}R`
    + ` | ${r.p.toothType} ${r.p.mawShape} width ${r.p.mouthWidth.toFixed(2)} open ${r.p.mouthOpen.toFixed(2)} size ${r.p.toothSize.toFixed(2)}`);
}
const byKind = new Map();
for (const r of rows) {
  const e = byKind.get(r.p.toothType) ?? { n: 0, s: 0, m: 0 };
  e.n++; e.s += r.tooth; e.m = Math.max(e.m, r.tooth);
  byKind.set(r.p.toothType, e);
}
console.log('\n=== teeth by kind ===');
for (const [k, e] of [...byKind].sort((a, b) => b[1].m - a[1].m)) {
  console.log(`  ${k.padEnd(9)} n ${String(e.n).padStart(3)}  mean ${(e.s / e.n).toFixed(3)}R  max ${e.m.toFixed(3)}R`);
}
