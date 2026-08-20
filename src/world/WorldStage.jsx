import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { buildCreature } from '../creature/build.js';
import { PixelScale, Controls } from '../scene/Stage.jsx';
import { buildTerrain, groundHeight } from './terrain.js';
import { createWalker, TUNE } from './walker.js';
import { createGait } from './gait.js';

// The walk-test micro-world: the current freak dropped onto the terrain of
// terrain.js, driven by walker.js, animated by gait.js. The camera is the
// same orbit as the pedestal, except its target rides on the creature — so
// spin and zoom still belong to the player while the world scrolls past.

// every freak walks the world at the same stature, whatever the sliders say —
// the WORLD is tuned in these units
const STATURE = 2.2;

function WalkScene({ params, inputRef, camRef, jumpRef }) {
  const { camera, controls } = useThree();

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
  const _fwd = useRef(new THREE.Vector3());
  const _tgt = useRef(new THREE.Vector3());

  // Desktop mouse-look: the pointer is CAPTURED (pointer lock) and the camera
  // follows the bare mouse — no button held. Entering the world was itself a
  // click, so the grab is attempted immediately; if the browser refuses, the
  // next click on the scene grabs it, and ESC always gives the cursor back.
  // Raw movement deltas pile up here and are spent once per frame.
  const look = useRef({ dx: 0, dy: 0 });
  const { gl } = useThree();
  useEffect(() => {
    if (typeof matchMedia === 'function' && !matchMedia('(pointer: fine)').matches) return undefined;
    const dom = gl.domElement;
    const tryLock = () => {
      if (document.pointerLockElement !== dom) {
        // some browsers return a promise that rejects without a gesture —
        // that is fine, the click fallback stays armed
        try { dom.requestPointerLock()?.catch?.(() => {}); } catch { /* fine */ }
      }
    };
    const move = (e) => {
      if (document.pointerLockElement !== dom) return;
      look.current.dx += e.movementX;
      look.current.dy += e.movementY;
    };
    // the browser drops the lock on ESC by itself; doing it by hand as well
    // costs nothing and covers embedders where the native exit is flaky
    const esc = (e) => {
      if (e.key === 'Escape' && document.pointerLockElement === dom) document.exitPointerLock();
    };
    tryLock();
    dom.addEventListener('click', tryLock);
    document.addEventListener('mousemove', move);
    document.addEventListener('keydown', esc);
    return () => {
      dom.removeEventListener('click', tryLock);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('keydown', esc);
      if (document.pointerLockElement === dom) document.exitPointerLock();
    };
  }, [gl]);

  useFrame((state, dt) => {
    if (!carrier.current || !controls) return;
    const w = walker.state;

    // first frame: park the camera behind the creature, facing the hill
    if (!aimed.current) {
      aimed.current = true;
      controls.target.set(w.pos.x, w.pos.y + STATURE * 0.7, w.pos.z);
      camera.position.set(w.pos.x, w.pos.y + STATURE * 1.6, w.pos.z + STATURE * 3.4);
      camera.near = 0.1;
      camera.far = 300;
      camera.updateProjectionMatrix();
      controls.update();
    }

    // the right stick and the captured mouse swing the camera around the
    // creature the same way: sideways orbits, up and down raises the eye,
    // clamped just above the ground plane. Mouse up looks UP (the camera
    // drops), like every shooter since forever.
    const ci = camRef?.current;
    const lk = look.current;
    const dTheta = (ci?.x ?? 0) * 2.4 * dt + lk.dx * 0.0032;
    const dPhi = -(ci?.y ?? 0) * 1.6 * dt - lk.dy * 0.0024;
    lk.dx = 0;
    lk.dy = 0;
    if (dTheta || dPhi) {
      const off = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.theta -= dTheta;
      sph.phi = THREE.MathUtils.clamp(sph.phi + dPhi, 0.3, Math.PI / 2 - 0.06);
      off.setFromSpherical(sph);
      camera.position.copy(controls.target).add(off);
    }

    // a queued jump fires on this frame's ground truth
    if (jumpRef?.current) {
      jumpRef.current = false;
      walker.jump();
    }

    // stick/keys are camera-relative: up on the stick is away from the lens
    const fwd = _fwd.current.copy(controls.target).sub(camera.position);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const inp = inputRef.current;
    const wx = fwd.x * inp.y - fwd.z * inp.x;
    const wz = fwd.z * inp.y + fwd.x * inp.x;

    walker.update(dt, wx, wz);
    gait.update(built.rig, dt, w, TUNE.speed);

    carrier.current.position.copy(w.pos);
    carrier.current.rotation.y = w.yaw;

    // the camera's target rides the creature; the camera keeps its own offset
    const tgt = _tgt.current.set(w.pos.x, w.pos.y + STATURE * 0.7, w.pos.z);
    camera.position.add(tgt.clone().sub(controls.target));
    controls.target.copy(tgt);

    // the orbit sphere knows nothing about the hill: when the trailing camera
    // would sink into a slope, it rides the ground instead
    const camFloor = groundHeight(camera.position.x, camera.position.z) + 0.7;
    if (camera.position.y < camFloor) camera.position.y = camFloor;

    // the tests read the walk from here — cheaper than teaching them to parse
    // a pixelated screenshot
    window.__walk = { x: w.pos.x, y: w.pos.y, z: w.pos.z, speed: w.speed, grade: w.grade, air: w.air, vy: w.vy };
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
      <Controls minDistance={2.2} maxDistance={26} maxPolar={Math.PI / 2 - 0.06} />
      <WalkScene params={params} inputRef={inputRef} camRef={camRef} jumpRef={jumpRef} />
    </Canvas>
  );
}
