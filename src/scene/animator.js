import * as THREE from 'three';
import { createBehaviour, makePersonality, blankPose, resetPose } from './behaviour.js';
import { createMood } from './mood.js';

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
  let personality = null;
  const behaviour = createBehaviour();
  const mood = createMood();
  const pose = blankPose();
  const lastPointer = new THREE.Vector2();

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
    blinkDur: 0.16,
    // waves whose rate the mood moves keep their own phase; see update()
    breathPh: 0,
    swayPh: 0,
    // maw
    jaw: 0,
    jawVel: 0,
    chewIn: 4,
    chewLeft: 0,
    // previous frame's value of everything the event bus below watches
    lastSwivel: 0,
    turnRising: false,
    turnGap: 0,
    jawFloor: 0,
    lastSwing: 0,
    lastLift: 0,
    lastStir: 0,
    stirRising: false,
    stirGap: 0,
  };

  // The event bus. A sound must be a consequence of a motion, not a thing on
  // its own timer running alongside it — so the animator reports what the body
  // just did and the sound layer decides what that is worth hearing.
  //
  // The bar is that you can SEE it happen. Breathing swells the body by two
  // percent and the weight shift tilts it by a couple of degrees; at this
  // render resolution neither is visible, so a noise hung off them reads as the
  // creature making sounds by itself. Only motion you can point at gets one:
  // an arm swinging, the head whipping round, a jump, a blink, the jaw.
  //
  // Cleared and refilled every frame; `act` carries the gesture in progress, so
  // the sound layer can tell a yawn from a roar.
  const events = [];
  const fire = (id, power = 1) => events.push({ id, power, act: behaviour.current });

  /** local-space rotation delta on top of a captured base orientation */
  const spin = (obj, baseNode, x, y, z) => {
    _e.set(x, y, z);
    _q.setFromEuler(_e);
    obj.quaternion.copy(baseNode.quat).multiply(_q);
  };

  function bind(next, stats) {
    if (rig === next) return;
    rig = next;
    base = captureBase(next);
    // a new creature is a new character: reroll who it is, but only when the
    // seed actually changed — dragging a slider must not hand it a new soul
    if (!personality || personality.seed !== next.seed) {
      personality = makePersonality(next.seed, stats);
      personality.seed = next.seed;
      behaviour.reset();
      mood.reset();
    }
  }

  /** Restores the built pose exactly — used when idle motion is switched off. */
  function rest(next) {
    bind(next);
    behaviour.reset();
    mood.reset();
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
    if (!personality) return;
    mood.poke(personality);
    // a poke startles it into doing something, and what it does depends on the
    // state it is already in: an angry creature bites back, an exhausted one
    // can only flinch, and one you have just walked up to merely reacts
    const r = Math.random();
    let id;
    if (mood.id === 'hostile') id = r < 0.6 ? 'roar' : 'chomp';
    else if (mood.id === 'spent') id = r < 0.6 ? 'shiver' : 'slump';
    else id = r < personality.boldness * 0.5 ? 'roar' : r < 0.7 ? 'shake' : 'shiver';
    behaviour.trigger(id, personality);
  }

  function update(nextRig, stats, dt, input = {}) {
    bind(nextRig, stats);
    const T = temperament(stats);
    const step = Math.min(0.05, dt); // a tab that was in the background must not explode the springs

    // --- how does it feel about you? ---------------------------------------
    // Mood runs on real seconds: a fast creature must not also get angry fast.
    // A hard camera swing counts as something rushing past it.
    if (input.active) {
      const moved = Math.hypot(input.pointer.x - lastPointer.x, input.pointer.y - lastPointer.y);
      if (moved > 0.06) mood.stir(Math.min(0.05, moved * 0.06));
    }
    lastPointer.set(input.pointer?.x ?? 0, input.pointer?.y ?? 0);
    if (input.spin > 1.2) mood.stir(Math.min(0.06, (input.spin - 1.2) * 0.02));
    mood.update(step, { hovering: !!input.active, acting: !!behaviour.current }, personality);

    // an agitated freak ticks faster than the same freak half asleep
    S.t += step * T.tempo * IDLE_SPEED * (1 + (mood.pace - 1) * 0.45);
    const t = S.t;
    const scale = rig.scale || 1;

    // --- what is it doing right now? ---------------------------------------
    // The behaviour layer writes offsets into `pose`; every layer below adds
    // them to its own idle motion, so the two never fight over a transform.
    events.length = 0;
    resetPose(pose);
    behaviour.update(pose, step, personality, mood);
    mood.posture(pose, t);

    // --- the rhythm the mood is carried by ----------------------------------
    //
    // The posture layer gives each mood a static offset, and that is the easy
    // half. What tells a player which state a creature is in from across a room
    // is the RHYTHM — how fast it breathes, whether it is holding still, how
    // long it goes without blinking. Every mood used to breathe at 1.7, sway at
    // 0.42 and blink every two to six seconds, and only an overall tempo
    // multiplier moved, so the five states were five postures rather than five
    // creatures.
    //
    // Read off the DRIVES rather than the mood's name, so it slides between
    // states instead of snapping at the threshold.
    const D = mood.drives;

    // --- breathing: the body swells, the head rides on top -----------------
    // Angry breathing is fast and shallow, exhausted breathing is slow and
    // deep, and being wound up drives it faster without deepening it. The
    // ragged term is a second harmonic that only exhaustion switches on: a
    // breath that catches rather than one that runs smoothly.
    // A RATE THAT MOVES HAS TO BE INTEGRATED, not multiplied into the clock.
    // `sin(t * rate)` has a phase of t*rate, so changing the rate by dr moves
    // the phase by t*dr — nothing at all one second in, and a whole turn after
    // a few minutes. Measured on the shipped version: four minutes of calm and
    // then a poke gave a single frame nearly three times the size of any other,
    // and the longer the tab had been open the worse it got. Every wave whose
    // rate depends on a drive keeps its own phase.
    const breathRate = 1.7 * (1 + D.anger * 0.85 + D.arousal * 0.45 - D.fatigue * 0.5);
    const breathDeep = 1 + D.fatigue * 0.9 - D.anger * 0.45 - D.arousal * 0.2;
    // The catch is a WARP OF THE PHASE, not a second wave added on top. Adding
    // a harmonic gives the trace extra turning points, and a slow breath with a
    // ripple in it then measures — and reads — as a fast breath: exactly the
    // one thing exhaustion had to be told apart from. Warping the phase makes
    // the breath draw in fast and let go slowly, which is a sigh, and leaves
    // the rate alone.
    S.breathPh += step * T.tempo * IDLE_SPEED * (1 + (mood.pace - 1) * 0.45) * breathRate;
    const phase = S.breathPh + D.fatigue * 0.7 * Math.sin(S.breathPh);
    const breath = Math.sin(phase) * Math.max(0.3, breathDeep) * (1 - Math.min(0.8, pose.still));
    const b = base.body;
    rig.bodyPivot.scale.set(
      b.scale.x * (1 + breath * 0.02 - pose.body.squash * 0.35),
      b.scale.y * (1 - breath * 0.025 + pose.body.squash),
      b.scale.z * (1 + breath * 0.02 - pose.body.squash * 0.35),
    );
    spin(rig.bodyPivot, base.body, pose.body.lean, pose.body.twist, 0);

    // --- weight shift from foot to foot ------------------------------------
    // Weight shifts slowly when nothing is happening and quickly when it is —
    // and a furious creature does not sway at all, it plants itself and rocks
    // in place. `dwell` squares off the wave towards the ends, so hostile holds
    // its weight on one foot and then shifts, instead of gliding to and fro.
    // Exhaustion is not simply everything at half speed — that reads as calm.
    // What reads as running out is UNEVENNESS: it moves, it stops, it moves
    // again. `flag` is a slow envelope that only fatigue switches on, and every
    // idle amplitude below rides on it, so the whole creature goes quiet
    // together rather than one channel at a time.
    // ...and `still` is the same dial driven the other way, by a gesture rather
    // than by a drive: `freeze` writes it, and holding a body rigid is
    // something a pose offset cannot express — you can only express it by
    // taking the idle motion away.
    const flag = (1 - D.fatigue * 0.6 * Math.max(0, Math.sin(t * 0.55)) ** 2)
      * (1 - Math.min(0.95, pose.still));

    const swayRate = 0.42 * (1 + D.arousal * 0.8 - D.fatigue * 0.4);
    S.swayPh += step * T.tempo * IDLE_SPEED * (1 + (mood.pace - 1) * 0.45) * swayRate;
    const raw = Math.sin(S.swayPh);
    const dwell = D.anger;
    const sway = raw * (1 - dwell) + Math.tanh(raw * 2.6) * dwell;
    const swayAmp = (0.03 + T.wobble * 0.05 + T.menace * 0.02)
      * (1 - D.anger * 0.35 + D.fatigue * 0.25) * flag;
    // A jump: off the ground, and back onto it.
    const lift = pose.root.y;
    if (lift > 0.06 && S.lastLift <= 0.06) fire('launch', Math.min(1, lift * 6));
    if (S.lastLift > 0.06 && lift <= 0.06) fire('land', Math.min(1, S.lastLift * 6));
    S.lastLift = lift;

    // The arms. `stir` is how far they are from hanging, and its peaks are the
    // moment a swing turns around — which is where you would hear the limb
    // whip through the air. Hair counts for a little; it moves with them.
    const stir = Math.abs(pose.arms[0].lift) + Math.abs(pose.arms[1].lift)
      + Math.abs(pose.arms[0].swing) + Math.abs(pose.arms[1].swing) + pose.hair * 0.3;
    S.stirGap -= step;
    if (stir > S.lastStir) S.stirRising = true;
    else if (S.stirRising && S.lastStir > 0.5 && S.stirGap <= 0) {
      S.stirRising = false;
      S.stirGap = 0.12; // a fast shiver must not turn into a machine gun
      fire('move', Math.min(1, S.lastStir / 2.2));
    } else if (stir < S.lastStir) S.stirRising = false;
    S.lastStir = stir;
    spin(rig.root, base.root, 0, pose.root.yaw, sway * swayAmp + pose.root.roll);
    rig.root.position.set(
      base.root.pos.x - sway * swayAmp * 0.5 * scale + pose.root.x * scale,
      base.root.pos.y + pose.root.y * scale,
      base.root.pos.z,
    );
    // Both legs lean the same way — a weight shift tilts the whole stance.
    // Swinging them in opposite directions would close the gap between them
    // and, on a thick-limbed freak, fuse them into one leg mid-sway. A gesture
    // does swing one leg on its own, though, and that is exactly the motion the
    // shared lean was written to avoid: it gets only the room the build found
    // between the two of them.
    const legLean = sway * 0.07 * (0.5 + T.wobble);
    rig.legs.forEach((leg, i) => {
      const pl = pose.legs[i] || pose.legs[0];
      const cap = leg.userData.lean ?? 0.3;
      spin(leg, base.legs[i], pl.lift, 0, legLean + Math.max(-cap, Math.min(cap, pl.swing)));
    });

    // --- arms dangle a beat behind the body --------------------------------
    rig.shoulders.forEach((sh, i) => {
      // the two arms run at slightly different rates, so a lopsided creature
      // never looks like it is doing calisthenics in sync
      const rate = 1.7 + (i === 0 ? -0.22 : 0.22) * (1 + T.wobble);
      const lag = Math.sin(t * rate - 0.7 + i * 1.9);
      const pa = pose.arms[i] || pose.arms[0];
      // An action may swing an arm inwards (scratching, hugging), but never
      // past vertical: the built splay is how much room it has to spend.
      // Positive swing means *outward* for both arms; the left shoulder's base
      // rotation is mirrored, so the delta has to be mirrored with it or the
      // clamp guards the wrong direction and the arm sails across the chest.
      const armSide = sh.userData.side ?? 1;
      // `tuck` is how much of that splay the build found spare: on a long-armed
      // freak most of the splay is holding the hand off the floor, and spending
      // it would put the hand through the ground.
      const splay = sh.userData.splay ?? 0.5;
      const tuck = sh.userData.tuck ?? Math.max(0, splay - 0.05);
      // The weight shift tilts both arms the same way in world space, which is
      // opposite ways in their mirrored local frames — so it is folded into the
      // outward-positive figure and clamped with everything else, instead of
      // being added afterwards where it could leak past the limit.
      const swing = armSide * Math.max(-tuck, Math.min(0.9, pa.swing + armSide * sway * 0.1));
      // Lift rotates the arm about its own X axis, which the splay has already
      // tilted: past a quarter turn the cone carries the limb back across the
      // chest and through the torso. How much of that turn this particular arm
      // has is measured at build time — a wide freak gets the whole quarter, a
      // narrow one with fanned claws gets a fraction of it.
      const liftCap = sh.userData.lift ?? 1.4;
      const lift = Math.max(-liftCap, Math.min(liftCap, lag * 0.14 * (0.4 + T.weight) + pa.lift));
      // twist rolls the limb about its own axis; unbounded it walks the hand
      // sideways just like an unclamped swing would
      const twist = Math.max(-0.5, Math.min(0.5, lag * 0.05 + pa.twist));
      spin(sh, base.shoulders[i], lift, twist, swing);
    });

    // --- head on a critically-ish damped spring ----------------------------
    // Low BALANCE softens the spring and under-damps it, so a top-heavy skull
    // overshoots and keeps hunting for its balance point.
    const stiffness = 26 + (1 - T.wobble) * 46;
    const damping = 2 * Math.sqrt(stiffness) * (0.32 + 0.6 * (1 - T.wobble));

    // The head's own drift, and the fine tremor a wound-up creature cannot keep
    // out of it. The tremor is fast and small: at this render resolution it
    // reads as a creature vibrating rather than as one moving.
    const idleYaw = (Math.sin(t * 0.31) * (0.05 + T.menace * 0.09)
      + (T.blind ? Math.sin(t * 0.22) * 0.22 : 0)) * flag;
    const idlePitch = (Math.sin(t * 0.53) * 0.035 - sway * 0.02) * flag
      + Math.sin(t * 23) * D.arousal * (1 - D.fatigue) * 0.012;
    const pointerX = input.active ? input.pointer.x : 0;
    const pointerY = input.active ? input.pointer.y : 0;
    // an alert creature locks on harder than a bored one
    const follow = (T.blind ? 0.15 : 0.35 + T.curiosity * 0.4) * (1 + mood.drives.attention * 0.35);

    const targetYaw = idleYaw + pointerX * 0.42 * follow + pose.head.yaw;
    const targetPitch = idlePitch - pointerY * 0.3 * follow + pose.head.pitch;
    const targetRoll = -sway * (0.05 + T.wobble * 0.09) + pose.head.roll;

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

    // The head whipping round. Measured on the spring's own speed, so a lazy
    // drift is silent and a snap to look at you is not; fired as the turn tops
    // out, which is when the mass is really moving.
    const swivel = Math.hypot(vel[0], vel[1]) + Math.abs(vel[2]) * 0.5;
    S.turnGap -= step;
    if (swivel > S.lastSwivel) S.turnRising = true;
    else if (S.turnRising && S.lastSwivel > 1.1 && S.turnGap <= 0) {
      S.turnRising = false;
      S.turnGap = 0.3;
      fire('turn', Math.min(1, (S.lastSwivel - 1.1) / 4));
    } else if (swivel < S.lastSwivel) S.turnRising = false;
    S.lastSwivel = swivel;
    spin(rig.headPivot, base.head, S.head.x, S.head.y, S.head.z);
    rig.headPivot.position.set(
      base.head.pos.x,
      base.head.pos.y + breath * 0.012 * scale,
      base.head.pos.z,
    );

    // --- eyes: blinking and saccades ---------------------------------------
    // How often it blinks, and how long the lid stays down, are both mood. A
    // creature that has decided it dislikes you stops blinking and stares; a
    // worn-out one blinks slowly and heavily, and the lid lingers; a wound-up
    // one flutters. This is the loudest single tell in the whole set, and it
    // used to be one interval for all five states.
    S.blinkIn -= step;
    if (S.blinkIn <= 0 && S.blinkT < 0) {
      S.blinkT = 0;
      const gap = (2 + Math.random() * 4.5)
        * (1 + D.anger * 2.6)                       // hostile: a stare
        * (1 - D.arousal * 0.45)                    // wired: a flutter
        * (1 - D.fatigue * 0.25);
      S.blinkIn = Math.max(0.35, gap);
      S.blinkDur = 0.16 * (1 + D.fatigue * 2.2);    // spent: heavy and slow
      fire('blink');
    }
    let blink = 0;
    if (S.blinkT >= 0) {
      const dur = S.blinkDur || 0.16;
      S.blinkT += step;
      // The lid falls quickly and lifts slowly when the creature is tired, and
      // symmetrically when it is not — a slow close reads as sleepy either way,
      // but a slow OPEN is what actually reads as "about to stop".
      const k = S.blinkT / dur;
      const shape = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
      blink = S.blinkT >= dur ? 0 : Math.max(0, shape);
      if (S.blinkT >= dur) S.blinkT = -1;
    }

    S.saccadeIn -= step;
    if (S.saccadeIn <= 0) {
      // Alert scans; hostile locks on and stops scanning; spent barely moves
      // its eyes at all.
      S.saccadeIn = (0.5 + Math.random() * (2.4 - T.curiosity * 1.2))
        * (1 - D.attention * 0.45 + D.fatigue * 1.4) * (1 + D.anger * 1.6);
      const reach = 0.7 * (1 - D.anger * 0.55 - D.fatigue * 0.4);
      S.lookTarget.set((Math.random() * 2 - 1) * reach, (Math.random() * 2 - 1) * reach * 0.7);
    }
    if (input.active) S.lookTarget.set(input.pointer.x, input.pointer.y);
    if (pose.eyes.x || pose.eyes.y) S.lookTarget.set(pose.eyes.x, pose.eyes.y);
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
      const lid = (1 - 0.92 * stagger) * (1 - pose.eyes.squint * 0.55) * (1 + pose.eyes.wide * 0.25);
      const wide = 1 + pose.eyes.wide * 0.2;
      eye.pivot.scale.set(eb.scale.x * wide, eb.scale.y * lid, eb.scale.z * wide);

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
      // A chew is meant to read as the creature doing something, not as a
      // metronome: at one every few seconds its click became the loudest thing
      // about a freak standing still.
      S.chewIn = 6 + Math.random() * 9;
      S.chewLeft = 2 + Math.floor(Math.random() * 3);
    }
    if (S.chewLeft > 0 && S.jaw < 0.05 && S.jawVel <= 0) {
      S.jawVel += 9;
      S.chewLeft -= 1;
    }
    S.jawVel += (-70 * S.jaw - 9 * S.jawVel) * step;
    S.jaw = Math.max(0, S.jaw + S.jawVel * step);
    const open = S.jaw + pose.jaw;
    // The maw is the loudest thing on the creature, so both ends of its travel
    // are events: a bite is the jaw shutting, a voice is the jaw opening wide.
    // Measured against a floor that follows the mouth's resting position rather
    // than against zero — a furious creature stands with its jaw half open, and
    // an absolute threshold would read every idle chew as a fresh roar.
    S.jawFloor = Math.min(open, S.jawFloor + step * 0.8);
    const swing = open - S.jawFloor;
    if (S.lastSwing > 0.15 && swing <= 0.15) fire('bite', Math.min(1, S.lastSwing / 1.8));
    if (swing > 1.2 && S.lastSwing <= 1.2) fire('gape', Math.min(1, swing / 2.4));
    S.lastSwing = swing;
    spin(rig.jaw, base.jaw, open * 0.09, 0, 0);

    // --- secondary motion: tendrils lag behind, spores drift ---------------
    // bristles barely twitch, antennae whip: each strand carries its own
    // stiffness from hair.js
    rig.tendrils.forEach((td, i) => {
      const tb = base.tendrils[i];
      const w = t * 1.1 + td.phase;
      const amp = (0.12 + td.len * 0.1) * (td.stiffness ?? 1) * (1 + pose.hair);
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

  // `action` and `mood` are exposed for the panel and for tests: what it is
  // doing right now, and how it feels about you
  return {
    update, rest, poke,
    get action() { return behaviour.current; },
    get mood() { return mood.id; },
    /** What the body did this frame. Valid until the next update(). */
    get events() { return events; },
    get moodLabel() { return mood.label; },
    get drives() { return mood.drives; },
  };
}
