import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { buildCreature } from '../creature/build.js';
import { PixelScale } from '../scene/Stage.jsx';
import { buildTerrain, groundHeight, WORLD } from './terrain.js';
import { createWalker, TUNE } from './walker.js';
import { createGait } from './gait.js';
import { createAnimator } from '../scene/animator.js';

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

function WalkScene({ params, inputRef, camRef, jumpRef, sens = 1, zoom = null }) {
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

  const carrier = useRef();
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

    // a queued jump fires on this frame's ground truth
    if (jumpRef?.current) {
      jumpRef.current = false;
      walker.jump();
    }

    // stick/keys are camera-relative: up on the stick walks away from the lens
    const fwd = _fwd.current.set(-Math.sin(c.theta), 0, -Math.cos(c.theta));
    const inp = inputRef.current;
    const wx = fwd.x * inp.y - fwd.z * inp.x;
    const wz = fwd.z * inp.y + fwd.x * inp.x;

    walker.update(dt, wx, wz);
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
    window.__walk = {
      x: w.pos.x, y: w.pos.y, z: w.pos.z, speed: w.speed, grade: w.grade, air: w.air, vy: w.vy,
      camX: camera.position.x, camY: camera.position.y, camZ: camera.position.z,
    };
  });

  const fit = STATURE / Math.max(1e-6, built.fitSize.y);

  return (
    <>
      <primitive object={terrain.group} />
      {/* the gait writes offsets into the creature root's own position, so
          the stature scale lives on a wrapper — scaling the root itself would
          leave those offsets unscaled */}
      <group ref={carrier}>
        <group scale={[fit, fit, fit]}>
          <primitive object={built.group} />
        </group>
      </group>
    </>
  );
}

export default function WorldStage({ params, inputRef, camRef, jumpRef, sens = 1, zoom = null }) {
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
      <WalkScene params={params} inputRef={inputRef} camRef={camRef} jumpRef={jumpRef} sens={sens} zoom={zoom} />
    </Canvas>
  );
}
