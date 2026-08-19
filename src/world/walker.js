import * as THREE from 'three';
import { groundHeight, groundNormal, WORLD } from './terrain.js';

// The walking itself, kept apart from the drawing so it can be tuned in one
// place. Everything a foot does comes from here; the gait module only makes
// it LOOK like walking.
export const TUNE = {
  speed: 5.4,       // units/s on the flat (the creature stands ~2.2 tall)
  accel: 9,         // how quickly it gets up to speed / stops
  turn: 9,          // how quickly it faces where it is going
  uphill: 0.62,     // fraction of speed lost per unit of grade when climbing
  downhill: 0.22,   // ...and gained going down, milder
  slowest: 0.28,    // the crawl it is reduced to on the steepest legal climb
  maxGrade: 1.15,   // tan of the steepest slope it can climb at all (~49°)
  stride: 2.3,      // units of ground covered by one full step cycle
  glue: 18,         // how hard the feet stick to the ground (height chase rate)
};

const _n = new THREE.Vector3();

export function createWalker() {
  const pos = new THREE.Vector3(0, groundHeight(0, 0), 0);
  const state = {
    pos,
    yaw: 0,          // where the body faces (radians, 0 = +z)
    speed: 0,        // current ground speed, units/s
    phase: 0,        // gait phase: one full cycle per stride
    grade: 0,        // ground grade along the direction of travel
    pitch: 0,        // body tilt matching the slope underfoot
    roll: 0,
  };

  /**
   * One tick. `ix, iz` is the wanted direction in WORLD space (already
   * camera-relative), length 0..1.
   */
  function update(dt, ix, iz) {
    const step = Math.min(0.05, dt);
    let mag = Math.hypot(ix, iz);
    if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }

    let target = 0;
    if (mag > 0.05) {
      const dx = ix / mag;
      const dz = iz / mag;
      // face where it is going, by the shortest way round
      const wantYaw = Math.atan2(dx, dz);
      let d = wantYaw - state.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      state.yaw += d * (1 - Math.exp(-step * TUNE.turn));

      // the grade right ahead is what sets the pace: climbing is slow,
      // descending is a little quick, a cliff is a wall
      const reach = 0.7;
      const ahead = groundHeight(pos.x + dx * reach, pos.z + dz * reach);
      state.grade = (ahead - groundHeight(pos.x, pos.z)) / reach;
      const f = state.grade > 0
        ? Math.max(TUNE.slowest, 1 - state.grade * TUNE.uphill)
        : Math.min(1.25, 1 - state.grade * TUNE.downhill);
      target = state.grade > TUNE.maxGrade ? 0 : TUNE.speed * mag * f;
    } else {
      state.grade = 0;
    }

    state.speed += (target - state.speed) * (1 - Math.exp(-step * TUNE.accel));
    if (state.speed < 0.02 && target === 0) state.speed = 0;

    if (state.speed > 0) {
      // it walks the way it FACES — steering carves an arc instead of the
      // body strafing sideways while it is still turning
      const fx = Math.sin(state.yaw);
      const fz = Math.cos(state.yaw);
      pos.x = THREE.MathUtils.clamp(pos.x + fx * state.speed * step, -(WORLD - 2), WORLD - 2);
      pos.z = THREE.MathUtils.clamp(pos.z + fz * state.speed * step, -(WORLD - 2), WORLD - 2);
    }

    // feet glued to the formula, softened just enough to eat washboard jitter.
    // On a steep face the ground rises under the front of the body, so the
    // stance point is lifted with the tilt — otherwise the downhill-side feet
    // stand right and the uphill side is buried to the shins.
    groundNormal(pos.x, pos.z, _n);
    const floor = groundHeight(pos.x, pos.z) + (1 - _n.y) * 0.8;
    pos.y += (floor - pos.y) * (1 - Math.exp(-step * TUNE.glue));

    // the body leans with the ground it stands on — a fraction of the true
    // tilt reads as footing, the whole of it reads as falling over
    const fx = Math.sin(state.yaw);
    const fz = Math.cos(state.yaw);
    const wantPitch = Math.atan2(_n.x * fx + _n.z * fz, _n.y) * 0.55;
    const wantRoll = Math.atan2(_n.x * fz - _n.z * fx, _n.y) * 0.35;
    state.pitch += (wantPitch - state.pitch) * (1 - Math.exp(-step * 8));
    state.roll += (wantRoll - state.roll) * (1 - Math.exp(-step * 8));

    state.phase += (state.speed * step / TUNE.stride) * Math.PI * 2;
    return state;
  }

  return { state, update };
}
