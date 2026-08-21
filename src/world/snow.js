import * as THREE from 'three';
import { buildCreature } from '../creature/build.js';
import { randomize, randomSeed } from '../creature/schema.js';
import { createWalker, TUNE } from './walker.js';
import { createGait } from './gait.js';
import { groundHeight, WORLD } from './terrain.js';

// SNOWBALL FIGHT. Five bots and the player pelt each other with snowballs.
// A snowball is a real projectile — it flies a ballistic arc and drops, so a
// long throw is aimed HIGH and a held button charges a harder one. A hit
// knocks the victim flat on its back for a beat; nobody is ever out. The
// scoreboard just counts hits given and taken.

export const SNOW = {
  bots: 5,
  g: 16,            // snowball gravity — floatier than the walker's, arcs read
  radius: 0.24,
  minV: 9,          // a tap lobs it...
  maxV: 23,         // ...a full charge hurls it
  charge: 1.2,      // seconds of holding for a full-power throw
  cooldown: 0.45,   // the player's hands, between throws
  knock: 2.2,       // how long a hit keeps you on your back
  botCdMin: 1.7,    // bots wind up a new throw every...
  botCdMax: 3.2,
  botRange: 24,     // ...at anything closer than this
  near: 6,          // bots back off inside this ring around their target
  far: 14,          // ...and close in outside this one
};

// must match WorldStage's STATURE: every creature walks the world at this height
const STATURE = 2.2;

/** The knockdown pose: 0 upright, -PI/2 flat on the back, with a fast fall
 * and a slower climb back up. Exported so the stage can tilt the player. */
export function knockAngle(t) {
  const fall = Math.min(1, t / 0.25);
  const riseStart = SNOW.knock - 0.5;
  const rise = t > riseStart ? Math.min(1, (t - riseStart) / 0.5) : 0;
  return (-Math.PI / 2) * fall * (1 - rise);
}

export function createSnowGame(colliders) {
  const group = new THREE.Group();

  const bots = [];
  for (let i = 0; i < SNOW.bots; i++) {
    const built = buildCreature({ ...randomize(randomSeed()), outline: 0 });
    const walker = createWalker(colliders);
    const ang = (i / SNOW.bots) * Math.PI * 2 + Math.random() * 0.7;
    const r = 8 + Math.random() * 6;
    walker.state.pos.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    walker.state.pos.y = groundHeight(walker.state.pos.x, walker.state.pos.z);
    walker.state.yaw = Math.random() * Math.PI * 2;

    const carrier = new THREE.Group();
    const fitG = new THREE.Group();
    fitG.scale.setScalar(STATURE / Math.max(1e-6, built.fitSize.y));
    fitG.add(built.group);
    carrier.add(fitG);
    carrier.position.copy(walker.state.pos);
    group.add(carrier);

    bots.push({
      id: i + 1, built, walker, carrier, gait: createGait(),
      wanderA: Math.random() * Math.PI * 2, wanderT: 0, stuck: 0,
      strafe: Math.random() < 0.5 ? 1 : -1,
      cd: 1 + Math.random() * 2,       // first throw comes soon
      targetId: -1, targetT: 0,
      knock: null,                     // { t } while flat on its back
    });
  }

  // shared snowball dressing
  const ballGeo = new THREE.SphereGeometry(SNOW.radius, 8, 6);
  const ballMat = new THREE.MeshLambertMaterial({ color: '#f4f7ff' });
  const balls = [];

  const fxGeo = new THREE.SphereGeometry(1, 10, 6);
  const fx = [];
  const splatAt = (p) => {
    const m = new THREE.Mesh(fxGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
    m.position.copy(p);
    group.add(m);
    fx.push({ m, t: 0 });
  };

  const state = {
    hits: 0,          // snowballs the player landed on somebody
    taken: 0,         // snowballs that landed on the player
    playerKnock: null, // { t } while the player is flat
    playerCd: 0,
    t: 0,
  };

  const entPos = (id, player) => (id === 0 ? player.pos : bots[id - 1].walker.state.pos);
  const entKnocked = (id) => (id === 0 ? state.playerKnock !== null : bots[id - 1].knock !== null);

  /** Anyone may throw: 0 is the player. Direction is normalized here. */
  function throwBall(owner, origin, dir, speed) {
    const d = dir.clone().normalize();
    const m = new THREE.Mesh(ballGeo, ballMat);
    m.position.copy(origin);
    group.add(m);
    balls.push({ m, vel: d.multiplyScalar(speed), owner, t: 0 });
  }

  /** A ballistic lead at a standing-height target: pick the arc, derive the
   * speed, smear both a little so bots miss like people do. */
  function botThrow(b, targetPos) {
    const p = b.walker.state.pos;
    const dx = targetPos.x - p.x;
    const dz = targetPos.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const a = (0.5 + Math.min(0.35, d / 80)) + (Math.random() - 0.5) * 0.1;   // ~30-50°
    let v = Math.sqrt((SNOW.g * d) / Math.max(0.2, Math.sin(2 * a)));
    v = Math.min(SNOW.maxV, v * (0.92 + Math.random() * 0.16));
    const dir = new THREE.Vector3(
      (dx / d) * Math.cos(a),
      Math.sin(a),
      (dz / d) * Math.cos(a),
    );
    const origin = new THREE.Vector3(p.x, p.y + 1.7, p.z).addScaledVector(dir, 0.8);
    throwBall(b.id, origin, dir, v);
  }

  const knock = (id) => {
    if (id === 0) state.playerKnock = { t: 0 };
    else bots[id - 1].knock = { t: 0 };
  };

  function update(dt, player) {
    state.t += dt;
    state.playerCd = Math.max(0, state.playerCd - dt);

    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.t += dt;
      const k = f.t / 0.35;
      f.m.scale.setScalar(0.2 + k * 1.6);
      f.m.material.opacity = Math.max(0, 0.7 * (1 - k));
      if (k >= 1) { group.remove(f.m); f.m.material.dispose(); fx.splice(i, 1); }
    }

    // ------------------------------------------------------------ knockdowns
    if (state.playerKnock) {
      state.playerKnock.t += dt;
      if (state.playerKnock.t >= SNOW.knock) state.playerKnock = null;
    }
    for (const b of bots) {
      if (!b.knock) continue;
      b.knock.t += dt;
      b.carrier.rotation.x = knockAngle(b.knock.t);
      if (b.knock.t >= SNOW.knock) { b.knock = null; b.carrier.rotation.x = 0; }
    }

    // ------------------------------------------------------------ bot minds
    for (const b of bots) {
      const p = b.walker.state.pos;
      if (b.knock) {
        // flat on its back: the legs answer nobody
        b.walker.update(dt, 0, 0, false);
        b.carrier.position.copy(p);
        continue;
      }
      // pick somebody to pelt, and stay loyal for a moment
      b.targetT -= dt;
      const ids = [0, ...bots.filter((x) => x !== b).map((x) => x.id)];
      if (b.targetT <= 0 || !ids.includes(b.targetId)) {
        let bd = 1e9;
        for (const id of ids) {
          const q = entPos(id, player);
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < bd) { bd = d; b.targetId = id; }
        }
        b.targetT = 2 + Math.random() * 1.5;
        b.strafe = Math.random() < 0.5 ? 1 : -1;
      }
      const q = entPos(b.targetId, player);
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.hypot(dx, dz) || 1;

      // keep sniping distance: in past `far` close in, inside `near` back off,
      // in between circle the target sideways
      let ix;
      let iz;
      let run = false;
      if (d > SNOW.far) { ix = dx / d; iz = dz / d; run = d > 18; }
      else if (d < SNOW.near) { ix = -dx / d; iz = -dz / d; }
      else { ix = (-dz / d) * b.strafe; iz = (dx / d) * b.strafe; }
      // drifting out of the map's heart is how you get cornered
      const cd = Math.hypot(p.x, p.z);
      if (cd > WORLD - 8) { ix -= (p.x / cd) * 0.9; iz -= (p.z / cd) * 0.9; }

      if (Math.hypot(ix, iz) > 0.1 && b.walker.state.speed < 0.6) {
        b.stuck += dt;
        if (b.stuck > 0.8) { b.walker.jump(); b.strafe *= -1; b.stuck = 0; }
      } else b.stuck = 0;

      b.walker.update(dt, ix, iz, run);
      b.carrier.position.copy(p);
      b.carrier.rotation.y = b.walker.state.yaw;
      b.gait.update(b.built.rig, dt, b.walker.state, TUNE.speed);

      // and the throw itself
      b.cd -= dt;
      if (b.cd <= 0 && d < SNOW.botRange && !entKnocked(b.targetId)) {
        botThrow(b, q);
        b.cd = SNOW.botCdMin + Math.random() * (SNOW.botCdMax - SNOW.botCdMin);
      }
    }

    // ------------------------------------------------------------ the balls
    for (let i = balls.length - 1; i >= 0; i--) {
      const ball = balls[i];
      ball.t += dt;
      ball.vel.y -= SNOW.g * dt;
      ball.m.position.addScaledVector(ball.vel, dt);
      const bp = ball.m.position;
      let gone = ball.t > 6;

      // whoever it lands on goes down
      if (!gone) {
        for (const id of [0, ...bots.map((x) => x.id)]) {
          if (id === ball.owner && ball.t < 0.25) continue;
          if (entKnocked(id)) continue;
          const q = entPos(id, player);
          if (Math.hypot(bp.x - q.x, bp.z - q.z) < 0.85 && bp.y > q.y && bp.y < q.y + 2.3) {
            knock(id);
            if (ball.owner === 0 && id !== 0) state.hits += 1;
            if (id === 0) state.taken += 1;
            gone = true;
            break;
          }
        }
      }
      // the world stops the rest: ground, rocks, trunks
      if (!gone && bp.y - SNOW.radius <= groundHeight(bp.x, bp.z)) gone = true;
      if (!gone) {
        for (const c of colliders) {
          if (bp.y < (c.top ?? Infinity)
            && Math.hypot(bp.x - c.x, bp.z - c.z) < c.r) { gone = true; break; }
        }
      }
      if (gone) {
        splatAt(bp);
        group.remove(ball.m);
        balls.splice(i, 1);
      }
    }

    return null;
  }

  /** The player's throw, called by the stage on mouse release. */
  function playerThrow(origin, dir, chargedV) {
    if (state.playerCd > 0 || state.playerKnock) return false;
    state.playerCd = SNOW.cooldown;
    throwBall(0, origin, dir, chargedV);
    return true;
  }

  function dispose() {
    for (const b of bots) b.built.dispose();
    for (const f of fx) f.m.material.dispose();
    for (const ball of balls) group.remove(ball.m);
    fxGeo.dispose();
    ballGeo.dispose();
    ballMat.dispose();
  }

  return { group, state, bots, balls, update, playerThrow, dispose };
}
