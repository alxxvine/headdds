import * as THREE from 'three';

// The creature has no skeleton — it is a puppet of named pivot groups (see the
// rig built in creature/build.js). This module drives those pivots and owns all
// the motion state: phases, springs, blink and saccade timers.
//
// Two rules make it survive the editor:
//  - state lives here, not in the mesh, because buildCreature() throws away and
//    rebuilds the whole creature on every slider move;
//  - every frame writes an ABSOLUTE transform (base pose + delta), never an
//    increment, so nothing drifts and pausing leaves a clean pose.

const IDLE_SPEED = 1.0;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Turns stats into a temperament: how this particular freak carries itself. */
function temperament(stats) {
  const v = stats?.values ?? {};
  const n = (x) => clamp01(((x ?? 50) - 5) / 90);
  const has = (id) => !!stats?.traits?.some((t) => t.id === id);

  return {
    tempo: 0.55 + n(v.speed) * 1.15,        // everything ticks faster
    wobble: 1 - n(v.balance),               // 0 = rock steady, 1 = floppy
    weight: n(v.vigor),                     // heavy creatures move slower, wider
    menace: n(v.dread),                     // slow predatory sway
    curiosity: n(v.sight),                  // how eagerly it tracks things
    blind: has('blind'),
    topHeavy: has('topHeavy'),
  };
}

function captureBase(rig) {
  const node = (o) => (o ? { pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone() } : null);
  return {
    root: node(rig.root),
    head: node(rig.headPivot),
    body: node(rig.bodyPivot),
    legs: rig.legs.map(node),
    shoulders: rig.shoulders.map(node),
    eyes: rig.eyes.map((e) => node(e.pivot)),
    stalks: rig.eyes.map((e) => node(e.stalk)),
    jaw: node(rig.jaw),
    tendrils: rig.tendrils.map((t) => node(t.pivot)),
    spores: node(rig.spores),
  };
}

export function createAnimator() {
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();

  let rig = null;
  let base = null;

  const S = {
    t: 0,
    // head spring, in radians: x = pitch, y = yaw, z = roll
    head: new THREE.Vector3(),
    headVel: new THREE.Vector3(),
    // eyes
    look: new THREE.Vector2(),
    lookTarget: new THREE.Vector2(),
    saccadeIn: 0.8,
    blinkIn: 2.5,
    blinkT: -1,
    // maw
    jaw: 0,
    jawVel: 0,
    chewIn: 4,
    chewLeft: 0,
  };

  /** local-space rotation delta on top of a captured base orientation */
  const spin = (obj, baseNode, x, y, z) => {
    _e.set(x, y, z);
    _q.setFromEuler(_e);
    obj.quaternion.copy(baseNode.quat).multiply(_q);
  };

  function bind(next) {
    if (rig === next) return;
    rig = next;
    base = captureBase(next);
  }

  /** Restores the built pose exactly — used when idle motion is switched off. */
  function rest(next) {
    bind(next);
    const put = (o, b) => {
      if (!o || !b) return;
      o.position.copy(b.pos);
      o.quaternion.copy(b.quat);
      o.scale.copy(b.scale);
    };
    put(rig.root, base.root);
    put(rig.headPivot, base.head);
    put(rig.bodyPivot, base.body);
    rig.legs.forEach((o, i) => put(o, base.legs[i]));
    rig.shoulders.forEach((o, i) => put(o, base.shoulders[i]));
    rig.eyes.forEach((e, i) => {
      put(e.pivot, base.eyes[i]);
      put(e.stalk, base.stalks[i]);
    });
    put(rig.jaw, base.jaw);
    rig.tendrils.forEach((t, i) => put(t.pivot, base.tendrils[i]));
    put(rig.spores, base.spores);
  }

  /** A click on the creature: head recoil plus a snap of the maw. */
  function poke() {
    S.headVel.x -= 9;
    S.headVel.z += (Math.random() - 0.5) * 6;
    S.jawVel += 22;
    S.blinkIn = Math.min(S.blinkIn, 0.12);
  }

  function update(nextRig, stats, dt, input = {}) {
    bind(nextRig);
    const T = temperament(stats);
    const step = Math.min(0.05, dt); // a tab that was in the background must not explode the springs
    S.t += step * T.tempo * IDLE_SPEED;
    const t = S.t;
    const scale = rig.scale || 1;

    // --- breathing: the body swells, the head rides on top -----------------
    const breath = Math.sin(t * 1.7);
    const b = base.body;
    rig.bodyPivot.scale.set(
      b.scale.x * (1 + breath * 0.02),
      b.scale.y * (1 - breath * 0.025),
      b.scale.z * (1 + breath * 0.02),
    );

    // --- weight shift from foot to foot ------------------------------------
    const sway = Math.sin(t * 0.42);
    const swayAmp = 0.03 + T.wobble * 0.05 + T.menace * 0.02;
    spin(rig.root, base.root, 0, 0, sway * swayAmp);
    rig.root.position.set(
      base.root.pos.x - sway * swayAmp * 0.5 * scale,
      base.root.pos.y,
      base.root.pos.z,
    );
    // Both legs lean the same way — a weight shift tilts the whole stance.
    // Swinging them in opposite directions would close the gap between them
    // and, on a thick-limbed freak, fuse them into one leg mid-sway.
    const legLean = sway * 0.07 * (0.5 + T.wobble);
    rig.legs.forEach((leg, i) => spin(leg, base.legs[i], 0, 0, legLean));

    // --- arms dangle a beat behind the body --------------------------------
    rig.shoulders.forEach((sh, i) => {
      // the two arms run at slightly different rates, so a lopsided creature
      // never looks like it is doing calisthenics in sync
      const rate = 1.7 + (i === 0 ? -0.22 : 0.22) * (1 + T.wobble);
      const lag = Math.sin(t * rate - 0.7 + i * 1.9);
      spin(sh, base.shoulders[i], lag * 0.14 * (0.4 + T.weight), lag * 0.05, sway * 0.1);
    });

    // --- head on a critically-ish damped spring ----------------------------
    // Low BALANCE softens the spring and under-damps it, so a top-heavy skull
    // overshoots and keeps hunting for its balance point.
    const stiffness = 26 + (1 - T.wobble) * 46;
    const damping = 2 * Math.sqrt(stiffness) * (0.32 + 0.6 * (1 - T.wobble));

    const idleYaw = Math.sin(t * 0.31) * (0.05 + T.menace * 0.09) + (T.blind ? Math.sin(t * 0.22) * 0.22 : 0);
    const idlePitch = Math.sin(t * 0.53) * 0.035 - sway * 0.02;
    const pointerX = input.active ? input.pointer.x : 0;
    const pointerY = input.active ? input.pointer.y : 0;
    const follow = T.blind ? 0.15 : 0.35 + T.curiosity * 0.4;

    const targetYaw = idleYaw + pointerX * 0.42 * follow;
    const targetPitch = idlePitch - pointerY * 0.3 * follow;
    const targetRoll = -sway * (0.05 + T.wobble * 0.09);

    const target = [targetPitch, targetYaw, targetRoll];
    const cur = [S.head.x, S.head.y, S.head.z];
    const vel = [S.headVel.x, S.headVel.y, S.headVel.z];
    for (let i = 0; i < 3; i++) {
      const acc = stiffness * (target[i] - cur[i]) - damping * vel[i];
      vel[i] += acc * step;
      cur[i] += vel[i] * step;
    }
    S.head.set(cur[0], cur[1], cur[2]);
    S.headVel.set(vel[0], vel[1], vel[2]);
    spin(rig.headPivot, base.head, S.head.x, S.head.y, S.head.z);
    rig.headPivot.position.set(
      base.head.pos.x,
      base.head.pos.y + breath * 0.012 * scale,
      base.head.pos.z,
    );

    // --- eyes: blinking and saccades ---------------------------------------
    S.blinkIn -= step;
    if (S.blinkIn <= 0 && S.blinkT < 0) {
      S.blinkT = 0;
      S.blinkIn = 2 + Math.random() * 4.5;
    }
    let blink = 0;
    if (S.blinkT >= 0) {
      const dur = 0.16;
      S.blinkT += step;
      blink = S.blinkT >= dur ? 0 : 1 - Math.abs(1 - (S.blinkT / dur) * 2);
      if (S.blinkT >= dur) S.blinkT = -1;
    }

    S.saccadeIn -= step;
    if (S.saccadeIn <= 0) {
      S.saccadeIn = 0.5 + Math.random() * (2.4 - T.curiosity * 1.2);
      S.lookTarget.set((Math.random() * 2 - 1) * 0.7, (Math.random() * 2 - 1) * 0.5);
    }
    if (input.active) S.lookTarget.set(input.pointer.x, input.pointer.y);
    // eyes snap to a target far quicker than the head turns
    const lookLerp = 1 - Math.exp(-step * (12 + T.curiosity * 14));
    S.look.lerp(S.lookTarget, lookLerp);

    rig.eyes.forEach((eye, i) => {
      const eb = base.eyes[i];
      // a stalk sways on its own and leans further into whatever the eye
      // is tracking than the head ever could
      if (eye.stalk) {
        const sb = base.stalks[i];
        const w = t * 1.35 + i * 1.7;
        spin(
          eye.stalk, sb,
          Math.sin(w) * 0.16 - S.look.y * 0.3,
          Math.cos(w * 0.8) * 0.16 + S.look.x * 0.3,
          0,
        );
      }
      // multi-eyed freaks blink in a ripple instead of all at once
      const stagger = clamp01(blink * 1.6 - i * 0.18);
      const lid = 1 - 0.92 * stagger;
      eye.pivot.scale.set(eb.scale.x, eb.scale.y * lid, eb.scale.z);

      if (eye.kind === 'ball') {
        spin(eye.pivot, eb, -S.look.y * 0.45, S.look.x * 0.5, 0);
        eye.pivot.position.copy(eb.pos);
      } else {
        // beads and dots are round: rotating them shows nothing, so they slide
        eye.pivot.quaternion.copy(eb.quat);
        eye.pivot.position.copy(eb.pos);
        eye.pivot.translateX(S.look.x * eye.size * 0.22);
        eye.pivot.translateY(S.look.y * eye.size * 0.22);
      }
    });

    // --- maw: an occasional chew, plus whatever poke() threw in ------------
    S.chewIn -= step;
    if (S.chewIn <= 0) {
      S.chewIn = 3 + Math.random() * 6;
      S.chewLeft = 2 + Math.floor(Math.random() * 3);
    }
    if (S.chewLeft > 0 && S.jaw < 0.05 && S.jawVel <= 0) {
      S.jawVel += 9;
      S.chewLeft -= 1;
    }
    S.jawVel += (-70 * S.jaw - 9 * S.jawVel) * step;
    S.jaw = Math.max(0, S.jaw + S.jawVel * step);
    spin(rig.jaw, base.jaw, S.jaw * 0.09, 0, 0);

    // --- secondary motion: tendrils lag behind, spores drift ---------------
    // bristles barely twitch, antennae whip: each strand carries its own
    // stiffness from hair.js
    rig.tendrils.forEach((td, i) => {
      const tb = base.tendrils[i];
      const w = t * 1.1 + td.phase;
      const amp = (0.12 + td.len * 0.1) * (td.stiffness ?? 1);
      spin(td.pivot, tb, Math.sin(w) * amp, 0, Math.cos(w * 0.7) * amp);
    });

    if (rig.spores) {
      const sb = base.spores;
      spin(rig.spores, sb, 0, t * 0.25, 0);
      rig.spores.position.set(
        sb.pos.x + Math.sin(t * 0.4) * 0.03 * scale,
        sb.pos.y + Math.sin(t * 0.6) * 0.04 * scale,
        sb.pos.z + Math.cos(t * 0.33) * 0.03 * scale,
      );
    }
  }

  return { update, rest, poke };
}
