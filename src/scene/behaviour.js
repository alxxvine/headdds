import { makeRng } from '../lib/noise.js';

// Idle motion alone reads as "breathing statue". This layer gives the creature
// things to *do*: every few seconds it picks an action — a scratch, a stretch,
// a hop, a roar — and that action drives the whole body, not just the head.
//
// Actions do not touch the rig. They write offsets into a pose struct which the
// animator adds on top of its idle layers and applies in one place, so the two
// can never fight over the same transform.

const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** 0 -> 1 -> 0, the shape of a single gesture */
const bell = (k) => Math.sin(Math.PI * clamp01(k));
/** n beats inside one action, each a small bell */
const beats = (k, n) => Math.sin(Math.PI * clamp01(k) * n) * bell(k);
/** rises and stays up, then releases at the end */
const hold = (k) => Math.min(1, clamp01(k) * 3) * Math.min(1, (1 - clamp01(k)) * 4);

export function blankPose() {
  return {
    root: { x: 0, y: 0, yaw: 0, roll: 0 },
    body: { lean: 0, twist: 0, squash: 0 },
    head: { pitch: 0, yaw: 0, roll: 0 },
    jaw: 0,
    arms: [
      { lift: 0, twist: 0, swing: 0 },
      { lift: 0, twist: 0, swing: 0 },
    ],
    legs: [
      { lift: 0, swing: 0 },
      { lift: 0, swing: 0 },
    ],
    eyes: { x: 0, y: 0, squint: 0, wide: 0 },
    hair: 0,
    // how hard the creature is holding itself still; the animator damps its
    // own idle layers by it, which is the only way a gesture can express
    // stopping rather than moving
    still: 0,
  };
}

export function resetPose(pose) {
  pose.root.x = pose.root.y = pose.root.yaw = pose.root.roll = 0;
  pose.body.lean = pose.body.twist = pose.body.squash = 0;
  pose.head.pitch = pose.head.yaw = pose.head.roll = 0;
  pose.jaw = 0;
  for (const a of pose.arms) { a.lift = 0; a.twist = 0; a.swing = 0; }
  for (const l of pose.legs) { l.lift = 0; l.swing = 0; }
  pose.eyes.x = pose.eyes.y = pose.eyes.squint = pose.eyes.wide = 0;
  pose.hair = 0;
  pose.still = 0;
  return pose;
}

/**
 * Who this particular freak is. Half of it comes from the seed, so two
 * creatures with the same stats still behave differently; the other half comes
 * from the stats, so behaviour matches the body you are looking at.
 */
export function makePersonality(seed, stats) {
  const rng = makeRng((seed >>> 0) ^ 0x5eed1e);
  const v = stats?.values ?? {};
  const n = (x) => clamp01(((x ?? 50) - 5) / 90);
  const has = (id) => !!stats?.traits?.some((t) => t.id === id);

  return {
    jitter: 0.3 + rng() * 0.5 + n(v.speed) * 0.5,     // how often it does anything
    boldness: 0.15 + rng() * 0.5 + n(v.dread) * 0.6,  // roars and stretches
    curiosity: 0.15 + rng() * 0.4 + n(v.sight) * 0.7, // looks around, inspects itself
    hunger: 0.15 + rng() * 0.4 + n(v.bite) * 0.7,     // chewing and snapping
    laziness: 0.15 + rng() * 0.4 + (1 - n(v.speed)) * 0.5,
    unsteady: 1 - n(v.balance),
    blind: has('blind'),
  };
}

// Each action: how likely it is, how long it runs, and what it does to the pose.
// `k` is eased 0..1 progress, `c` carries the picked side and the creature.
export const ACTIONS = [
  {
    id: 'lookAround',
    weight: (P) => 1 + P.curiosity * 2.5,
    dur: [1.6, 3.0],
    apply: (pose, k, c) => {
      const turn = Math.sin(k * Math.PI * 2) * (0.5 + c.P.curiosity * 0.35);
      pose.head.yaw += turn;
      pose.body.twist += turn * 0.35;
      pose.eyes.x += turn * 1.4;
      pose.root.yaw += turn * 0.12;
    },
  },
  {
    id: 'fidget',
    weight: (P) => 0.8 + P.jitter * 2,
    dur: [0.9, 1.6],
    apply: (pose, k, c) => {
      const tw = beats(k, 5);
      pose.arms[c.side].lift += tw * 0.38;
      pose.arms[1 - c.side].lift += tw * -0.2;
      pose.legs[c.side].swing += tw * 0.12;
      pose.body.twist += tw * 0.1;
      pose.head.roll += tw * 0.06;
    },
  },
  {
    id: 'scratch',
    weight: (P) => 0.7 + P.jitter * 1.2,
    dur: [1.8, 2.8],
    apply: (pose, k, c) => {
      const reach = hold(k);
      const rub = beats(k, 7) * reach;
      // the arm comes up to the head and the head leans into it
      pose.arms[c.side].lift += reach * -1.25 + rub * 0.2;
      pose.arms[c.side].swing += reach * -0.6; // reaching in towards the head
      pose.head.roll += reach * 0.16 * (c.side === 0 ? 1 : -1) + rub * 0.05;
      pose.head.pitch += reach * 0.1;
      pose.eyes.squint += reach * 0.45;
      pose.hair += rub * 1.2;
    },
  },
  {
    id: 'stretch',
    weight: (P) => 0.5 + P.boldness * 1.2,
    dur: [2.2, 3.2],
    apply: (pose, k, c) => {
      const up = hold(k);
      pose.arms[0].lift += up * -1.3;
      pose.arms[1].lift += up * -1.3;
      pose.arms[0].swing += up * 0.35;
      pose.arms[1].swing += up * 0.35;
      pose.body.squash += up * 0.09;      // the torso lengthens
      pose.head.pitch += up * -0.28;      // and the head tips back
      pose.jaw += bell(k) * 1.9;          // yawning at the top of it
      pose.eyes.squint += up * 0.8;
      pose.root.y += up * 0.05;
      pose.legs[0].lift += up * -0.1;
      pose.legs[1].lift += up * -0.1;
    },
  },
  {
    id: 'shiver',
    weight: (P) => 0.4 + (1 - P.boldness) * 1.4 + P.unsteady,
    dur: [1.0, 1.8],
    apply: (pose, k) => {
      const buzz = Math.sin(k * Math.PI * 26) * bell(k);
      pose.root.x += buzz * 0.012;
      pose.body.twist += buzz * 0.05;
      pose.head.roll += buzz * 0.07;
      pose.arms[0].swing += buzz * 0.12;
      pose.arms[1].swing += buzz * 0.12;
      pose.hair += Math.abs(buzz) * 2.2;
      pose.eyes.squint += bell(k) * 0.5;
    },
  },
  {
    id: 'sniff',
    weight: (P) => 0.6 + P.curiosity * 1.2 + (P.blind ? 1.5 : 0),
    dur: [1.6, 2.4],
    apply: (pose, k) => {
      const dip = hold(k);
      const twitch = beats(k, 9);
      pose.head.pitch += dip * 0.35 + twitch * 0.03;
      pose.body.lean += dip * 0.12;
      pose.root.y += dip * -0.015;
      pose.jaw += Math.abs(twitch) * 0.12;
      pose.eyes.squint += dip * 0.35;
    },
  },
  {
    id: 'chomp',
    weight: (P) => 0.5 + P.hunger * 2.2,
    dur: [1.4, 2.2],
    apply: (pose, k) => {
      const chew = Math.abs(beats(k, 6));
      pose.jaw += chew * 1.4;
      pose.head.pitch += chew * 0.08;
      pose.body.lean += chew * 0.05;
      pose.eyes.squint += chew * 0.4;
    },
  },
  {
    id: 'roar',
    weight: (P) => 0.25 + P.boldness * 2,
    dur: [1.8, 2.6],
    apply: (pose, k) => {
      const wind = Math.min(1, k * 3.2);        // rear back...
      const blast = bell(Math.max(0, (k - 0.28) / 0.72)); // ...then let go
      pose.head.pitch += wind * 0.22 - blast * 0.5;
      pose.jaw += blast * 2.4;
      pose.body.lean += blast * -0.18;
      pose.arms[0].lift += blast * -0.9;
      pose.arms[1].lift += blast * -0.9;
      pose.arms[0].swing += blast * 0.5;
      pose.arms[1].swing += blast * 0.5;
      pose.eyes.wide += blast * 0.6;
      pose.hair += blast * 2.5;
      pose.root.y += blast * 0.02;
    },
  },
  {
    id: 'hop',
    weight: (P) => 0.3 + P.jitter * 1.6 - P.laziness * 0.6,
    dur: [0.9, 1.3],
    apply: (pose, k) => {
      const crouch = bell(Math.min(1, k * 2.6)) * (k < 0.38 ? 1 : 0);
      const air = bell(Math.max(0, (k - 0.3) / 0.7));
      pose.root.y += air * 0.16 - crouch * 0.05;
      pose.body.squash += crouch * -0.08 + air * 0.05;
      pose.legs[0].lift += crouch * 0.4 - air * 0.25;
      pose.legs[1].lift += crouch * 0.4 - air * 0.25;
      pose.arms[0].lift += air * -0.6;
      pose.arms[1].lift += air * -0.6;
      pose.head.pitch += air * -0.1;
      pose.hair += air * 1.6;
    },
  },
  {
    id: 'slump',
    weight: (P) => 0.4 + P.laziness * 2,
    dur: [2.4, 4.0],
    apply: (pose, k) => {
      const sag = hold(k);
      pose.body.lean += sag * 0.16;
      pose.body.squash += sag * -0.06;
      pose.head.pitch += sag * 0.3;
      pose.arms[0].lift += sag * 0.28;
      pose.arms[1].lift += sag * 0.28;
      pose.eyes.squint += sag * 0.85;
      pose.root.y += sag * -0.02;
    },
  },
  {
    id: 'inspectHand',
    weight: (P) => 0.4 + P.curiosity * 1.6,
    dur: [2.0, 3.0],
    apply: (pose, k, c) => {
      const raise = hold(k);
      pose.arms[c.side].lift += raise * -1.25;
      pose.arms[c.side].swing += raise * -0.22; // drawn in, but not across the chest
      pose.arms[c.side].twist += Math.sin(k * Math.PI * 4) * raise * 0.3;
      pose.head.yaw += raise * 0.3 * (c.side === 0 ? -1 : 1);
      pose.head.pitch += raise * 0.14;
      pose.eyes.x += raise * 0.9 * (c.side === 0 ? -1 : 1);
      pose.eyes.wide += raise * 0.3;
    },
  },
  {
    id: 'shake',
    weight: (P) => 0.35 + P.jitter * 1.1,
    dur: [0.8, 1.2],
    apply: (pose, k) => {
      const wag = Math.sin(k * Math.PI * 9) * bell(k);
      pose.head.yaw += wag * 0.4;
      pose.head.roll += wag * 0.12;
      pose.body.twist += wag * 0.12;
      pose.hair += Math.abs(wag) * 2.6;
      pose.eyes.squint += bell(k) * 0.6;
    },
  },

  // ---------------------------------------------------------------- HOSTILE ---
  // These five are gated on the mood rather than weighted towards it: a
  // creature that snarls while calm has no states at all.
  {
    id: 'snarl',
    only: 'hostile',
    weight: (P) => 1 + P.boldness,
    dur: [1.4, 2.4],
    apply: (pose, k) => {
      // held, not thrown: a threat is a thing you keep doing
      const on = hold(k);
      pose.jaw += on * 0.75;
      pose.head.pitch -= on * 0.16;
      pose.body.lean += on * 0.3;
      pose.eyes.squint += on * 0.9;
      pose.hair += on * 2.2;
      pose.root.y += on * 0.012;
    },
  },
  {
    id: 'lunge',
    only: 'hostile',
    weight: (P) => 0.7 + P.boldness * 1.4,
    dur: [0.7, 1.0],
    apply: (pose, k) => {
      // the whole body drives at you and pulls back
      const drive = beats(k, 1) * 1.4;
      pose.body.lean += drive * 0.42;
      pose.head.pitch -= drive * 0.28;
      pose.root.y -= Math.abs(drive) * 0.02;
      pose.jaw += Math.max(0, drive) * 0.6;
      pose.arms[0].swing += Math.max(0, drive) * 0.5;
      pose.arms[1].swing += Math.max(0, drive) * 0.5;
      pose.eyes.squint += bell(k) * 0.7;
      pose.hair += Math.abs(drive) * 1.2;
    },
  },
  {
    id: 'stomp',
    only: 'hostile',
    weight: (P) => 0.6 + P.boldness,
    dur: [0.9, 1.4],
    apply: (pose, k, c) => {
      const beat = beats(k, 2);
      pose.legs[c.side].lift += Math.max(0, beat) * 0.5;
      pose.root.y += Math.max(0, beat) * 0.02 - Math.max(0, -beat) * 0.025;
      pose.body.squash += Math.max(0, -beat) * 0.05;
      pose.head.pitch += Math.max(0, -beat) * 0.12;
      pose.hair += Math.abs(beat) * 0.9;
    },
  },

  // ------------------------------------------------------------------ WIRED ---
  {
    id: 'twitch',
    only: 'wired',
    weight: (P) => 1.2 + P.jitter * 1.5,
    dur: [0.28, 0.5],
    apply: (pose, k, c) => {
      // one hard jerk, gone before you are sure you saw it
      const jerk = beats(k, 2);
      pose.head.yaw += jerk * 0.4 * (c.side ? 1 : -1);
      pose.head.roll += jerk * 0.16;
      pose.arms[c.side].lift += jerk * 0.55;
      pose.eyes.wide += bell(k) * 0.6;
    },
  },
  {
    id: 'bounce',
    only: 'wired',
    weight: (P) => 1 + P.jitter,
    dur: [1.0, 1.8],
    apply: (pose, k) => {
      // cannot stand still: small fast bobs that never quite leave the ground
      const bob = beats(k, 6);
      pose.root.y += Math.max(0, bob) * 0.025;
      pose.body.squash += Math.max(0, -bob) * 0.05;
      pose.head.pitch -= bob * 0.05;
      pose.arms[0].lift += bob * 0.12;
      pose.arms[1].lift -= bob * 0.12;
      pose.hair += Math.abs(bob) * 0.8;
    },
  },
  {
    id: 'scan',
    only: 'wired',
    weight: (P) => 0.9 + P.curiosity,
    dur: [1.1, 1.7],
    apply: (pose, k) => {
      // snapping between three places rather than sweeping across them
      const step = Math.round(Math.sin(Math.PI * clamp01(k) * 3) * 1.4) / 1.4;
      pose.head.yaw += step * 0.42 * bell(k);
      pose.eyes.x += step * 0.9;
      pose.eyes.wide += bell(k) * 0.5;
    },
  },

  // ------------------------------------------------------------------ SPENT ---
  {
    id: 'pant',
    only: 'spent',
    weight: () => 2.2,
    dur: [1.8, 3.0],
    apply: (pose, k) => {
      // the jaw and the whole body working together, head hanging
      const on = hold(k);
      const puff = beats(k, 7);
      pose.jaw += on * 0.2 + Math.max(0, puff) * 0.3;
      pose.body.squash += puff * 0.045;
      pose.head.pitch += on * 0.3 + puff * 0.05;
      pose.eyes.squint += on * 0.7;
      pose.root.y -= on * 0.012;
    },
  },
  {
    id: 'nodOff',
    only: 'spent',
    weight: (P) => 1.4 + P.laziness,
    dur: [2.2, 3.6],
    apply: (pose, k) => {
      // the head sinks, catches itself, sinks again
      const sink = hold(k);
      const catchUp = Math.max(0, Math.sin(Math.PI * clamp01(k) * 2.5));
      pose.head.pitch += sink * 0.5 - catchUp * 0.28;
      pose.eyes.squint += sink * 1.0 - catchUp * 0.5;
      pose.body.lean += sink * 0.12;
      pose.root.y -= sink * 0.018;
    },
  },
  {
    id: 'sag',
    only: 'spent',
    weight: (P) => 1.2 + P.laziness,
    dur: [2.4, 3.8],
    apply: (pose, k) => {
      // a slow collapse with one half-hearted attempt at standing up again
      const down = hold(k);
      const rally = Math.max(0, Math.sin(Math.PI * clamp01(k) * 1.6 - 0.4));
      pose.body.squash += down * 0.09 - rally * 0.04;
      pose.root.y -= down * 0.03 - rally * 0.012;
      pose.head.pitch += down * 0.36 - rally * 0.2;
      pose.arms[0].lift += down * 0.1;
      pose.arms[1].lift += down * 0.1;
      pose.eyes.squint += down * 0.8;
    },
  },

  // ------------------------------------------------------------------ ALERT ---
  {
    id: 'perk',
    only: 'alert',
    weight: (P) => 1.5 + P.curiosity,
    dur: [1.0, 1.7],
    apply: (pose, k) => {
      // everything comes up at once and then holds: it has noticed something
      const up = hold(k);
      pose.head.pitch -= up * 0.26;
      pose.body.lean -= up * 0.14;
      pose.root.y += up * 0.02;
      pose.eyes.wide += up * 1.3;
      pose.hair += up * 1.8;
      pose.arms[0].lift -= up * 0.12;
      pose.arms[1].lift -= up * 0.12;
    },
  },
  {
    id: 'track',
    only: 'alert',
    weight: (P) => 1.2 + P.curiosity * 1.3,
    dur: [1.8, 3.0],
    apply: (pose, k, c) => {
      // the eyes lead and the head follows them across, slowly
      const dir = c.side ? 1 : -1;
      const across = Math.sin(Math.PI * clamp01(k)) * dir;
      pose.eyes.x += across * 1.1;
      pose.head.yaw += across * 0.34 * Math.min(1, clamp01(k) * 2.2);
      pose.eyes.wide += hold(k) * 0.6;
    },
  },
  {
    id: 'freeze',
    only: 'alert',
    weight: () => 1.1,
    dur: [1.2, 2.0],
    apply: (pose, k) => {
      // the loudest thing a body can do is nothing. `still` is read by the
      // animator, which damps its own idle layers towards zero while it lasts.
      const on = hold(k);
      pose.still += on * 0.92;
      pose.eyes.wide += on * 0.9;
      pose.head.pitch -= on * 0.08;
    },
  },

  // ------------------------------------------------------------------- CALM ---
  {
    id: 'yawn',
    only: 'calm',
    weight: (P) => 1.3 + P.laziness * 1.2,
    dur: [1.8, 2.8],
    apply: (pose, k) => {
      const open = Math.sin(Math.PI * clamp01(k) ** 0.7);
      pose.jaw += open * 0.9;
      pose.head.pitch -= open * 0.22;
      pose.eyes.squint += open * 1.2;
      pose.body.squash -= open * 0.04;
      pose.arms[0].lift -= open * 0.25;
      pose.arms[1].lift -= open * 0.25;
    },
  },
  {
    id: 'groom',
    only: 'calm',
    weight: (P) => 1.1 + P.laziness * 0.6,
    dur: [2.0, 3.2],
    apply: (pose, k, c) => {
      // a hand working slowly at the side of the head
      const reach = hold(k);
      const rub = beats(k, 4) * reach;
      pose.arms[c.side].lift += reach * -0.85 + rub * 0.18;
      pose.arms[c.side].swing -= reach * 0.35;
      pose.head.roll += (c.side ? -1 : 1) * (reach * 0.1 + rub * 0.05);
      pose.eyes.squint += reach * 0.35;
    },
  },
  {
    id: 'settle',
    only: 'calm',
    weight: () => 1.2,
    dur: [1.6, 2.6],
    apply: (pose, k, c) => {
      // a shuffle of the feet and a long breath out
      const shift = Math.sin(Math.PI * clamp01(k) * 2) * bell(k);
      pose.legs[c.side].swing += shift * 0.1;
      pose.legs[1 - c.side].swing -= shift * 0.06;
      pose.root.x += shift * 0.01;
      pose.body.squash += hold(k) * 0.03;
      pose.head.pitch += hold(k) * 0.06;
    },
  },
];

const BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

/** Picks actions, runs one at a time, and writes it into the pose. */
export function createBehaviour() {
  let action = null;
  let elapsed = 0;
  let duration = 0;
  let side = 0;
  let nextIn = 1.5;

  function choose(P, bias, moodId) {
    let total = 0;
    const w = ACTIONS.map((a) => {
      // Most gestures belong to no state in particular and the mood only tilts
      // their odds. A few belong to ONE state and are wrong everywhere else —
      // a creature that snarls when it is calm has no states at all — and those
      // carry `only`, which is a gate rather than a weight.
      if (a.only && a.only !== moodId) { total += 0; return 0; }
      const x = Math.max(0.01, a.weight(P) * (bias?.[a.id] ?? 1));
      total += x;
      return x;
    });
    let r = Math.random() * total;
    for (let i = 0; i < ACTIONS.length; i++) {
      r -= w[i];
      if (r <= 0) return ACTIONS[i];
    }
    return ACTIONS[0];
  }

  return {
    /** Interrupts whatever is running — used by pokes and by the idle toggle. */
    reset() {
      action = null;
      elapsed = 0;
      nextIn = 1.2;
    },

    /** Forces a specific action to start now (a poke startles the creature). */
    trigger(id, P) {
      const a = BY_ID[id];
      if (!a) return;
      action = a;
      elapsed = 0;
      duration = a.dur[0] + Math.random() * (a.dur[1] - a.dur[0]);
      side = Math.random() < 0.5 ? 0 : 1;
      nextIn = 0.6 + Math.random() * 2 / Math.max(0.2, P.jitter);
    },

    get current() { return action?.id ?? null; },

    update(pose, dt, P, mood) {
      const pace = mood?.pace ?? 1;
      if (action) {
        elapsed += dt;
        const k = elapsed / duration;
        if (k >= 1) {
          action = null;
          // busy creatures barely pause between gestures, lazy ones dawdle
          nextIn = (1.2 + Math.random() * 5) / (Math.max(0.25, P.jitter) * pace);
        } else {
          action.apply(pose, k, { side, P });
        }
        return;
      }
      nextIn -= dt;
      if (nextIn <= 0) {
        const a = choose(P, mood?.bias, mood?.id);
        action = a;
        elapsed = 0;
        duration = a.dur[0] + Math.random() * (a.dur[1] - a.dur[0]);
        side = Math.random() < 0.5 ? 0 : 1;
      }
    },
  };
}
