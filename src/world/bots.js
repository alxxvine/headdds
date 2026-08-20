import * as THREE from 'three';
import { buildCreature } from '../creature/build.js';
import { randomize, randomSeed } from '../creature/schema.js';
import { createWalker, TUNE } from './walker.js';
import { createGait } from './gait.js';
import { groundHeight, WORLD } from './terrain.js';

// BOMB TAG. Five random freaks share the map with the player; one of them is
// holding a lit bomb. Touch someone — the bomb is theirs. When the fuse runs
// out, whoever holds it is gone, the bomb lights up in a random survivor's
// hands, and the round grinds on until one creature is left standing.
//
// Everything here is plain simulation — the bots run on the SAME walker
// physics as the player (colliders, slopes, stamina, jumps), so nobody
// cheats through a rock.

export const BOMB = {
  bots: 5,
  fuseMin: 16,      // seconds on the fuse, rolled per bomb
  fuseMax: 24,
  reach: 1.25,      // touching closer than this hands the bomb over
  handLock: 1.0,    // right after a pass nobody can pass at all...
  backLock: 2.5,    // ...and the PREVIOUS holder is safe this long
  chaseRun: 3,      // the holder sprints when its prey is further than this
  fleeRun: 7,       // everyone else sprints when the holder is this close
};

// must match WorldStage's STATURE: every creature walks the world at this height
const STATURE = 2.2;

/**
 * One round of bomb tag. `update(dt, player)` steps everything and returns
 * the tick's events; `state.over` becomes 'win' | 'lose' when it ends.
 * Entity ids: 0 is the player, 1..N are the bots.
 */
export function createBombGame(colliders) {
  const group = new THREE.Group();

  const bots = [];
  for (let i = 0; i < BOMB.bots; i++) {
    const built = buildCreature({ ...randomize(randomSeed()), outline: 0 });
    const walker = createWalker(colliders);
    const ang = (i / BOMB.bots) * Math.PI * 2 + Math.random() * 0.7;
    const r = 9 + Math.random() * 5;
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
      alive: true, wanderA: Math.random() * Math.PI * 2, wanderT: 0, stuck: 0,
    });
  }

  // the bomb: a black ball with a heartbeat that panics as the fuse shortens
  const bombMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 10, 8),
    new THREE.MeshLambertMaterial({ color: '#161616', emissive: new THREE.Color('#ff5a30'), emissiveIntensity: 0.4 }),
  );
  group.add(bombMesh);

  const fxGeo = new THREE.SphereGeometry(1, 12, 8);
  const fx = [];
  const explodeAt = (p) => {
    const m = new THREE.Mesh(fxGeo, new THREE.MeshBasicMaterial({ color: '#ffcf90', transparent: true, opacity: 0.9 }));
    m.position.copy(p);
    m.position.y += 1;
    group.add(m);
    fx.push({ m, t: 0 });
  };

  const rollFuse = () => BOMB.fuseMin + Math.random() * (BOMB.fuseMax - BOMB.fuseMin);
  const state = {
    holder: 1 + Math.floor(Math.random() * BOMB.bots),   // a bot draws the short straw
    prev: -1,
    fuse: rollFuse(),
    sinceHand: 99,
    over: null,       // 'win' | 'lose'
    alive: BOMB.bots + 1,
    t: 0,
  };

  const entPos = (id, player) => (id === 0 ? player.pos : bots[id - 1].walker.state.pos);
  const aliveIds = () => [0, ...bots.filter((b) => b.alive).map((b) => b.id)];

  function update(dt, player) {
    state.t += dt;
    // the blast rings keep swelling even over a finished game
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.t += dt;
      const k = f.t / 0.6;
      f.m.scale.setScalar(0.4 + k * 4.5);
      f.m.material.opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) { group.remove(f.m); f.m.material.dispose(); fx.splice(i, 1); }
    }
    if (state.over) return null;

    state.sinceHand += dt;
    state.fuse -= dt;
    const events = [];
    const holderPos = entPos(state.holder, player);

    // ------------------------------------------------------------ bot minds
    for (const b of bots) {
      if (!b.alive) continue;
      const p = b.walker.state.pos;
      let ix = 0;
      let iz = 0;
      let run = false;

      if (state.holder === b.id) {
        // it: chase whoever is nearest and still breathing
        let best = null;
        let bd = 1e9;
        for (const id of aliveIds()) {
          if (id === b.id) continue;
          const q = entPos(id, player);
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < bd) { bd = d; best = q; }
        }
        if (best) {
          ix = (best.x - p.x) / (bd || 1);
          iz = (best.z - p.z) / (bd || 1);
          run = bd > BOMB.chaseRun;
        }
      } else {
        // not it: away from the bomb, with a wander so the herd spreads out
        const dx = p.x - holderPos.x;
        const dz = p.z - holderPos.z;
        const d = Math.hypot(dx, dz) || 1;
        b.wanderT -= dt;
        if (b.wanderT <= 0) {
          b.wanderT = 1.5 + Math.random() * 2;
          b.wanderA = Math.random() * Math.PI * 2;
        }
        const flee = Math.max(0, 1 - d / 14);
        ix = (dx / d) * flee + Math.cos(b.wanderA) * (1 - flee) * 0.7;
        iz = (dz / d) * flee + Math.sin(b.wanderA) * (1 - flee) * 0.7;
        // the rim is a dead end: bend the flight back toward open ground
        const cd = Math.hypot(p.x, p.z);
        if (cd > WORLD - 8) {
          ix -= (p.x / cd) * 0.9;
          iz -= (p.z / cd) * 0.9;
        }
        run = d < BOMB.fleeRun;
      }

      // pinned against a rock: hop it and pick a new line
      if (Math.hypot(ix, iz) > 0.1 && b.walker.state.speed < 0.6) {
        b.stuck += dt;
        if (b.stuck > 0.8) { b.walker.jump(); b.wanderA += 2; b.stuck = 0; }
      } else b.stuck = 0;

      b.walker.update(dt, ix, iz, run);
      b.carrier.position.copy(p);
      b.carrier.rotation.y = b.walker.state.yaw;
      b.gait.update(b.built.rig, dt, b.walker.state, TUNE.speed);
    }

    // ---------------------------------------------------------- the pass
    if (state.sinceHand > BOMB.handLock) {
      const hp = entPos(state.holder, player);
      for (const id of aliveIds()) {
        if (id === state.holder) continue;
        if (id === state.prev && state.sinceHand < BOMB.backLock) continue;
        const q = entPos(id, player);
        if (Math.hypot(q.x - hp.x, q.z - hp.z) < BOMB.reach && Math.abs(q.y - hp.y) < 1.8) {
          state.prev = state.holder;
          state.holder = id;
          state.sinceHand = 0;
          events.push({ type: 'pass', to: id });
          break;
        }
      }
    }

    // ---------------------------------------------------------- the boom
    if (state.fuse <= 0) {
      explodeAt(entPos(state.holder, player));
      events.push({ type: 'boom', id: state.holder });
      if (state.holder === 0) {
        state.over = 'lose';
      } else {
        const b = bots[state.holder - 1];
        b.alive = false;
        group.remove(b.carrier);
        state.alive -= 1;
        if (!bots.some((x) => x.alive)) {
          state.over = 'win';
        } else {
          const ids = bots.filter((x) => x.alive).map((x) => x.id);
          state.holder = ids[Math.floor(Math.random() * ids.length)];
          state.prev = -1;
          state.fuse = rollFuse();
          state.sinceHand = 99;
        }
      }
    }

    // ----------------------------------------- the bomb rides its holder
    if (!state.over) {
      const hp = entPos(state.holder, player);
      const panic = Math.max(0, 1 - state.fuse / 6);
      bombMesh.position.set(hp.x, hp.y + STATURE + 0.45, hp.z);
      bombMesh.scale.setScalar(1 + Math.sin(state.t * (6 + panic * 18)) * (0.08 + panic * 0.22));
      bombMesh.material.emissiveIntensity = 0.35 + panic * 1.5;
    } else {
      bombMesh.visible = false;
    }
    return events;
  }

  function dispose() {
    for (const b of bots) b.built.dispose();
    for (const f of fx) f.m.material.dispose();
    fxGeo.dispose();
    bombMesh.geometry.dispose();
    bombMesh.material.dispose();
  }

  return { group, state, bots, update, dispose };
}
