import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { buildCreature } from '../creature/build.js';
import { PixelScale } from '../scene/Stage.jsx';
import { buildTerrain, groundHeight, WORLD } from './terrain.js';
import { createWalker, TUNE } from './walker.js';
import { createGait } from './gait.js';

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
  sens: 0.006,      // captured mouse, radians per pixel sideways
  sensY: 0.0045,    // ...and vertically
  drag: 1.5,        // swipe/drag look, multiplier on top of sens
  stick: 3.0,       // right stick, radians per second sideways
  stickY: 2.0,      // ...and vertically
  minPhi: 0.35,     // how far over the top the eye may go
  maxPhi: Math.PI / 2 - 0.05,
  minDist: 2.2,
  maxDist: 26,
};

function WalkScene({ params, inputRef, camRef, jumpRef }) {
  const { camera, gl } = useThree();

  const built = useMemo(() => buildCreature(params), [params]);
  useEffect(() => () => built.dispose(), [built]);

  const terrain = useMemo(() => buildTerrain(), []);
  useEffect(() => () => terrain.dispose(), [terrain]);

  // the walker and the gait OUTLIVE the build: dragging a slider mid-walk
  // swaps the puppet, not the position
  const walker = useMemo(() => createWalker(terrain.colliders), [terrain]);
  const gait = useMemo(() => createGait(), []);

  const carrier = useRef();
  const aimed = useRef(false);
  // the whole camera is these three numbers
  const cam = useRef({ theta: 0, phi: 1.15, dist: STATURE * 3.6 });
  // raw look input gathered between frames, spent once per frame
  const look = useRef({ dx: 0, dy: 0 });
  const _fwd = useRef(new THREE.Vector3());
  const _tgt = useRef(new THREE.Vector3());
  const _off = useRef(new THREE.Vector3());

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
    document.addEventListener('keydown', esc);
    return () => {
      dom.removeEventListener('click', tryLock);
      dom.removeEventListener('pointerdown', pdown);
      window.removeEventListener('pointermove', pmove);
      window.removeEventListener('pointerup', pup);
      window.removeEventListener('pointercancel', pup);
      dom.removeEventListener('wheel', wheel);
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
    c.theta -= (ci?.x ?? 0) * CAM.stick * dt + lk.dx * CAM.sens;
    c.phi = THREE.MathUtils.clamp(
      c.phi - (ci?.y ?? 0) * CAM.stickY * dt - lk.dy * CAM.sensY,
      CAM.minPhi, CAM.maxPhi);
    lk.dx = 0;
    lk.dy = 0;

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
    gait.update(built.rig, dt, w, TUNE.speed);

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
    let reach = 1 / 8;
    for (let i = 8; i >= 1; i--) {
      const f = i / 8;
      const px = tgt.x + off.x * f;
      const pz = tgt.z + off.z * f;
      const py = tgt.y + off.y * f;
      if (Math.abs(px) < WORLD - 2.5 && Math.abs(pz) < WORLD - 2.5
        && py > groundHeight(px, pz) + 0.5) { reach = f; break; }
    }
    camera.position.copy(tgt).addScaledVector(off, reach);
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

export default function WorldStage({ params, inputRef, camRef, jumpRef }) {
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
      <WalkScene params={params} inputRef={inputRef} camRef={camRef} jumpRef={jumpRef} />
    </Canvas>
  );
}
