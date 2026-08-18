// The growths family, measured where the other sweeps do not look:
//   node tools/growth-sweep.mjs [creatures]
//
// Everything here is aimed along a normal on a lumpy skull, or sized against
// `headUnit` — the average of two SLIDERS, which says nothing about the shape
// they produced. Four questions:
//
//  1. WARTS. addGrowths seats a wart at hit.point + 0.25 * wartSize * S along
//     the normal, and then scales it. The scale it picks is per-instance and
//     the seat offset is not, so whether a wart touches the skin at all depends
//     on a roll that the seat knows nothing about.
//  2. HORNS. The horn is planted AT hit.point and aimed along
//     normalize(0.55*n + up), which on a side-of-the-head horn is most of a
//     right angle away from the normal. Its base disc is a disc: tilt it and
//     one side of the rim lifts off the skull.
//  3. SCARS. The dot centres are drawn in SLIDER units (headWidth * 0.45,
//     headHeight * 0.3, len from headHeight) and then handed to surfaceAt,
//     which walks a miss back towards the middle of the face. Whatever the
//     walk does is invisible to the caller.
//  4. AURA. Every radius in aura.js is a multiple of S = (headWidth +
//     headHeight)/2. Nothing in the file ever asks how wide the skull is.
//
// Measurement rules, same as seat-sweep: the skin is solved ALONG A RAY, never
// as |headPoint(v.normalized())| (that one-liner is out by up to 0.86 world
// units on the skull's own surface points); every claimed defect is confirmed
// against the tessellated mesh that is actually drawn — inside/outside by
// ray-parity, daylight by raycast projected onto the hit face normal; and every
// distance is divided by rig.scale so a big and a small creature compare.
//
// GROWTH_SWEEP_SELFTEST=1 plants a wart-sized chip a fifth of a head off the
// skin, a horn frame tipped 60 degrees off its normal, and a mote at the middle
// of the skull, so the four numbers below can be seen to fire.

import * as THREE from 'three';

// ---------------------------------------------------------- provenance ----
// Nothing in src/ is named or tagged and this tool may not edit src/, so the
// builder is read off the stack the first time an object is parented.
const SITE = new WeakMap();
const realAdd = THREE.Object3D.prototype.add;
THREE.Object3D.prototype.add = function growthSweepAdd(...kids) {
  let site = null;
  for (const k of kids) {
    if (!k || SITE.has(k)) continue;
    if (!site) {
      const frames = new Error().stack.split('\n').slice(2);
      const f = frames.find((l) => /src[/\\]creature[/\\]/.test(l) && !/materials\.js|warp\.js/.test(l)) || frames[0] || '';
      const m = /at (?:new )?([\w.<>]+) .*[/\\]([\w.-]+\.js):(\d+)/.exec(f);
      site = m ? { fn: m[1], file: m[2], line: Number(m[3]) } : { fn: '?', file: '?', line: 0 };
    }
    SITE.set(k, site);
  }
  return realAdd.apply(this, kids);
};

// ------------------------------------------------- the frontal-ray log ----
// surface.js's surfaceAt is the only thing on the head that RELOCATES a
// request: it fires a ray at (x, y), and on a miss walks the query 7% at a
// time towards the middle of the face, up to 12 times. The caller is told
// nothing. Every scar dot goes through it. Rather than guess how often that
// fires, the raycaster itself is logged: origin in, hit out, and which builder
// asked. A run of failing calls followed by one that lands IS one surfaceAt.
let RAYLOG = null;
const realIntersect = THREE.Raycaster.prototype.intersectObject;
THREE.Raycaster.prototype.intersectObject = function growthSweepCast(obj, recursive, out) {
  const hits = realIntersect.call(this, obj, recursive, out);
  if (RAYLOG) {
    const stack = new Error().stack;
    if (/at surfaceAt /.test(stack)) {
      const m = /at (addScars|decalGeometry|bandGeometry|addEyes|addNose|addTeeth|addMouth|settleEyes|[\w.<>]+) /g;
      const who = [...stack.matchAll(m)].map((x) => x[1]);
      let land = null;
      for (const h of hits) {
        const n = h.face ? h.face.normal : null;
        if (n && n.z <= 0.05) continue;   // surfaceAt's own filter
        land = h.point;
        break;
      }
      RAYLOG.push({
        x: this.ray.origin.x,
        y: this.ray.origin.y,
        who,
        hit: land ? { x: land.x, y: land.y, z: land.z } : null,
      });
    }
  }
  return hits;
};

const { buildCreature } = await import('../src/creature/build.js');
const { randomize } = await import('../src/creature/schema.js');
const { headPoint, headSurfaceByDir, headHalfWidth } = await import('../src/creature/head.js');
const { skinProbe } = await import('./lib-skin.mjs');
const { radialSkin, proudAnalytic } = await import('./lib-radial.mjs');

const N = Number(process.argv[2] || 400);
const SELFTEST = process.env.GROWTH_SWEEP_SELFTEST === '1';

// Below this a claim is the tool's own noise: the ray-solved skin sits within
// 0.03 head units of a raycast on the drawn mesh at p90 (lib-radial's own
// calibration), so 0.06 is the line every sweep in here uses.
const LOUD = 0.06;

// ------------------------------------------------------------ geometry ----
const _v = new THREE.Vector3();
const _u = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s3 = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _im = new THREE.Matrix4();

/** every vertex of a mesh (one instance of it) in the skull's own frame */
function vertsOf(mesh, toHead, instance = -1) {
  const pos = mesh.geometry.attributes.position;
  _m4.multiplyMatrices(toHead, mesh.matrixWorld);
  if (instance >= 0) { mesh.getMatrixAt(instance, _im); _m4.multiply(_im); }
  const step = Math.max(1, Math.floor(pos.count / 240));
  const out = [];
  for (let i = 0; i < pos.count; i += step) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(_m4);
    out.push(_v.x, _v.y, _v.z);
  }
  return out;
}

/**
 * Daylight between a head-local point and the drawn skull, measured by raycast
 * along the point's own direction and then projected onto the face normal it
 * hits — a radial gap over a steeply oblique temple is far longer than the gap
 * a player sees, and projecting only ever makes the claim smaller.
 */
const _rc = new THREE.Raycaster();
const _o0 = new THREE.Vector3();
const _o1 = new THREE.Vector3();
function meshGap(skull, toHead, v) {
  if (v.lengthSq() < 1e-12) return -Infinity;
  const u = _o0.copy(v).normalize().clone();
  _o1.copy(u).multiplyScalar(60).applyMatrix4(skull.matrixWorld);
  _o0.copy(u).multiplyScalar(59).applyMatrix4(skull.matrixWorld).sub(_o1).normalize();
  _rc.set(_o1, _o0);
  const hit = realIntersect.call(_rc, skull, false)[0];
  if (!hit) return null;
  const along = v.length() - hit.point.applyMatrix4(toHead).length();
  const n = hit.face ? Math.abs(hit.face.normal.dot(u)) : 1;
  return along * Math.max(0.15, n);
}

/**
 * Inside a closed mesh or not, by ray parity — no surface solve involved.
 *
 * The material's `side` has to be flipped first: every material on this
 * creature is FrontSide, so a ray leaving a mesh from the inside hits only
 * back faces and three.js reports NO intersection at all. A parity test run
 * without this reads "outside" for every point inside every part, which is a
 * silent zero, and a silent zero from a checking tool is worse than no tool.
 * Three directions and a majority, so one grazing ray along an edge cannot
 * decide it.
 */
const PARITY = [
  new THREE.Vector3(0.3411, 0.7331, -0.5877).normalize(),
  new THREE.Vector3(-0.7701, 0.2113, 0.6017).normalize(),
  new THREE.Vector3(0.1132, -0.9307, 0.3479).normalize(),
];
function insideMesh(mesh, worldPoint) {
  const side = mesh.material.side;
  mesh.material.side = THREE.DoubleSide;
  let yes = 0;
  for (const d of PARITY) {
    _rc.set(worldPoint, d);
    _rc.far = Infinity;
    if (realIntersect.call(_rc, mesh, false).length % 2 === 1) yes++;
  }
  mesh.material.side = side;
  return yes >= 2;
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : '  -');
const q = (a, f) => {
  if (!a.length) return { med: 0, p90: 0, max: 0 };
  const s = [...a].sort((x, y) => x - y);
  const at = (t) => s[Math.min(s.length - 1, Math.floor(t * s.length))];
  return { med: at(0.5), p90: at(0.9), max: s[s.length - 1] };
};
const line = (a) => { const r = q(a); return `median ${r.med.toFixed(3)}  p90 ${r.p90.toFixed(3)}  max ${r.max.toFixed(3)}`; };
const top = (m, k = 6) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)
  .map(([kk, v]) => `${kk} ${v}`).join(',  ');

// -------------------------------------------------------------- the sweep --
const t0 = Date.now();

const wartAir = [];       // clearance of a whole wart off the skin, head units
const wartGeo = [];       // the same clearance predicted from the seat formula alone
const wartByScl = [];     // [scaleAlongNormal, clearance]
const wartWorst = [];
const wartAnalytic = [];
const wartMismatch = [];
let wartN = 0; let wartFloat = 0; let creaturesWithWarts = 0; let creaturesFloatWart = 0;
let wartOnEye = 0; let wartEyePairs = 0; let creaturesWartOnEye = 0;
const wartEyeWorst = [];

const hornLift = [];
const hornTilt = [];
const hornPairs = [];
const hornWorst = [];
const hornAnalytic = [];
const hornModel = [];
const hornPred = [];
let hornN = 0; let hornGap = 0; let creaturesWithHorns = 0; let creaturesGapHorn = 0;

const scarMove = [];
const scarWorst = [];
const scarWhy = [];
const scarAsk = [];
let scarCreatures = 0; let scarMoved = 0; let scarDots = 0; let scarMovedDots = 0;
let scarPileCreatures = 0;
let scarSamples = 0; let scarRelocated = 0;
const scarPile = [];

const auraKinds = new Map();   // kind -> {motes, buried, cre, creBuried, depth[], torso}
const auraWorst = [];
const auraClear = [];
let auraCre = 0;

for (let i = 0; i < N; i++) {
  const seed = i * 11 + 3;
  const p = randomize(seed);
  RAYLOG = [];
  const c = buildCreature(p);
  const log = RAYLOG;
  RAYLOG = null;
  c.group.updateMatrixWorld(true);
  const S = c.rig.scale;
  const headGroup = c.rig.headPivot.children[0];
  const skull = headGroup.children[0];
  const toHead = new THREE.Matrix4().copy(headGroup.matrixWorld).invert();
  const probe = skinProbe(skull);
  const skinAt = new THREE.Vector3();

  // ---- who is who --------------------------------------------------------
  let wartsInst = null;
  const horns = [];
  let aura = null;
  const scarDotMeshes = [];
  for (const ch of headGroup.children) {
    const s = SITE.get(ch) || { fn: '?', file: '?' };
    if (s.file === 'aura.js' || ch === c.rig.spores) { aura = ch; continue; }
    if (s.fn === 'addGrowths' && ch.isInstancedMesh) wartsInst = ch;
    else if (s.fn === 'addGrowths' && ch.isGroup) horns.push(ch);
    else if (s.fn === 'addScars') scarDotMeshes.push(ch);
  }

  // ---- 1. warts ----------------------------------------------------------
  if (wartsInst) {
    creaturesWithWarts++;
    const R = p.wartSize * S;
    let worst = -Infinity; let worstScl = 0;
    for (let k = 0; k < wartsInst.count; k++) {
      wartN++;
      wartsInst.getMatrixAt(k, _im);
      _m4.multiplyMatrices(toHead, wartsInst.matrixWorld).multiply(_im);
      _m4.decompose(_c, _q, _s3);
      _n.set(0, 0, 1).applyQuaternion(_q);          // the normal the seat used
      const cen = _c.clone();
      const nrm = _n.clone();

      // clearance of the whole wart off the drawn skin
      const vs = vertsOf(wartsInst, toHead, k);
      let air = Infinity; let lowest = Infinity; let airAn = Infinity;
      for (let t = 0; t < vs.length; t += 3) {
        _v.set(vs[t], vs[t + 1], vs[t + 2]);
        air = Math.min(air, probe.proud(_v));
        airAn = Math.min(airAn, proudAnalytic(p, _v));
        lowest = Math.min(lowest, _v.clone().sub(cen).dot(nrm));
      }
      wartAnalytic.push(airAn / S);
      // the surface addGrowths planted on, against the surface that is drawn,
      // at this wart's own seat direction
      wartMismatch.push([probe.proud(cen.clone().addScaledVector(nrm, -0.25 * R)) / S, air / S]);
      // what the seat formula alone predicts: the wart's own reach back along
      // the normal, against the 0.25*R it was pushed out by
      wartGeo.push((0.25 * R + lowest) / S);
      wartByScl.push([_s3.z, air / S]);
      if (air > worst) { worst = air; worstScl = _s3.z; }
      if (air > LOUD * S) {
        // confirm against the mesh that is drawn, not the solve
        let conf = Infinity;
        for (let t = 0; t < vs.length; t += 3) {
          const g = meshGap(skull, toHead, _v.set(vs[t], vs[t + 1], vs[t + 2]));
          if (g !== null) conf = Math.min(conf, g);
        }
        if (conf > LOUD * S) { wartFloat++; wartAir.push(conf / S); }
      }
    }
    if (worst > LOUD * S) {
      creaturesFloatWart++;
      wartWorst.push({ seed, gap: worst / S, sclz: worstScl, R: p.wartSize, n: p.warts });
    }

    // A wart is planted by direction with no knowledge of anything already on
    // the face except the maw, and the maw guard is a cone in DIRECTION space
    // that never reads the mouth's size. Tested as geometry, not as radii: a
    // vertex of one part inside the closed hull of another, by ray parity.
    const victims = [];
    for (const e of (c.rig.eyes || [])) {
      e.pivot.traverse((o) => {
        if (o.isMesh && o.material?.side !== THREE.BackSide && !o.isInstancedMesh) victims.push(['eye', o]);
      });
      if (e.stalk) e.stalk.traverse((o) => {
        if (o.isMesh && o.material?.side !== THREE.BackSide && !o.isInstancedMesh) victims.push(['eye', o]);
      });
    }
    for (const ch of headGroup.children) {
      const st = SITE.get(ch) || {};
      if (st.fn !== 'addNose' && st.fn !== 'buildNose') continue;
      ch.traverse((o) => {
        if (o.isMesh && o.material?.side !== THREE.BackSide && !o.isInstancedMesh) victims.push(['nose', o]);
      });
    }
    for (const [, o] of victims) if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    let hitKinds = new Set();
    let worstIn = 0;
    for (let k = 0; k < wartsInst.count; k++) {
      const vs = vertsOf(wartsInst, toHead, k);
      wartsInst.getMatrixAt(k, _im);
      _m4.multiplyMatrices(toHead, wartsInst.matrixWorld).multiply(_im);
      _m4.decompose(_c, _q, _s3);
      const wr = R * Math.max(_s3.x, _s3.y, _s3.z);
      for (const [what, o] of victims) {
        const bs = o.geometry.boundingSphere;
        _u.copy(bs.center).applyMatrix4(o.matrixWorld).applyMatrix4(toHead);
        const rr = bs.radius * Math.max(o.scale.x, o.scale.y, o.scale.z)
          * Math.max(o.parent?.scale.x ?? 1, o.parent?.scale.y ?? 1, o.parent?.scale.z ?? 1);
        if (_u.distanceTo(_c) > rr + wr + 0.02 * S) continue;
        // how deep the wart is into it: vertices of the wart inside the victim
        let inside = 0;
        for (let t = 0; t < vs.length; t += 3) {
          _v.set(vs[t], vs[t + 1], vs[t + 2]).applyMatrix4(headGroup.matrixWorld);
          if (insideMesh(o, _v)) inside++;
        }
        if (inside) {
          wartEyePairs++;
          hitKinds.add(what);
          worstIn = Math.max(worstIn, inside / (vs.length / 3));
        }
      }
    }
    if (hitKinds.size) {
      creaturesWartOnEye++;
      wartEyeWorst.push({ seed, ov: worstIn, n: p.warts, what: [...hitKinds].join('+') });
    }
  }

  // ---- 2. horns ----------------------------------------------------------
  if (horns.length) {
    creaturesWithHorns++;
    let worst = -Infinity; let worstTilt = 0;
    let hornIdx = -1;
    for (const frame of horns) {
      hornIdx++;
      hornN++;
      const fm = new THREE.Matrix4().multiplyMatrices(toHead, frame.matrixWorld);
      fm.decompose(_c, _q, _s3);
      const root = _c.clone();
      const aim = new THREE.Vector3(0, 0, 1).applyQuaternion(_q).normalize();
      // the normal the skull really has under the root: solve the direction
      // whose headPoint lands along the root, then ask head.js for its normal
      const dir = new THREE.Vector3();
      radialSkin(p, root, skinAt, dir);
      const nn = headSurfaceByDir(p, dir).normal.clone();
      const tilt = Math.acos(Math.min(1, Math.max(-1, aim.dot(nn)))) * 180 / Math.PI;
      hornTilt.push(tilt);

      // the base rim: horn vertices within a tenth of the horn's length of the
      // root, measured along the aim
      const inv = new THREE.Matrix4().copy(fm).invert();
      let lift = -Infinity;
      let lo = Infinity; let hi = -Infinity;
      const pts = [];
      frame.traverse((o) => {
        if (!o.isMesh || o.material?.side === THREE.BackSide) return;
        const pos = o.geometry.attributes.position;
        const mm = new THREE.Matrix4().multiplyMatrices(toHead, o.matrixWorld);
        for (let t = 0; t < pos.count; t++) {
          _v.fromBufferAttribute(pos, t).applyMatrix4(mm);
          const z = _v.clone().applyMatrix4(inv).z;
          lo = Math.min(lo, z); hi = Math.max(hi, z);
          pts.push(_v.x, _v.y, _v.z, z);
        }
      });
      const cut = lo + (hi - lo) * 0.12;
      let liftAn = -Infinity;
      let rimR = 0;
      for (let t = 0; t < pts.length; t += 4) {
        if (pts[t + 3] > cut) continue;
        const g = probe.proud(_v.set(pts[t], pts[t + 1], pts[t + 2]));
        lift = Math.max(lift, g);
        liftAn = Math.max(liftAn, proudAnalytic(p, _v));
        _u.copy(_v).sub(root);
        rimR = Math.max(rimR, _u.clone().addScaledVector(aim, -_u.dot(aim)).length());
      }
      // what a disc of that radius, tipped by that much, must lift by, less how
      // far the horn's base is sunk below the root along its own axis
      const sink = -lo;
      hornModel.push([(rimR * Math.sin(tilt * Math.PI / 180) - sink) / S, Math.max(0, liftAn) / S, Math.max(0, lift) / S, tilt, rimR / S, sink / S, hornIdx]);
      hornAnalytic.push(Math.max(0, liftAn) / S);
      hornPred.push([(rimR * Math.sin(tilt * Math.PI / 180) - sink) / S, Math.max(0, liftAn) / S]);
      if (lift > LOUD * S) {
        let conf = -Infinity;
        for (let t = 0; t < pts.length; t += 4) {
          if (pts[t + 3] > cut) continue;
          const g = meshGap(skull, toHead, _v.set(pts[t], pts[t + 1], pts[t + 2]));
          if (g !== null) conf = Math.max(conf, g);
        }
        if (conf > LOUD * S) { hornGap++; hornLift.push(conf / S); hornPairs.push([tilt, conf / S]); }
        else hornPairs.push([tilt, Math.max(0, lift / S)]);
      } else hornPairs.push([tilt, Math.max(0, lift / S)]);
      if (lift > worst) { worst = lift; worstTilt = tilt; }
    }
    if (worst > LOUD * S) {
      creaturesGapHorn++;
      hornWorst.push({ seed, lift: worst / S, tilt: worstTilt, n: p.horns, len: p.hornLen });
    }
  }

  // ---- 3. scars ----------------------------------------------------------
  if (p.wear >= 0.25) {
    scarCreatures++;
    // Every surfaceAt call addScars caused, in order. One call is a run of
    // misses closed by a hit; one DOT is a decalGeometry, and a decal opens
    // with `segs` samples of the very same point (its ring r = 0 collapses to
    // the centre), so a repeat of the request marks the start of a new dot.
    const calls = [];
    let run = [];
    for (const e of log) {
      if (!e.who.includes('addScars')) continue;
      run.push(e);
      if (e.hit) { calls.push({ want: run[0], got: e.hit, steps: run.length - 1 }); run = []; }
    }
    let dots = 0; let movedDots = 0; let worst = 0;
    const centres = [];
    for (let a = 0; a < calls.length; a++) {
      const same = a + 1 < calls.length
        && Math.abs(calls[a].want.x - calls[a + 1].want.x) < 1e-12
        && Math.abs(calls[a].want.y - calls[a + 1].want.y) < 1e-12;
      if (!same && !(a > 0
        && Math.abs(calls[a - 1].want.x - calls[a].want.x) < 1e-12
        && Math.abs(calls[a - 1].want.y - calls[a].want.y) < 1e-12)) continue;
      if (a > 0 && Math.abs(calls[a - 1].want.x - calls[a].want.x) < 1e-12
        && Math.abs(calls[a - 1].want.y - calls[a].want.y) < 1e-12) continue;
      // first sample of a new dot: this is the dot's own centre
      dots++;
      scarDots++;
      const d = Math.hypot(calls[a].got.x - calls[a].want.x, calls[a].got.y - calls[a].want.y);
      centres.push([calls[a].got.x, calls[a].got.y, calls[a].got.z]);
      if (calls[a].steps > 0) {
        movedDots++; scarMovedDots++; scarMove.push(d / S); worst = Math.max(worst, d / S);
        const wx = calls[a].want.x; const wy = calls[a].want.y;
        const half = headHalfWidth(p, wy);
        scarWhy.push(half <= 1e-6 ? 'above the crown / below the chin' : (Math.abs(wx) > half ? 'off the side of the skull' : 'inside the outline, missed anyway'));
        scarAsk.push([Math.abs(wx) / Math.max(half, 1e-6), wy / p.headHeight]);
      }
    }
    // and how many samples in total were relocated, dot centres or not
    const relocated = calls.filter((x) => x.steps > 0).length;
    scarSamples += calls.length;
    scarRelocated += relocated;
    if (movedDots) { scarMoved++; scarWorst.push({ seed, d: worst, moved: movedDots, of: dots, wear: p.wear }); }
    // relocated dots land on top of one another: a blob, not a scar
    let pile = 0;
    for (let a = 0; a < centres.length; a++) {
      for (let b = a + 1; b < centres.length; b++) {
        const dd = Math.hypot(centres[a][0] - centres[b][0], centres[a][1] - centres[b][1], centres[a][2] - centres[b][2]);
        if (dd < 0.01 * S) pile++;
      }
    }
    if (pile) { scarPileCreatures++; scarPile.push(pile); }
  }

  // ---- 4. aura -----------------------------------------------------------
  if (aura) {
    auraCre++;
    const kind = `aura:${p.aura}`;
    let rec = auraKinds.get(kind);
    if (!rec) auraKinds.set(kind, rec = { motes: 0, cre: 0, torso: 0, creTorso: 0, cut: 0, whole: 0, share: [], creCut: 0, depth: [] });
    rec.cre++;
    let deepest = 0; let inTorso = 0; let cut = 0;
    const bb = skull.geometry.boundingBox;
    aura.traverse((o) => {
      if (!o.isInstancedMesh) return;
      for (let k = 0; k < o.count; k++) {
        rec.motes++;
        const vs = vertsOf(o, toHead, k);
        let out = -Infinity;   // the mote's furthest point off the skin
        let low = Infinity;    // ...and its nearest, which is the one that touches
        for (let t = 0; t < vs.length; t += 3) {
          const g = probe.proud(_v.set(vs[t], vs[t + 1], vs[t + 2]));
          out = Math.max(out, g); low = Math.min(low, g);
        }
        o.getMatrixAt(k, _im);
        _m4.multiplyMatrices(toHead, o.matrixWorld).multiply(_im);
        _c.setFromMatrixPosition(_m4);
        auraClear.push([kind, low / S, (_c.y - bb.min.y) / Math.max(1e-6, bb.max.y - bb.min.y)]);

        if (low < 0) {
          // part of this mote is under the skin. Confirmed vertex by vertex on
          // the drawn mesh by ray parity, which knows nothing about the solve.
          let inN = 0; let seen = 0;
          for (let t = 0; t < vs.length; t += 3) {
            seen++;
            _v.set(vs[t], vs[t + 1], vs[t + 2]).applyMatrix4(headGroup.matrixWorld);
            if (insideMesh(skull, _v)) inN++;
          }
          if (inN) {
            rec.cut++; cut++;
            rec.share.push(inN / seen);
            if (inN === seen) rec.whole++;
            rec.depth.push(-low / S);
            deepest = Math.max(deepest, -low / S);
          }
        }
        if (c.rig.torso) {
          _m4.multiplyMatrices(o.matrixWorld, _im);
          _c.setFromMatrixPosition(_m4);
          if (insideMesh(c.rig.torso, _c)) { rec.torso++; inTorso++; }
        }
      }
    });
    if (cut) {
      rec.creCut++;
      auraWorst.push({ seed, kind, buried: cut, of: p.spores, deep: deepest, size: p.auraSize, W: p.headWidth, H: p.headHeight });
    }
    if (inTorso) rec.creTorso++;
  }

  if (SELFTEST && i === 0) {
    // three planted defects, so a 0% below can be told from a blind spot
    const R = 0.06 * S;
    const c0 = new THREE.Vector3();
    radialSkin(p, new THREE.Vector3(0.4, 0.3, 0.8).normalize(), c0);
    const chip = c0.clone().multiplyScalar(1 + (0.2 * S) / c0.length());
    console.error(`selftest: chip 0.2 head units off the skin reads ${(probe.proud(chip) / S).toFixed(3)}`);
    console.error(`selftest: mote at the middle of the skull reads inside=${insideMesh(skull, new THREE.Vector3(0, 0, 0).applyMatrix4(new THREE.Matrix4().copy(toHead).invert()))}`);
    const dir = new THREE.Vector3();
    radialSkin(p, c0, skinAt, dir);
    const nn = headSurfaceByDir(p, dir).normal.clone();
    const tipped = nn.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);
    console.error(`selftest: a frame tipped 60deg off its normal reads tilt=${(Math.acos(nn.dot(tipped)) * 180 / Math.PI).toFixed(1)}deg`);
  }

  c.dispose();
  if ((i + 1) % 25 === 0) process.stderr.write(`\r${i + 1}/${N}`);
}
process.stderr.write('\r');

// ------------------------------------------------------------- report -----
console.log(`${N} random creatures   (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
console.log(`nothing below ${LOUD} head units is claimed; every claim re-measured against the drawn mesh\n`);

console.log('1. WARTS — seated by a fixed push-out, sized by a per-instance roll');
console.log(`   creatures carrying warts                      ${creaturesWithWarts}/${N}`);
console.log(`   ...with at least one wart off the skin        ${pct(creaturesFloatWart, creaturesWithWarts)}  (${creaturesFloatWart})`);
console.log(`   individual warts off the skin                 ${pct(wartFloat, wartN)}  of ${wartN}   daylight: ${line(wartAir)}`);
{
  const r = q(wartGeo.filter((x) => x > 0));
  console.log(`   predicted by the seat formula alone (0.25*R + the wart's own reach back):`);
  console.log(`     warts whose own body never reaches the skin  ${pct(wartGeo.filter((x) => x > 0).length, wartGeo.length)}   ${line(wartGeo.filter((x) => x > 0))}`);
}
{
  const lo = wartByScl.filter(([s]) => s < 0.6).map(([, g]) => g);
  const hi = wartByScl.filter(([s]) => s >= 0.6).map(([, g]) => g);
  console.log(`     by the roll that scales it along the normal:  scl.z < 0.6 -> ${line(lo)}`);
  console.log(`                                                  scl.z >= 0.6 -> ${line(hi)}`);
}
for (const w of wartWorst.sort((a, b) => b.gap - a.gap).slice(0, 6)) {
  console.log(`     seed ${String(w.seed).padStart(5)}  ${w.gap.toFixed(3)}  wartSize ${w.R.toFixed(3)} x${w.n}  scl.z ${w.sclz.toFixed(2)}`);
}
{
  const an = wartAnalytic.filter((x) => x > LOUD).length;
  console.log(`   the same warts measured against the ANALYTIC skin they were planted on:  ${pct(an, wartAnalytic.length)} off it`);
  const bad = wartMismatch.filter(([, g]) => g > LOUD);
  const mm = bad.map(([m]) => m);
  console.log(`   at the seat point of a floating wart, the analytic skin stands ${line(mm)} above the drawn mesh`);
  const all = wartMismatch.map(([m]) => m);
  console.log(`   ...and at every wart's seat point, floating or not:              ${line(all)}`);
}
console.log(`   warts planted INTO an eye or a nose           ${pct(creaturesWartOnEye, creaturesWithWarts)}  (${wartEyePairs} wart/part pairs)`);
for (const w of wartEyeWorst.sort((a, b) => b.ov - a.ov).slice(0, 6)) {
  console.log(`     seed ${String(w.seed).padStart(5)}  ${(w.ov * 100).toFixed(0)}% of a wart inside the ${w.what}, ${w.n} warts`);
}

console.log('\n2. HORNS — planted at the skin, aimed 0.55*normal + up');
console.log(`   creatures with horns                          ${creaturesWithHorns}/${N}   horns ${hornN}`);
console.log(`   ...with a horn root standing off the skull    ${pct(creaturesGapHorn, creaturesWithHorns)}  (${creaturesGapHorn})`);
console.log(`   individual horns                              ${pct(hornGap, hornN)}   daylight under the rim: ${line(hornLift)}`);
console.log(`   tilt between the aim and the skin normal      ${line(hornTilt)} degrees`);
{
  const bands = [[0, 15], [15, 30], [30, 45], [45, 90]];
  for (const [a, b] of bands) {
    const g = hornPairs.filter(([t]) => t >= a && t < b);
    if (!g.length) continue;
    const bad = g.filter(([, l]) => l > LOUD).length;
    console.log(`     tilt ${String(a).padStart(2)}-${String(b).padStart(2)}deg: ${String(g.length).padStart(4)} horns, ${pct(bad, g.length)} lifted   ${line(g.map(([, l]) => l))}`);
  }
}
{
  console.log(`   the same horns measured against the ANALYTIC skin:            ${pct(hornAnalytic.filter((x) => x > LOUD).length, hornAnalytic.length)} lifted   ${line(hornAnalytic.filter((x) => x > LOUD))}`);
  console.log('   against the ANALYTIC skin, by tilt — the mesh has nothing to do with this:');
  for (const [a, b] of [[0, 15], [15, 30], [30, 45], [45, 90], [90, 181]]) {
    const g = hornModel.filter(([, , , t]) => t >= a && t < b);
    if (!g.length) continue;
    console.log(`     tilt ${String(a).padStart(2)}-${String(b).padStart(3)}deg: ${String(g.length).padStart(4)} horns, ${pct(g.filter(([, an]) => an > LOUD).length, g.length)} lifted   ${line(g.map(([, an]) => an))}`);
  }
  console.log('   by which pair of the crown the horn is (i = 0,1 the first pair, 2,3 the second...):');
  for (let ix = 0; ix < 8; ix++) {
    const g = hornModel.filter(([, , , , , , k]) => k === ix);
    if (!g.length) continue;
    console.log(`     horn ${ix}: ${String(g.length).padStart(4)}  tilt ${line(g.map(([, , , t]) => t))} deg   analytic lift ${line(g.map(([, an]) => an))}`);
  }
  const rr = hornModel.map(([, , , , r]) => r); const sk = hornModel.map(([, , , , , s2]) => s2);
  {
    const g = hornPred.filter(([, an]) => an > LOUD);
    console.log(`   for the lifted ones, a rim of that radius tipped by that much predicts ${line(g.map(([m]) => m))}, measured ${line(g.map(([, an]) => an))}`);
  }
  console.log(`   rim radius ${line(rr)} head units;  base sunk below the root ${line(sk)}`);
}
for (const h of hornWorst.sort((a, b) => b.lift - a.lift).slice(0, 6)) {
  console.log(`     seed ${String(h.seed).padStart(5)}  ${h.lift.toFixed(3)} under the rim at ${h.tilt.toFixed(0)}deg tilt, ${h.n} horns, hornLen ${h.len.toFixed(2)}`);
}

console.log('\n3. SCARS — dot centres drawn in slider units, relocated by surfaceAt without telling anyone');
console.log(`   creatures with wear >= 0.25                    ${scarCreatures}/${N}`);
console.log(`   ...with at least one dot relocated             ${pct(scarMoved, scarCreatures)}  (${scarMoved})`);
console.log(`   dot centres relocated                          ${pct(scarMovedDots, scarDots)}  of ${scarDots}   moved: ${line(scarMove)} head units`);
console.log(`   surfaceAt samples relocated                    ${pct(scarRelocated, scarSamples)}  of ${scarSamples}`);
console.log(`   creatures where relocated dots pile on one another  ${pct(scarPileCreatures, scarCreatures)}   pairs: ${line(scarPile)}`);
{
  const cnt = new Map();
  for (const w of scarWhy) cnt.set(w, (cnt.get(w) || 0) + 1);
  console.log(`   why the frontal ray missed: ${[...cnt.entries()].map(([k, v]) => `${k} ${v}`).join(',  ')}`);
  if (scarAsk.length) console.log(`   the request was ${line(scarAsk.map(([r]) => r))} times the skull's own half-width at its height`);
}
for (const s of scarWorst.sort((a, b) => b.d - a.d).slice(0, 6)) {
  console.log(`     seed ${String(s.seed).padStart(5)}  ${s.d.toFixed(3)} moved, ${s.moved}/${s.of} dots, wear ${s.wear.toFixed(2)}`);
}

console.log('\n4. AURA — every radius is a multiple of (headWidth + headHeight)/2');
console.log('   kind          creatures  motes   cutting into the skull        wholly inside   in the torso');
for (const [k, r] of [...auraKinds.entries()].sort((a, b) => b[1].buried / Math.max(1, b[1].motes) - a[1].buried / Math.max(1, a[1].motes))) {
  console.log(`   ${k.padEnd(13)} ${String(r.cre).padStart(6)}  ${String(r.motes).padStart(6)}   ${pct(r.cut, r.motes).padStart(4)} of motes, ${pct(r.creCut, r.cre).padStart(4)} of creatures   ${pct(r.whole, r.motes).padStart(5)}   ${(r.share.length ? (r.share.reduce((a, b) => a + b, 0) / r.share.length) : 0).toFixed(2)} of a cut mote under the skin   ${pct(r.torso, r.motes)}`);
}
{
  const kinds = [...new Set(auraClear.map(([k]) => k))];
  console.log('   how close a mote comes to the skin it is supposed to float around:');
  for (const k of kinds) {
    const g = auraClear.filter(([kk]) => kk === k).map(([, v]) => v);
    const touching = g.filter((v) => v < 0.05).length;
    console.log(`     ${k.padEnd(13)} clearance ${line(g)}   within 0.05 of the skin: ${pct(touching, g.length)}`);
    const bands = [[-9, 0.25], [0.25, 0.6], [0.6, 0.9], [0.9, 9]];
    const parts = [];
    for (const [lo, hi] of bands) {
      const gg = auraClear.filter(([kk, , y]) => kk === k && y >= lo && y < hi);
      if (gg.length) parts.push(`${lo < 0 ? 'chin' : hi > 1 ? 'over the crown' : `${lo}-${hi}`} ${pct(gg.filter(([, v]) => v < 0.05).length, gg.length)}`);
    }
    console.log(`     ${' '.repeat(13)} ...by height up the skull: ${parts.join(',  ')}`);
  }
}
for (const a of auraWorst.sort((x, y) => y.buried / Math.max(1, y.of) - x.buried / Math.max(1, x.of)).slice(0, 8)) {
  console.log(`     seed ${String(a.seed).padStart(5)}  ${a.kind.padEnd(12)} ${a.buried}/${a.of} motes inside, deepest ${a.deep.toFixed(2)}, auraSize ${a.size.toFixed(2)}, head ${a.W.toFixed(2)}x${a.H.toFixed(2)}`);
}
