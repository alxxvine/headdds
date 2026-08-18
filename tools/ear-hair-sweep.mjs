// Are the ears and the hair actually SITTING ON the scalp?
//   node tools/ear-hair-sweep.mjs [creatures]
//
// hair.js ends with a pass that is meant to make this question moot: it measures
// the built strand against the skin and pushes it in until its lowest point is
// under. ears.js has no such pass at all. This checks both, against a skin
// measure that is not the one hair.js uses — see tools/lib-skin.mjs for why the
// one it uses cannot answer the question.
//
// Per seated part, in head units (S = headUnit(p) ~ the skull's half-width):
//   seat    smallest true clearance between the part and the skin under it.
//           >0 means nothing of the part touches the skull: it floats.
//   code    the same quantity as hair.js measures it. seat>0>=code is the sink
//           pass being told it has finished when it has not.
//   dive    the part leaves the skin and then goes back under it further out:
//           a segment curled into the skull. Reported with how deep it gets.
//   sunk    share of the part's own surface below the skin.
import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { headPoint } from '../src/creature/head.js';
import { skinProbe } from './lib-skin.mjs';

const N = Number(process.argv[2] || 400);
const FLOOR = 0.05;   // below this a claim is tessellation noise, not a defect

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();

const rows = [];
const perCreature = [];
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  const seed = i * 11 + 3;
  const p = randomize(seed);
  const c = buildCreature(p);
  c.group.updateMatrixWorld(true);
  const head = c.rig.headPivot.children[0];
  let headMesh = null;
  head.traverse((o) => { if (!headMesh && o.isMesh && o.material?.side !== THREE.BackSide) headMesh = o; });
  const probe = skinProbe(headMesh);
  const S = c.rig.scale;

  // addGrowths returns addHair(...).concat(addEars(...)), and addEars pushes
  // exactly one pivot per side, so the last two entries are the ears.
  const list = c.rig.tendrils;
  const nEars = p.earType === 'none' ? 0 : 2;
  let worstHair = -9, worstEar = -9;

  list.forEach((t, k) => {
    const isEar = k >= list.length - nEars;
    const root = t.pivot.position.clone();
    const pts = [];
    t.pivot.traverse((o) => {
      if (!o.isMesh || o.material?.side === THREE.BackSide) return;
      const pos = o.geometry.attributes.position;
      if (!pos) return;
      for (let q = 0; q < pos.count; q++) {
        _v.fromBufferAttribute(pos, q).applyMatrix4(o.matrixWorld);
        headMesh.worldToLocal(_v);
        if (_v.lengthSq() < 1e-9) continue;
        _d.copy(_v).normalize();
        headPoint(p, _d, _s);
        pts.push({ r: _v.distanceTo(root) / S, g: probe.proud(_v) / S, c: (_v.length() - _s.length()) / S });
      }
    });
    if (!pts.length) return;

    const seat = Math.min(...pts.map((q) => q.g));
    const code = Math.min(...pts.map((q) => q.c));
    const sunk = pts.filter((q) => q.g < 0).length / pts.length;

    // "curls back into the skull": ordered outward from the root, the part is
    // clear of the skin somewhere and buried again further out.
    pts.sort((a, b) => a.r - b.r);
    let clearAt = Infinity, dive = 0;
    for (const q of pts) {
      if (q.g > 0.02) clearAt = Math.min(clearAt, q.r);
      else if (q.r > clearAt + 0.02 && -q.g > dive) dive = -q.g;
    }

    const row = {
      seed, p, seat, code, sunk, dive,
      kind: isEar ? `ear:${p.earType}` : `hair:${p.hairType}`,
      family: isEar ? 'ear' : 'hair',
      size: isEar ? p.earSize : p.tendrilLen,
    };
    rows.push(row);
    if (isEar) worstEar = Math.max(worstEar, seat); else worstHair = Math.max(worstHair, seat);
  });
  perCreature.push({ seed, worstHair, worstEar, p });
  c.dispose();
  if ((i + 1) % 25 === 0) process.stderr.write(`  ${i + 1}/${N}\r`);
}

const pct = (a, b) => `${(100 * a / Math.max(1, b)).toFixed(0)}%`;
const qs = (a, f) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(f * (a.length - 1))] : 0);
const fmt = (a, f) => qs(a, f).toFixed(3);

console.log(`${N} random creatures, ${rows.length} ear/hair parts   (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
console.log(`nothing below ${FLOOR} head units is claimed: the probe is exact on the drawn mesh, but the drawn mesh is a 5120-triangle icosahedron whose facets cut corners\n`);

for (const fam of ['hair', 'ear']) {
  const f = rows.filter((r) => r.family === fam);
  const floaters = f.filter((r) => r.seat > FLOOR);
  const divers = f.filter((r) => r.dive > FLOOR);
  const g = f.map((r) => r.seat);
  const cre = perCreature.filter((r) => (fam === 'hair' ? r.worstHair : r.worstEar) > -9);
  const creBad = cre.filter((r) => (fam === 'hair' ? r.worstHair : r.worstEar) > FLOOR);
  console.log(`${fam.toUpperCase()}  ${f.length} parts on ${cre.length} creatures`);
  console.log(`  parts floating clear of the skull   ${pct(floaters.length, f.length).padStart(4)}    seat gap: median ${fmt(g, 0.5)}  p90 ${fmt(g, 0.9)}  p99 ${fmt(g, 0.99)}  max ${fmt(g, 1)}`);
  console.log(`  CREATURES carrying one               ${pct(creBad.length, cre.length).padStart(4)}`);
  const fooled = floaters.filter((r) => r.code <= 0);
  console.log(`  floaters that hair.js's own measure calls seated (code<=0)   ${pct(fooled.length, Math.max(1, floaters.length))} of them`);
  const still = f.filter((r) => r.code > 0.01);
  console.log(`  parts still positive by that measure after the pass ran      ${pct(still.length, f.length)}`);
  console.log(`  parts that leave the skin and curl back under it  ${pct(divers.length, f.length).padStart(4)}    depth: median ${fmt(divers.map((r) => r.dive), 0.5)}  max ${fmt(divers.map((r) => r.dive), 1)}`);

  const by = new Map();
  for (const r of f) {
    let e = by.get(r.kind);
    if (!e) by.set(r.kind, e = { n: 0, bad: 0, dive: 0, seats: [], sunk: [] });
    e.n++; e.seats.push(r.seat); e.sunk.push(r.sunk);
    if (r.seat > FLOOR) e.bad++;
    if (r.dive > FLOOR) e.dive++;
  }
  console.log(`  kind             parts  float  medSeat  p95Seat  medSunk  curlsBack`);
  for (const [k, e] of [...by.entries()].sort((a, b) => (b[1].bad / b[1].n) - (a[1].bad / a[1].n) || (b[1].dive / b[1].n) - (a[1].dive / a[1].n))) {
    console.log(`    ${k.padEnd(16)} ${String(e.n).padStart(5)}  ${pct(e.bad, e.n).padStart(5)} ${fmt(e.seats, 0.5).padStart(8)} ${fmt(e.seats, 0.95).padStart(8)}   ${qs(e.sunk, 0.5).toFixed(2)}     ${pct(e.dive, e.n).padStart(4)}`);
  }
  console.log('  worst seats:');
  for (const r of f.slice().sort((a, b) => b.seat - a.seat).slice(0, 8)) {
    console.log(`    seed ${String(r.seed).padStart(5)}  seat ${r.seat.toFixed(3)}  code ${r.code.toFixed(3)}  ${r.kind.padEnd(15)} earSize ${r.p.earSize.toFixed(2)} earY ${r.p.earY.toFixed(2)} hairLen ${r.p.tendrilLen.toFixed(2)} lumps ${r.p.lumps.toFixed(2)}`);
  }
  console.log();
}
