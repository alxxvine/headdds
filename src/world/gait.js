import * as THREE from 'three';

// The walk cycle, played on the same pivot rig the idle animator drives —
// but never at the same time as it: in the world the gait owns the puppet.
// Same two survival rules as the animator: state lives out here because the
// mesh is rebuilt on any param change, and every frame writes ABSOLUTE
// transforms (base pose + delta) so nothing drifts.
export const GAIT = {
  legAmp: 0.62,     // how far a leg swings, radians at full speed
  armAmp: 0.5,      // arms answer the legs, opposite phase
  bob: 0.10,        // body bounce per step, in creature scale units
  lean: 0.1,        // forward lean at full speed
  sway: 0.06,       // side-to-side roll per step
  headBob: 0.05,    // the skull rides the steps with a lag
  puff: 0.5,        // how wide the maw hangs open on a hard climb
};

export function createGait() {
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  let rig = null;
  let base = null;
  let t = 0;

  const node = (o) => (o ? { pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone() } : null);
  const bind = (next) => {
    if (rig === next) return;
    rig = next;
    base = {
      root: node(next.root),
      head: node(next.headPivot),
      body: node(next.bodyPivot),
      legs: next.legs.map(node),
      shoulders: next.shoulders.map(node),
      tendrils: next.tendrils.map((td) => node(td.pivot)),
      jaw: node(next.jaw),
      spores: node(next.spores),
    };
  };

  const spin = (obj, b, x, y, z) => {
    _e.set(x, y, z);
    _q.setFromEuler(_e);
    obj.quaternion.copy(b.quat).multiply(_q);
  };

  /**
   * `w` is the walker's state: phase, speed, pitch, roll, grade.
   * `top` is TUNE.speed — full walking speed, for normalizing.
   */
  function update(nextRig, dt, w, top) {
    bind(nextRig);
    t += Math.min(0.05, dt);
    const S = rig.scale || 1;
    const on = Math.min(1, w.speed / top);   // 0 standing .. 1 full stride
    const ph = w.phase;

    // --- legs scissor, arms answer -----------------------------------------
    rig.legs.forEach((leg, i) => {
      spin(leg, base.legs[i], Math.sin(ph + Math.PI * i) * GAIT.legAmp * on, 0, 0);
    });
    rig.shoulders.forEach((sh, i) => {
      const cap = sh.userData.lift ?? 1.4;
      const swing = Math.sin(ph + Math.PI * i + Math.PI) * GAIT.armAmp * on
        + Math.sin(t * 1.6 + i * 2.1) * 0.05 * (1 - on);
      spin(sh, base.shoulders[i], Math.max(-cap, Math.min(cap, swing)), 0, 0);
    });

    // --- the body rides the steps -------------------------------------------
    // Two bounces per cycle: highest as the legs cross, lowest at full split.
    const bob = Math.cos(ph * 2) * 0.5 * GAIT.bob * S * on;
    const idleBreath = Math.sin(t * 1.7) * 0.012 * S * (1 - on);
    rig.root.position.set(
      base.root.pos.x,
      base.root.pos.y + bob + idleBreath,
      base.root.pos.z,
    );
    spin(
      rig.root, base.root,
      w.pitch + GAIT.lean * on,
      0,
      w.roll + Math.sin(ph) * GAIT.sway * on,
    );

    // --- the skull is heavy: it lags the bounce and nods into the effort ----
    spin(
      rig.headPivot, base.head,
      -GAIT.lean * on * 0.5 + Math.sin(ph * 2 - 0.9) * GAIT.headBob * on,
      Math.sin(ph) * 0.04 * on,
      -Math.sin(ph) * GAIT.sway * 0.6 * on,
    );
    rig.headPivot.position.set(
      base.head.pos.x,
      base.head.pos.y + Math.cos(ph * 2 - 0.7) * 0.02 * S * on,
      base.head.pos.z,
    );

    // --- puffing uphill: the maw hangs open on a climb ----------------------
    if (rig.jaw) {
      const effort = Math.max(0, Math.min(1, w.grade * 1.4)) * on;
      spin(rig.jaw, base.jaw, effort * GAIT.puff * 0.09, 0, 0);
    }

    // --- hair trails, spores drift ------------------------------------------
    rig.tendrils.forEach((td, i) => {
      const tb = base.tendrils[i];
      const amp = (0.1 + (td.len ?? 0.5) * 0.08) * (td.stiffness ?? 1);
      spin(
        td.pivot, tb,
        -on * 0.3 + Math.sin(t * 1.4 + (td.phase ?? i)) * amp * (0.4 + on),
        0,
        Math.cos(t + (td.phase ?? i)) * amp * 0.4,
      );
    });
    if (rig.spores) {
      spin(rig.spores, base.spores, 0, t * 0.25, 0);
    }
  }

  return { update };
}
