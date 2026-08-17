import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildCreature } from '../creature/build.js';

function Creature({ params, onBuilt }) {
  const { camera, controls } = useThree();
  const lastFit = useRef(0);
  const fitted = useRef(false);

  const built = useMemo(() => buildCreature(params), [params]);

  useEffect(() => () => built.dispose(), [built]);

  useEffect(() => {
    onBuilt?.(built);
    // Wait for OrbitControls: without them controls.target stays at zero and
    // drags the camera back on the very next frame.
    if (!controls) return;
    const h = built.fitSize.y;
    // Re-aim the camera only when the character noticeably changed height,
    // otherwise every slider move would reset the user's rotation.
    const changed = Math.abs(h - lastFit.current) / (lastFit.current || 1) > 0.12;
    if (fitted.current && !changed) return;
    fitted.current = true;
    lastFit.current = h;

    const target = new THREE.Vector3(0, built.fitCenter.y, 0);
    const span = Math.max(h, built.fitSize.x * 1.15, built.fitSize.z * 1.15);
    const dist = (span * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 1.45;

    const dir = camera.position.clone().sub(controls?.target ?? new THREE.Vector3()).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.1) dir.set(0, 0.12, 1).normalize();
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.near = dist * 0.02;
    camera.far = dist * 12;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
  }, [built, camera, controls, onBuilt]);

  return <primitive object={built.group} />;
}

// Below this buffer width the pixels turn to mush: on a phone 412 CSS pixels
// divided by 4 would render the creature into just 103 pixels.
const MIN_BUFFER_WIDTH = 190;

function PixelScale({ pixelSize }) {
  const width = useThree((s) => s.size.width);
  const setDpr = useThree((s) => s.setDpr);

  useEffect(() => {
    const dpr = Math.min(1, Math.max(1 / pixelSize, MIN_BUFFER_WIDTH / Math.max(1, width)));
    setDpr(dpr);
  }, [pixelSize, width, setDpr]);

  return null;
}

function Controls() {
  const { camera, gl, set } = useThree();
  const ref = useRef();

  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enablePan = false;
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.rotateSpeed = 0.85;
    c.minPolarAngle = 0.25;
    c.maxPolarAngle = Math.PI - 0.25;
    ref.current = c;
    set({ controls: c });
    return () => {
      c.dispose();
      set({ controls: null });
    };
  }, [camera, gl, set]);

  useFrame(() => ref.current?.update());
  return null;
}

export default function Stage({ params, onBuilt }) {
  return (
    <Canvas
      className="stage"
      dpr={1 / params.pixelSize}
      gl={{ antialias: false, alpha: false, preserveDrawingBuffer: true }}
      camera={{ fov: 34, position: [0, 1.5, 6] }}
    >
      <color attach="background" args={[params.bgColor]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#8fa6c4', '#241a2b', 1.1]} />
      <directionalLight position={[3, 5, 6]} intensity={2.6} />
      <directionalLight position={[-5, 2, -3]} intensity={0.9} color="#7f6bb0" />
      <PixelScale pixelSize={params.pixelSize} />
      <Controls />
      <Creature params={params} onBuilt={onBuilt} />
    </Canvas>
  );
}
