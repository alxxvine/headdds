import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { buildCreature } from '../creature/build.js';
import { PixelScale } from '../scene/Stage.jsx';
import { buildTerrain, groundHeight, WORLD } from './terrain.js';
import { createWalker, TUNE } from './walker.js';
import { createGait } from './gait.js';
import { createAnimator } from '../scene/animator.js';
import { createBombGame } from './bots.js';
import { createSnowGame, knockAngle, SNOW } from './snow.js';

// The walk-test micro-world: the current freak dropped onto the terrain of
// terrain.js, driven by walker.js, animated by gait.js.
//
// The camera is OURS alone — no OrbitControls in here. The pedestal's orbit
// ran its own damped update every frame, and with the mouse ALSO steering the
// camera the two fought over it: every frame each pulled its own way, which
// the player saw as constant jitter. One owner, no fight: the spherical orbit
// below is the only thing that ever writes the camera.

// every freak walks the world at the same stature, whatever the sliders say —
// the WORLD is tuned in these units
const STATURE = 2.2;

// One knob per input, all in one place.
export const CAM = {
  sens: 0.008,      // captured mouse, radians per pixel sideways (at speed 1x)
  sensY: 0.006,     // ...and vertically
  drag: 1.5,        // swipe/drag look, multiplier on top of sens
  stick: 3.0,       // right stick, radians per second sideways
  stickY: 2.0,      // ...and vertically
  minPhi: 0.35,     // how far over the top the eye may go
  maxPhi: Math.PI / 2 - 0.05,
  minDist: 2.2,
  maxDist: 26,
};

function WalkScene({ params, inputRef, camRef, jumpRef, runRef, hudRef, sens = 1, zoom = null, bombRound = 0, onBombEnd, bombHudRef, snowRound = 0, snowHudRef, throwRef }) {
  const { camera, gl } = useThree();
  // the in-game speed slider; a ref so the frame loop reads the live value
  const sensRef = useRef(sens);
  sensRef.current = sens;
  // the phone's zoom slider: whenever its value changes, the new distance is
  // applied once — the wheel keeps working on top of it
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomApplied = useRef(null);

  // the ink outline reads as grime at world scale — the game builds without
  // it; the pedestal and the editor keep theirs, and links stay untouched
  const built = useMemo(() => buildCreature({ ...params, outline: 0 }), [params]);
  useEffect(() => () => built.dispose(), [built]);

  const terrain = useMemo(() => buildTerrain(), []);
  useEffect(() => () => terrain.dispose(), [terrain]);

  // the walker and the gait OUTLIVE the build: dragging a slider mid-walk
  // swaps the puppet, not the position
  const walker = useMemo(() => createWalker(terrain.colliders), [terrain]);
  const gait = useMemo(() => createGait(), []);
  // standing still hands the puppet to the pedestal's idle animator — blinks,
  // breath, mood and all; the first step hands it back to the gait
  const idler = useMemo(() => createAnimator(), []);

  // BOMB TAG: each round number is a fresh game; 0 is no game at all
  const game = useMemo(
    () => (bombRound > 0 ? createBombGame(terrain.colliders) : null),
    [bombRound, terrain],
  );
  useEffect(() => () => { game?.dispose(); walker.state.boost = 1; }, [game, walker]);
  const bombReported = useRef(false);
  useEffect(() => { bombReported.current = false; }, [game]);

  // SNOWBALL FIGHT: same shape as the bomb — a round number keys a fresh game
  const snow = useMemo(
    () => (snowRound > 0 ? createSnowGame(terrain.colliders) : null),
    [snowRound, terrain],
  );
  useEffect(() => () => snow?.dispose(), [snow]);

  // the throw: LMB held (with the pointer captured) charges, release hurls a
  // snowball along the LOOK direction — aim high, it flies a real arc. The
  // phone's ❄ button walks the same road: `touch` marks who owns the charge
  // so a synthetic mouse event never fires somebody else's throw.
  const charge = useRef({ down: false, t: 0, touch: false });
  // the follow-through: set on a successful throw, decays over 0.2s while the
  // body whips forward
  const snapT = useRef(0);
  const releaseThrow = () => {
    const ch = charge.current;
    ch.down = false;
    if (!snow) { ch.t = 0; return; }
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const p = walker.state.pos;
    const origin = new THREE.Vector3(p.x, p.y + 1.7, p.z).addScaledVector(dir, 0.9);
    const v = SNOW.minV + Math.min(1, ch.t / SNOW.charge) * (SNOW.maxV - SNOW.minV);
    if (snow.playerThrow(origin, dir, v)) snapT.current = 0.2;
    ch.t = 0;
  };
  const releaseRef = useRef(releaseThrow);
  releaseRef.current = releaseThrow;
  useEffect(() => {
    if (!snow) return undefined;
    const dom = gl.domElement;
    const md = (e) => {
      if (e.button === 0 && document.pointerLockElement === dom) {
        charge.current.down = true;
        charge.current.t = 0;
        charge.current.touch = false;
      }
    };
    const mu = (e) => {
      const ch = charge.current;
      if (e.button !== 0 || !ch.down || ch.touch) return;
      releaseRef.current();
    };
    document.addEventListener('mousedown', md);
    document.addEventListener('mouseup', mu);
    return () => {
      document.removeEventListener('mousedown', md);
      document.removeEventListener('mouseup', mu);
      charge.current.down = false;
      charge.current.t = 0;
    };
  }, [snow, gl]);

  const carrier = useRef();
  // the snowball growing in the player's hand while a throw charges
  const handRef = useRef();
  const aimed = useRef(false);
  // the whole camera is these three numbers
  const cam = useRef({ theta: 0, phi: 1.15, dist: STATURE * 3.6 });
  // raw look input gathered between frames, spent once per frame
  const look = useRef({ dx: 0, dy: 0 });
  const _fwd = useRef(new THREE.Vector3());
  const _tgt = useRef(new THREE.Vector3());
  const _off = useRef(new THREE.Vector3());
  // how much of the camera arm is currently extended (0..1), smoothed
  const reach = useRef(1);

  // Look input, three doors into the same accumulator:
  //  - desktop: pointer lock — the bare mouse steers, ESC frees the cursor;
  //  - fallback and phones: drag/swipe across the world;
  //  - phones also have the right stick (read in the frame loop).
  useEffect(() => {
    const dom = gl.domElement;
    const fine = typeof matchMedia !== 'function' || matchMedia('(pointer: fine)').matches;

    const tryLock = () => {
      if (fine && document.pointerLockElement !== dom) {
        // may reject without a fresh gesture — fine, the click fallback stays
        try { dom.requestPointerLock()?.catch?.(() => {}); } catch { /* fine */ }
      }
    };
    const esc = (e) => {
      if (e.key === 'Escape' && document.pointerLockElement === dom) document.exitPointerLock();
    };

    // one pointermove handler serves both doors: captured mouse deltas when
    // locked, held-FINGER swipe deltas otherwise. A mouse button deliberately
    // does NOT drag the view — on a desktop the captured mouse is the one and
    // only way to look, so a stray click never spins the world.
    let dragId = null;
    let lx = 0;
    let ly = 0;
    const pdown = (e) => {
      if (e.pointerType !== 'touch') return;
      dragId = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
    };
    const pmove = (e) => {
      if (document.pointerLockElement === dom) {
        look.current.dx += e.movementX;
        look.current.dy += e.movementY;
        return;
      }
      if (dragId !== e.pointerId) return;
      look.current.dx += (e.clientX - lx) * CAM.drag;
      look.current.dy += (e.clientY - ly) * CAM.drag;
      lx = e.clientX;
      ly = e.clientY;
    };
    const pup = (e) => { if (dragId === e.pointerId) dragId = null; };
    // the mouse BUTTONS mean nothing to the camera: no drag-look, and no
    // context menu popping over the world on a stray right click
    const menu = (e) => e.preventDefault();
    const wheel = (e) => {
      e.preventDefault();
      cam.current.dist = THREE.MathUtils.clamp(
        cam.current.dist * (e.deltaY > 0 ? 1.1 : 0.9), CAM.minDist, CAM.maxDist);
    };

    tryLock();
    dom.addEventListener('click', tryLock);
    dom.addEventListener('pointerdown', pdown);
    window.addEventListener('pointermove', pmove);
    window.addEventListener('pointerup', pup);
    window.addEventListener('pointercancel', pup);
    dom.addEventListener('wheel', wheel, { passive: false });
    dom.addEventListener('contextmenu', menu);
    document.addEventListener('keydown', esc);
    return () => {
      dom.removeEventListener('click', tryLock);
      dom.removeEventListener('pointerdown', pdown);
      window.removeEventListener('pointermove', pmove);
      window.removeEventListener('pointerup', pup);
      window.removeEventListener('pointercancel', pup);
      dom.removeEventListener('wheel', wheel);
      dom.removeEventListener('contextmenu', menu);
      document.removeEventListener('keydown', esc);
      if (document.pointerLockElement === dom) document.exitPointerLock();
    };
  }, [gl]);

  useFrame((state, dt) => {
    if (!carrier.current) return;
    const w = walker.state;

    if (!aimed.current) {
      aimed.current = true;
      camera.near = 0.1;
      camera.far = 300;
      camera.updateProjectionMatrix();
    }

    // spend the gathered look input. Mouse/swipe up looks UP (the camera
    // drops), like every shooter since forever.
    const ci = camRef?.current;
    const lk = look.current;
    const c = cam.current;
    const k = sensRef.current;
    c.theta -= (ci?.x ?? 0) * CAM.stick * dt + lk.dx * CAM.sens * k;
    // stick up looks UP, exactly like the mouse: pushing up drops the camera
    c.phi = THREE.MathUtils.clamp(
      c.phi + (ci?.y ?? 0) * CAM.stickY * dt - lk.dy * CAM.sensY * k,
      CAM.minPhi, CAM.maxPhi);
    lk.dx = 0;
    lk.dy = 0;
    if (zoomRef.current != null && zoomRef.current !== zoomApplied.current) {
      zoomApplied.current = zoomRef.current;
      c.dist = THREE.MathUtils.clamp(zoomRef.current, CAM.minDist, CAM.maxDist);
    }

    // a queued jump fires on this frame's ground truth — unless the player is
    // flat on their back in a snowball fight
    if (jumpRef?.current) {
      jumpRef.current = false;
      if (!snow?.state.playerKnock) walker.jump();
    }

    // stick/keys are camera-relative: up on the stick walks away from the lens
    const fwd = _fwd.current.set(-Math.sin(c.theta), 0, -Math.cos(c.theta));
    const inp = inputRef.current;
    // flat on the back, the legs answer nobody
    const down = !!snow?.state.playerKnock;
    const wx = down ? 0 : fwd.x * inp.y - fwd.z * inp.x;
    const wz = down ? 0 : fwd.z * inp.y + fwd.x * inp.x;

    walker.update(dt, wx, wz, !!runRef?.current);

    // the stamina bar lives outside React: written every frame, shown only
    // while it is not full, red while the creature is winded
    const hud = hudRef?.current;
    if (hud?.fill) {
      hud.fill.style.transform = `scaleX(${w.stamina})`;
      hud.fill.style.background = w.winded ? '#e8642c' : '';
      if (hud.box) hud.box.style.opacity = w.stamina >= 1 ? '0' : '1';
    }
    // moving or airborne: the gait owns the puppet. Standing: the pedestal's
    // idle animator does — same blinks, breath and moods as on the stand.
    // Both write absolute transforms off the built pose, so the hand-over is
    // a small step, and it lands where both amplitudes are near zero.
    if (w.speed > 0.25 || w.air) {
      gait.update(built.rig, dt, w, TUNE.speed);
    } else {
      idler.update(built.rig, built.stats, dt, { pointer: { x: 0, y: 0 }, active: false, spin: 0 });
    }

    carrier.current.position.copy(w.pos);
    carrier.current.rotation.y = w.yaw;

    // The camera hangs off the creature on its spherical arm — but the arm
    // COLLIDES: where full length would put the eye inside a hill or out past
    // the world's rim, the arm shortens and the camera closes in on the
    // creature instead. Lifting the eye over the obstacle was the old answer,
    // and at the map's edge the rim is so tall the lift read as the camera
    // flying away.
    const tgt = _tgt.current.set(w.pos.x, w.pos.y + STATURE * 0.7, w.pos.z);
    const off = _off.current.setFromSphericalCoords(c.dist, c.phi, c.theta);
    // Where along the arm may the eye sit? Found CONTINUOUSLY — a coarse scan
    // plus a bisection — because an 8-step grid made the trailing camera hop
    // in one-unit jumps whenever the creature walked toward a blocked arm.
    const fits = (f) => {
      const px = tgt.x + off.x * f;
      const pz = tgt.z + off.z * f;
      return Math.abs(px) < WORLD - 2.5 && Math.abs(pz) < WORLD - 2.5
        && tgt.y + off.y * f > groundHeight(px, pz) + 0.5;
    };
    let want = 1 / 16;
    if (fits(1)) want = 1;
    else {
      let good = 1 / 16;
      let bad = 1;
      for (let i = 15; i >= 1; i--) {
        if (fits(i / 16)) { good = i / 16; bad = (i + 1) / 16; break; }
      }
      for (let k = 0; k < 5; k++) {
        const m = (good + bad) / 2;
        if (fits(m)) good = m; else bad = m;
      }
      want = good;
    }
    // the arm SNAPS in (never clip into a hill) and EASES back out
    reach.current = want < reach.current
      ? want
      : reach.current + (want - reach.current) * (1 - Math.exp(-dt * 4));
    camera.position.copy(tgt).addScaledVector(off, reach.current);
    // whatever length survived, never leave the eye under the skin
    const camFloor = groundHeight(camera.position.x, camera.position.z) + 0.5;
    if (camera.position.y < camFloor) camera.position.y = camFloor;
    camera.lookAt(tgt);

    // the tests read the walk from here — cheaper than teaching them to parse
    // a pixelated screenshot
    // SNOWBALL FIGHT: knocked flat, the legs answer nobody and the body tips
    // onto its back; the stage owns the player's mesh, so the tilt lives here
    if (snow) {
      const ch = charge.current;
      // the phone's ❄ button: press starts a touch-owned charge, release
      // throws — same charge, same arc, no pointer lock required
      const tb = throwRef?.current;
      if (tb) {
        if (tb.down && !tb.was && !ch.down) { ch.down = true; ch.t = 0; ch.touch = true; }
        if (!tb.down && tb.was && ch.down && ch.touch) releaseRef.current();
        tb.was = tb.down;
      }
      if (ch.down) ch.t += dt;
      snow.update(dt, w);
      // the wind-up reads on the body: the ball grows in the hand and the
      // torso leans back with the charge, then whips forward on release —
      // unless the player is flat on their back
      const ck = ch.down && !snow.state.playerKnock ? Math.min(1, ch.t / SNOW.charge) : 0;
      snapT.current = Math.max(0, snapT.current - dt);
      if (handRef.current) {
        handRef.current.visible = ck > 0;
        handRef.current.scale.setScalar(0.5 + ck * 0.6);
      }
      carrier.current.rotation.x = snow.state.playerKnock
        ? knockAngle(snow.state.playerKnock.t)
        : -0.22 * ck + 0.5 * (snapT.current / 0.2);
      const shud = snowHudRef?.current;
      if (shud?.el) shud.el.textContent = `❄ hits ${snow.state.hits} · taken ${snow.state.taken}`;
      if (shud?.fill) {
        shud.fill.style.transform = `scaleX(${charge.current.down ? Math.min(1, charge.current.t / SNOW.charge) : 0})`;
        if (shud.box) shud.box.style.opacity = charge.current.down ? '1' : '0';
      }
    } else {
      if (carrier.current.rotation.x !== 0) carrier.current.rotation.x = 0;
      if (handRef.current?.visible) handRef.current.visible = false;
    }

    // the round itself: bots think, the bomb rides, the fuse burns
    if (game) {
      game.update(dt, w);
      const gs = game.state;
      // just handed the bomb off: flicker while the pass-back immunity lasts
      carrier.current.visible = !gs.playerGhost || Math.sin(state.clock.elapsedTime * 24) > -0.2;
      if (gs.over && !bombReported.current) {
        bombReported.current = true;
        onBombEnd?.(gs.over);
      }
      const hud = bombHudRef?.current;
      if (hud?.el) {
        const out = gs.playerOut > 0
          ? ` · ⚠ OUTSIDE THE RING ${(Math.max(0, 2.5 - gs.playerOut)).toFixed(1)}` : '';
        hud.el.textContent = gs.over ? '' : `${gs.holder === 0 ? '\u{1F4A3} YOU ARE IT — touch someone' : 'the bomb is out there'} · ${Math.max(0, gs.fuse).toFixed(1)}s · ${gs.alive} alive · ring ${gs.zoneR.toFixed(0)}m${out}`;
        hud.el.style.color = gs.playerOut > 0 ? '#ff3020' : gs.holder === 0 ? '#ff6a4a' : '';
      }
    }

    window.__walk = {
      x: w.pos.x, y: w.pos.y, z: w.pos.z, speed: w.speed, grade: w.grade, air: w.air, vy: w.vy,
      stamina: w.stamina, run: w.run, winded: w.winded,
      bomb: game ? {
        holder: game.state.holder, fuse: game.state.fuse, alive: game.state.alive,
        over: game.state.over, zoneR: game.state.zoneR, out: game.state.playerOut,
        prev: game.state.prev, ghost: !!game.state.playerGhost,
      } : null,
      snow: snow ? {
        hits: snow.state.hits, taken: snow.state.taken,
        balls: snow.balls.length, down: !!snow.state.playerKnock,
        charge: charge.current.down ? Math.min(1, charge.current.t / SNOW.charge) : 0,
      } : null,
      camX: camera.position.x, camY: camera.position.y, camZ: camera.position.z,
    };
  });

  const fit = STATURE / Math.max(1e-6, built.fitSize.y);

  return (
    <>
      <primitive object={terrain.group} />
      {game && <primitive object={game.group} />}
      {snow && <primitive object={snow.group} />}
      {/* the gait writes offsets into the creature root's own position, so
          the stature scale lives on a wrapper — scaling the root itself would
          leave those offsets unscaled */}
      <group ref={carrier}>
        <group scale={[fit, fit, fit]}>
          <primitive object={built.group} />
        </group>
        {/* the wind-up snowball: same seat and growth as the bots' */}
        <mesh ref={handRef} position={[0.42, 1.15, 0.5]} visible={false}>
          <sphereGeometry args={[SNOW.radius, 8, 6]} />
          <meshLambertMaterial color="#f4f7ff" />
        </mesh>
      </group>
    </>
  );
}

export default function WorldStage({ params, inputRef, camRef, jumpRef, runRef, hudRef, sens = 1, zoom = null, bombRound = 0, onBombEnd, bombHudRef, snowRound = 0, snowHudRef, throwRef }) {
  const pixelate = params.pixelate !== 'off';
  // the world's sky is the pedestal background lifted a shade toward dusk
  // blue, and the fog is the SAME color — so the horizon melts into the sky
  // instead of the hills standing as cutouts against a black hole
  const sky = useMemo(
    () => `#${new THREE.Color(params.bgColor).lerp(new THREE.Color('#8fa6c4'), 0.22).getHexString()}`,
    [params.bgColor],
  );
  return (
    <Canvas
      className={pixelate ? 'stage pixelated' : 'stage'}
      dpr={pixelate ? 1 / params.pixelSize : 1.5}
      gl={{ antialias: false, alpha: false, preserveDrawingBuffer: true }}
      camera={{ fov: 42, position: [0, 3, 8] }}
    >
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={[sky, 22, 60]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#8fa6c4', '#241a2b', 1.1]} />
      <directionalLight position={[3, 5, 6]} intensity={2.6} />
      <directionalLight position={[-5, 2, -3]} intensity={0.9} color="#7f6bb0" />
      <PixelScale pixelSize={params.pixelSize} pixelate={pixelate} />
      <WalkScene
        params={params}
        inputRef={inputRef}
        camRef={camRef}
        jumpRef={jumpRef}
        runRef={runRef}
        hudRef={hudRef}
        sens={sens}
        zoom={zoom}
        bombRound={bombRound}
        onBombEnd={onBombEnd}
        bombHudRef={bombHudRef}
        snowRound={snowRound}
        snowHudRef={snowHudRef}
        throwRef={throwRef}
      />
    </Canvas>
  );
}
