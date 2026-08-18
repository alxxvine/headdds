// Does the sagitta arithmetic predict the hole?
//   node tools/decal-verify.mjs [seed]
//
// tools/decal-sag.mjs reads the drop off geometry that was built. This works it
// out the other way round — from the sample spacing and the curvature of the
// skull under the patch — and prints the two side by side, so the number can be
// reasoned about at a call site instead of only measured after the fact.
//
// The model: a decal face is flat, the skin under it is a graph z = f(x, y),
// and bilinear interpolation over an hx by hy cell reproduces everything except
// the curvature. What is left in the middle of the cell is
//     sagitta = (kx*hx^2 + ky*hy^2) / 8,      kx = -f_xx,  ky = -f_yy
// against a lift of only `offset * nz` — the offset is spent along the NORMAL,
// and only its z part stands between the patch and the camera.
//
// Curvature is measured at the scale of one facet of the skull, not smaller:
// the head is drawn as 5120 flat triangles, and fbm ripples below that size are
// in the parameters but never on the screen.

import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { surfaceAt } from '../src/creature/surface.js';
import { mawProfile } from '../src/creature/maw.js';

const seed = Number(process.argv[2] || 7013243);
const p = randomize(seed);
const c = buildCreature(p);
c.group.updateMatrixWorld(true);
const head = c.rig.headPivot.children[0];
const headMesh = head.children.find((o) => o.geometry?.type === 'IcosahedronGeometry');
// surface.js raycasts in WORLD space, and head coordinates are world
// coordinates only while the skull is still outside the scene graph. By now it
// hangs on a neck. A bare copy of the same geometry at the origin puts the
// query back into skull space.
const probe = new THREE.Mesh(headMesh.geometry, headMesh.material);
probe.updateMatrixWorld(true);
const skin = (x, y) => surfaceAt(probe, p, x, y);

const S = (p.headWidth + p.headHeight) * 0.5;
const maw = c.rig.maw;
const prof = mawProfile(p.mawShape);

// one facet of the skull, so curvature is asked at the scale that is drawn
let facet = 0;
{
  const pos = headMesh.geometry.attributes.position;
  const e = [];
  for (let i = 0; i < pos.count; i += 3) {
    e.push(Math.hypot(pos.getX(i) - pos.getX(i + 1), pos.getY(i) - pos.getY(i + 1), pos.getZ(i) - pos.getZ(i + 1)));
  }
  e.sort((a, b) => a - b);
  facet = e[Math.floor(e.length / 2)];
}

/** normal curvature of the frontal depth graph, in x and in y */
function curvature(x, y) {
  const h = facet;
  const z = (a, b) => skin(a, b).point.z;
  const z0 = z(x, y);
  return {
    kx: -(z(x + h, y) - 2 * z0 + z(x - h, y)) / (h * h),
    ky: -(z(x, y + h) - 2 * z0 + z(x, y - h)) / (h * h),
  };
}

/** Every cell of a band, rebuilt from the call site's own numbers. */
function bandCells({ cx, cy, rx, ry, up, down, offset, cols, rows }) {
  const corner = (i, j) => {
    const u = -1 + (i / cols) * 2;
    const hi = up(u), lo = down(u);
    const yy = lo + (hi - lo) * (j / rows);
    const h = skin(cx + u * rx, cy + yy * ry);
    return { x: h.point.x + h.normal.x * offset, y: h.point.y + h.normal.y * offset,
      z: h.point.z + h.normal.z * offset, nz: h.normal.z, u, yy };
  };
  const out = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const A = corner(i, j), B = corner(i + 1, j), C = corner(i, j + 1), D = corner(i + 1, j + 1);
      const m = { x: (A.x + B.x + C.x + D.x) / 4, y: (A.y + B.y + C.y + D.y) / 4, z: (A.z + B.z + C.z + D.z) / 4 };
      const hx = Math.hypot(B.x - A.x, B.y - A.y);
      const hy = Math.hypot(C.x - A.x, C.y - A.y);
      const nz = (A.nz + B.nz + C.nz + D.nz) / 4;
      const t = skin(m.x, m.y);
      // a frontal miss means "no skull at this (x, y)" — surfaceAt answers with
      // skin from somewhere else, which is not a depth at this pixel
      const miss = Math.hypot(t.point.x - m.x, t.point.y - m.y) > facet;
      out.push({ i, j, u: A.u, m, hx, hy, nz, offset,
        dip: miss ? null : t.point.z - m.z,
        sag: miss ? null : t.point.z - m.z + offset * nz, miss });
    }
  }
  return out;
}

function report(label, spec, mask) {
  const cells = bandCells(spec).filter((k) => !k.miss);
  const worst = cells.filter((k) => !mask || !mask(k)).sort((a, b) => b.dip - a.dip)[0];
  const k = curvature(worst.m.x, worst.m.y);
  const pred = (k.kx * worst.hx * worst.hx + k.ky * worst.hy * worst.hy) / 8;
  const lift = spec.offset * worst.nz;
  console.log(label);
  console.log(`  worst visible cell        col ${worst.i} row ${worst.j}  u ${worst.u.toFixed(2)}`
    + `  at (${worst.m.x.toFixed(3)}, ${worst.m.y.toFixed(3)})`);
  console.log(`  cell spacing              hx ${(worst.hx / S).toFixed(4)}S   hy ${(worst.hy / S).toFixed(4)}S`);
  console.log(`  skin curvature there      kx ${k.kx.toFixed(3)}   ky ${k.ky.toFixed(3)}  per unit`);
  console.log(`  PREDICTED sagitta         (kx hx^2 + ky hy^2)/8 = ${(pred / S).toFixed(4)}S`);
  console.log(`  MEASURED  sagitta         on the built lattice   = ${(worst.sag / S).toFixed(4)}S`);
  console.log(`  lift available            offset ${spec.offset} * nz ${worst.nz.toFixed(3)} = ${(lift / S).toFixed(4)}S`);
  console.log(`  net: skin in front by     ${(worst.dip / S).toFixed(4)}S  ->  ${worst.dip > 0 ? 'BARE SKIN' : 'covered'}`);
  const holes = cells.filter((q) => q.dip > 0 && (!mask || !mask(q)));
  console.log(`  cells with a visible hole ${holes.length} of ${cells.length}`);
}

console.log(`seed ${seed}  maw ${p.mawShape}  lips ${p.lips.toFixed(3)}  mouthOpen ${p.mouthOpen.toFixed(2)}`
  + `  lumps ${p.lumps.toFixed(3)}  S ${S.toFixed(3)}  facet ${(facet / S).toFixed(4)}S`);
console.log(`mawBox  mx ${maw.mx.toFixed(3)}  my ${maw.my.toFixed(3)}  mw ${maw.mw.toFixed(3)}  mh ${maw.mh.toFixed(3)}`
  + `  hi ${maw.hi.toFixed(2)}  lo ${maw.lo.toFixed(2)}\n`);

const grow = 1 + p.lips;
// what the cavity covers, so a hole under it costs nothing
const underCavity = (k) => {
  const u = (k.m.x - maw.mx) / maw.mw;
  if (Math.abs(u) > 1) return false;
  const v = (k.m.y - maw.my) / maw.mh;
  return v >= prof.down(u) && v <= prof.up(u);
};

report('--- LIP band  features.js:1271  rx mw*grow  ry mh*grow*1.25  offset 0.018  cols 30 rows 11  mats.lip ---',
  { cx: maw.mx, cy: maw.my, rx: maw.mw * grow, ry: maw.mh * grow * 1.25,
    up: prof.up, down: prof.down, offset: 0.018, cols: 30, rows: 11 }, underCavity);
console.log();
report('--- CAVITY band  features.js:1285  rx mw  ry mh  offset 0.040  cols 30 rows 13  mats.cavity ---',
  { cx: maw.mx, cy: maw.my, rx: maw.mw, ry: maw.mh,
    up: prof.up, down: prof.down, offset: 0.040, cols: 30, rows: 13 }, null);

// --- and a fan, which is the other kind of patch ---------------------------
console.log('\n--- EYE socket  decalGeometry  (the fan, not the band) ---');
{
  const e = c.rig.eyes[0];
  const plan = e?.pivot?.userData?.eyePlan;
  if (!plan) { console.log('  no plan on this creature'); }
  else {
    const size = plan.size;
    const SPECS = {
      hole: { rx: size, ry: size * 1.15, offset: 0.010, rings: 2, segs: 16 },
      bead: { rx: size * 1.25, ry: size * 1.25, offset: 0.008, rings: 2, segs: 16 },
      compound: { rx: size * 1.5, ry: size * 1.5, offset: 0.020, rings: 3, segs: 14 },
      pit: { rx: size * 1.2, ry: size * 1.2, offset: 0.006, rings: 3, segs: 16 },
      cluster: { rx: size * 1.35, ry: size * 1.25, offset: 0.008, rings: 3, segs: 16 },
      visor: { rx: size * 2.4, ry: size * 0.62, offset: 0.010, rings: 2, segs: 20 },
      button: { rx: size * 1.05, ry: size * 1.05, offset: 0.012, rings: 2, segs: 16 },
      slot: { rx: size * 0.55, ry: size * 1.4, offset: 0.008, rings: 2, segs: 12 },
      lantern: { rx: size * 1.15, ry: size * 1.15, offset: 0.008, rings: 2, segs: 16 },
      gash: { rx: size * 1.5, ry: size * 0.42, offset: 0.010, rings: 2, segs: 18 },
    };
    const sp = SPECS[p.eyeStyle];
    if (!sp) console.log(`  eyeStyle ${p.eyeStyle} draws no decal`);
    else {
      const pt = (r, s) => {
        const t = r / sp.rings;
        const a = (s / sp.segs) * Math.PI * 2;
        const h = skin(plan.x + Math.cos(a) * sp.rx * t, plan.y + Math.sin(a) * sp.ry * t);
        return { x: h.point.x + h.normal.x * sp.offset, y: h.point.y + h.normal.y * sp.offset,
          z: h.point.z + h.normal.z * sp.offset, nz: h.normal.z };
      };
      let worst = null;
      for (let r = 0; r < sp.rings; r++) {
        for (let s = 0; s < sp.segs; s++) {
          const A = pt(r, s), B = pt(r, (s + 1) % sp.segs), C = pt(r + 1, s), D = pt(r + 1, (s + 1) % sp.segs);
          const m = { x: (A.x + B.x + C.x + D.x) / 4, y: (A.y + B.y + C.y + D.y) / 4, z: (A.z + B.z + C.z + D.z) / 4 };
          const t = skin(m.x, m.y);
          if (Math.hypot(t.point.x - m.x, t.point.y - m.y) > facet) continue;
          const nz = (A.nz + B.nz + C.nz + D.nz) / 4;
          const cell = { r, s, m, nz,
            hx: Math.hypot(B.x - A.x, B.y - A.y),   // along the ring
            hy: Math.hypot(C.x - A.x, C.y - A.y),   // across the rings
            dip: t.point.z - m.z, sag: t.point.z - m.z + sp.offset * nz };
          if (!worst || cell.dip > worst.dip) worst = cell;
        }
      }
      const k = curvature(worst.m.x, worst.m.y);
      const pred = (k.kx * worst.hx * worst.hx + k.ky * worst.hy * worst.hy) / 8;
      console.log(`  style ${p.eyeStyle}  rings ${sp.rings} segs ${sp.segs} offset ${sp.offset}  eye size ${size.toFixed(3)} (${(size / S).toFixed(3)}S)`);
      console.log(`  worst cell                ring ${worst.r} seg ${worst.s}  at (${worst.m.x.toFixed(3)}, ${worst.m.y.toFixed(3)})`);
      console.log(`  cell spacing              along ring ${(worst.hx / S).toFixed(4)}S   across rings ${(worst.hy / S).toFixed(4)}S`);
      console.log(`  skin curvature there      kx ${k.kx.toFixed(3)}   ky ${k.ky.toFixed(3)}`);
      console.log(`  PREDICTED sagitta         ${(pred / S).toFixed(4)}S`);
      console.log(`  MEASURED  sagitta         ${(worst.sag / S).toFixed(4)}S`);
      console.log(`  lift available            ${(sp.offset * worst.nz / S).toFixed(4)}S`);
      console.log(`  net: skin in front by     ${(worst.dip / S).toFixed(4)}S  ->  ${worst.dip > 0 ? 'BARE SKIN' : 'covered'}`);
    }
  }
}
c.dispose();
