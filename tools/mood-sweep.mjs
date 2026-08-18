// Checks that the five moods actually look like five different states:
//   node tools/mood-sweep.mjs [creatures]
//
// A mood is only worth having if a player can name it without being told. The
// posture layer gives each one a static offset, which is easy to write and easy
// to miss — what carries a state across a room is the RHYTHM: how fast the
// thing breathes, how often it blinks, whether it is holding still.
//
// So this takes a fingerprint of the motion itself rather than of any one
// frame: for each mood, with the drives pinned, it records how much each
// channel moves and how fast it cycles. Two moods whose fingerprints match are
// two moods a player cannot tell apart, whatever their postures say.

import * as THREE from 'three';
import { buildCreature } from '../src/creature/build.js';
import { randomize } from '../src/creature/schema.js';
import { createAnimator } from '../src/scene/animator.js';

const MOODS = [
  ['calm', { arousal: 0, anger: 0, fatigue: 0, attention: 0 }],
  ['alert', { arousal: 0.3, anger: 0, fatigue: 0, attention: 1 }],
  ['wired', { arousal: 1, anger: 0, fatigue: 0, attention: 1 }],
  ['hostile', { arousal: 1, anger: 1, fatigue: 0.2, attention: 1 }],
  ['spent', { arousal: 0.2, anger: 0, fatigue: 1, attention: 0.3 }],
];

// Gestures are picked with Math.random, so two moods would otherwise be
// compared over different sequences. Pin it.
let _s = 987654321;
const seedRandom = () => { _s = 987654321; };
Math.random = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };

const N = Number(process.argv[2] || 40);
const SECONDS = 24;
const STEP = 1 / 60;

/** what the creature is doing this frame, as a handful of numbers */
function sample(rig, out) {
  out.breath = rig.bodyPivot ? rig.bodyPivot.scale.y : 0;
  out.roll = rig.root.rotation.z;
  out.rootY = rig.root.position.y;
  const e = new THREE.Euler().setFromQuaternion(rig.headPivot.quaternion);
  out.headPitch = e.x;
  out.headYaw = e.y;
  out.jaw = rig.jaw ? new THREE.Euler().setFromQuaternion(rig.jaw.quaternion).x : 0;
  out.lid = rig.eyes[0]?.pivot ? rig.eyes[0].pivot.scale.y : 1;
  out.arm = rig.shoulders[0] ? new THREE.Euler().setFromQuaternion(rig.shoulders[0].quaternion).z : 0;
  return out;
}
const CHANNELS = ['breath', 'roll', 'rootY', 'headPitch', 'headYaw', 'jaw', 'lid', 'arm'];

/** amplitude and how often it turns around, per channel */
function trace(series) {
  const out = {};
  for (const c of CHANNELS) {
    const raw = series.map((s) => s[c]);
    // Split the signal before measuring it. A slow breath with a catch in it
    // turns around as often as a fast smooth one, so counting turning points on
    // the raw trace calls those two the same thing — and they are the whole
    // difference between exhausted and merely idle. The smoothed trace carries
    // the rhythm; what is left over is the tremor.
    const W = 13;
    const v = raw.map((_, i) => {
      let a = 0;
      let n = 0;
      for (let j = Math.max(0, i - W); j <= Math.min(raw.length - 1, i + W); j++) { a += raw[j]; n++; }
      return a / n;
    });
    const residual = raw.map((x, i) => x - v[i]);
    let rTurns = 0;
    let rAmp = 0;
    for (let i = 2; i < residual.length; i++) {
      const a = residual[i] - residual[i - 1];
      const b = residual[i - 1] - residual[i - 2];
      if (a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) rTurns++;
      rAmp = Math.max(rAmp, Math.abs(residual[i]));
    }
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    let amp = 0;
    let turns = 0;
    let energy = 0;
    for (let i = 0; i < v.length; i++) {
      amp = Math.max(amp, Math.abs(v[i] - mean));
      if (i > 1) {
        const a = v[i] - v[i - 1];
        const b = v[i - 1] - v[i - 2];
        if (a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) turns++;
        energy += Math.abs(a);
      }
    }
    // turns per second, halved: a full cycle turns around twice
    // How UNEVEN the motion is: a creature that moves, stops and moves again
    // has the same average energy as one that ambles steadily, and reads
    // completely differently. Measured as the spread of per-second energy.
    const perSec = [];
    for (let s0 = 0; s0 + 60 <= v.length; s0 += 60) {
      let e = 0;
      for (let i = s0 + 1; i < s0 + 60; i++) e += Math.abs(v[i] - v[i - 1]);
      perSec.push(e);
    }
    const em = perSec.reduce((a, b) => a + b, 0) / Math.max(1, perSec.length);
    const uneven = em > 1e-9
      ? Math.sqrt(perSec.reduce((a, b) => a + (b - em) ** 2, 0) / Math.max(1, perSec.length)) / em
      : 0;
    out[c] = {
      mean, amp, hz: turns / 2 / SECONDS, energy: energy / SECONDS, uneven,
      tremorHz: rTurns / 2 / SECONDS, tremorAmp: rAmp,
    };
  }
  return out;
}

const per = new Map(MOODS.map(([n]) => [n, []]));
for (let i = 0; i < N; i++) {
  const p = randomize(2000 + i * 13);
  for (const [name, drives] of MOODS) {
    const built = buildCreature(p);
    seedRandom();
    const an = createAnimator();
    an.update(built.rig, built.stats, STEP, { pointer: { x: 0, y: 0 }, active: false });
    const series = [];
    for (let f = 0; f < SECONDS * 60; f++) {
      Object.assign(an.drives, drives);
      an.update(built.rig, built.stats, STEP, { pointer: { x: 0.2, y: 0.1 }, active: true });
      built.group.updateMatrixWorld(true);
      series.push(sample(built.rig, {}));
    }
    per.get(name).push(trace(series));
    built.dispose();
  }
}

/** the average fingerprint of a mood over the whole population */
const average = (traces) => {
  const out = {};
  for (const c of CHANNELS) {
    out[c] = {};
    for (const k of ['mean', 'amp', 'hz', 'energy', 'uneven', 'tremorHz', 'tremorAmp']) {
      out[c][k] = traces.reduce((a, t) => a + t[c][k], 0) / traces.length;
    }
  }
  return out;
};
const fp = new Map([...per].map(([n, t]) => [n, average(t)]));

console.log(`${N} creatures, ${SECONDS}s of animation each, five moods\n`);
console.log('breathing and holding still — the rhythm a player reads between gestures');
console.log('mood     breath hz  breath amp   sway hz  sway amp   blinks/min   total motion   unevenness    ragged');
for (const [n, f] of fp) {
  console.log(
    n.padEnd(9),
    f.breath.hz.toFixed(2).padStart(8),
    f.breath.amp.toFixed(4).padStart(11),
    f.roll.hz.toFixed(2).padStart(9),
    f.roll.amp.toFixed(4).padStart(9),
    (f.lid.hz * 60).toFixed(1).padStart(12),
    CHANNELS.reduce((a, c) => a + f[c].energy, 0).toFixed(3).padStart(14),
    (CHANNELS.reduce((a, c) => a + f[c].uneven, 0) / CHANNELS.length).toFixed(2).padStart(11),
    f.breath.tremorAmp.toFixed(4).padStart(10),
  );
}

// How far apart are two moods? Each channel measure is scaled by the spread of
// that measure over all five, so a channel nobody varies cannot drown out one
// that separates them.
const span = {};
for (const c of CHANNELS) {
  for (const k of ['mean', 'amp', 'hz', 'energy', 'uneven', 'tremorHz', 'tremorAmp']) {
    const vals = [...fp.values()].map((f) => f[c][k]);
    span[`${c}.${k}`] = Math.max(1e-9, Math.max(...vals) - Math.min(...vals));
  }
}
const distance = (a, b) => {
  let d = 0;
  let n = 0;
  for (const c of CHANNELS) {
    for (const k of ['mean', 'amp', 'hz', 'energy', 'uneven', 'tremorHz', 'tremorAmp']) {
      d += Math.abs(a[c][k] - b[c][k]) / span[`${c}.${k}`];
      n++;
    }
  }
  return d / n;
};

console.log('\nhow far apart the moods are — 0 is indistinguishable, 1 is as far as this set goes');
const names = [...fp.keys()];
console.log('         ' + names.map((n) => n.slice(0, 7).padStart(8)).join(''));
let worst = [1, '', ''];
for (const a of names) {
  const row = names.map((b) => (a === b ? '    —   ' : distance(fp.get(a), fp.get(b)).toFixed(2).padStart(8)));
  console.log(a.padEnd(9) + row.join(''));
  for (const b of names) {
    if (a === b) continue;
    const d = distance(fp.get(a), fp.get(b));
    if (d < worst[0]) worst = [d, a, b];
  }
}
console.log(`\nclosest pair: ${worst[1]} and ${worst[2]}, ${worst[0].toFixed(3)} apart`);
