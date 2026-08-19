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

function WalkScene({ params, inputRef }) {
  const { camera, controls } = useThree();

  const built = useMemo(() => buildCreature(params), [params]);
  useEffect(() => () => built.dispose(), [built]);

  const terrain = useMemo(() => buildTerrain(), []);
  useEffect(() => () => terrain.dispose(), [terrain]);

  // the walker and the gait OUTLIVE the build: dragging a slider mid-walk
  // swaps the puppet, not the position
  const walker = useMemo(() => createWalker(), []);
  const gait = useMemo(() => createGait(), []);

  const carrier = useRef();
  const aimed = useRef(false);
  const _fwd = useRef(new THREE.Vector3());
  const _tgt = useRef(new THREE.Vector3());

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
    window.__walk = { x: w.pos.x, y: w.pos.y, z: w.pos.z, speed: w.speed, grade: w.grade };
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

export default function WorldStage({ params, inputRef }) {
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
      <WalkScene params={params} inputRef={inputRef} />
    </Canvas>
  );
}
