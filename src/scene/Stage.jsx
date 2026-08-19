import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildCreature } from '../creature/build.js';
import { createAnimator } from './animator.js';
import { Editor } from './editor.js';

/**
 * Point the camera at the creature. `stock` ignores whatever direction the
 * player has dragged the view to and uses the front-on framing the app opens
 * with; otherwise the current direction is kept so a slider drag does not
 * steal the rotation.
 */
function aimAt(camera, controls, built, stock) {
  const h = built.fitSize.y;
  const target = new THREE.Vector3(0, built.fitCenter.y, 0);
  const span = Math.max(h, built.fitSize.x * 1.15, built.fitSize.z * 1.15);
  const dist = (span * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 1.45;

  const dir = stock
    ? new THREE.Vector3(0, 0.12, 1).normalize()
    : camera.position.clone().sub(controls?.target ?? new THREE.Vector3()).normalize();
  if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.1) dir.set(0, 0.12, 1).normalize();
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.near = dist * 0.02;
  camera.far = dist * 12;
  camera.updateProjectionMatrix();
  if (controls) {
    controls.target.copy(target);
    controls.update();
  }
}

function Creature({ params, onBuilt, idle, poke, onMood, sound, viewReset }) {
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

    aimAt(camera, controls, built, false);
  }, [built, camera, controls, onBuilt]);

  // RESET returns the VIEW to standard as well as the sliders: whatever the
  // player zoomed and spun, the camera goes back to the stock framing. The
  // counter only ever increments, so the same button works twice in a row.
  const lastReset = useRef(viewReset);
  useEffect(() => {
    if (viewReset === lastReset.current) return;
    lastReset.current = viewReset;
    if (!controls) return;
    aimAt(camera, controls, built, true);
    lastFit.current = built.fitSize.y;
  }, [viewReset, built, camera, controls]);

  // The animator lives outside the built creature: buildCreature() throws the
  // whole mesh away on every slider move, and the pose must not restart with it.
  const animator = useMemo(() => createAnimator(), []);
  const pointer = useThree((s) => s.pointer);
  const dom = useThree((s) => s.gl.domElement);
  const hovering = useRef(false);
  const wasIdle = useRef(idle);
  const azimuth = useRef(null);
  const mood = useRef(null);

  useEffect(() => {
    poke.current = () => {
      animator.poke();
      sound?.cue('poke', animator.drives.anger);
    };
  }, [animator, poke, sound]);

  // The voice is derived from the stats, so it is rerolled with the creature.
  // A new seed means a new freak, and a new freak announces itself — but a
  // slider drag rebuilds the mesh too, and that must stay silent.
  const bornSeed = useRef(null);
  useEffect(() => {
    sound?.setVoice(built.stats, built.params.seed);
    const first = bornSeed.current === null;
    if (bornSeed.current !== built.params.seed) {
      bornSeed.current = built.params.seed;
      if (!first) sound?.cue('spawn');
    }
  }, [built, sound]);

  useEffect(() => {
    const enter = () => { hovering.current = true; };
    const leave = () => { hovering.current = false; };
    dom.addEventListener('pointerenter', enter);
    dom.addEventListener('pointerleave', leave);
    return () => {
      dom.removeEventListener('pointerenter', enter);
      dom.removeEventListener('pointerleave', leave);
    };
  }, [dom]);

  useFrame((state, dt) => {
    if (!idle) {
      // snap back to the built pose once, then stay out of the way
      if (wasIdle.current) {
        animator.rest(built.rig);
        mood.current = null;
        onMood?.(null);
      }
      wasIdle.current = false;
      return;
    }
    wasIdle.current = true;

    // How fast the player is swinging the camera around it, in radians per
    // second: a slow look is nothing, a hard spin is something rushing past.
    const p = state.camera.position;
    const a = Math.atan2(p.x, p.z);
    let spin = 0;
    if (azimuth.current !== null && dt > 0) {
      let d = a - azimuth.current;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      spin = Math.abs(d) / dt;
    }
    azimuth.current = a;

    animator.update(built.rig, built.stats, dt, {
      pointer: { x: pointer.x, y: pointer.y },
      active: hovering.current,
      spin,
    });

    if (animator.mood !== mood.current) {
      mood.current = animator.mood;
      onMood?.(animator.moodLabel);
    }

    // Every creature noise: an arm swinging, the head whipping round, a jump,
    // a landing, a blink, the jaw. Nothing runs on a clock of its own and
    // nothing answers a motion you cannot see — and with idle motion paused
    // there are no events at all, so IDLE really is a mute.
    sound?.setMood(animator.mood);
    sound?.play(animator.events);
  });

  return <primitive object={built.group} />;
}

// Below this buffer width the pixels turn to mush: on a phone 412 CSS pixels
// divided by 4 would render the creature into just 103 pixels.
const MIN_BUFFER_WIDTH = 190;

export function PixelScale({ pixelSize, pixelate }) {
  const width = useThree((s) => s.size.width);
  const setDpr = useThree((s) => s.setDpr);

  useEffect(() => {
    if (!pixelate) {
      // Smooth mode. The context was created with `antialias: false` and that
      // cannot be changed without throwing the context away, so the edges are
      // smoothed the other way: render ABOVE the display's own resolution and
      // let the compositor scale it back down. Supersampling, and free here —
      // the whole creature is a few thousand triangles.
      const device = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
      setDpr(Math.min(2.5, Math.max(1.5, device * 1.5)));
      return;
    }
    setDpr(Math.min(1, Math.max(1 / pixelSize, MIN_BUFFER_WIDTH / Math.max(1, width))));
  }, [pixelSize, pixelate, width, setDpr]);

  return null;
}

export function Controls({ minDistance = 0, maxDistance = Infinity, maxPolar = Math.PI - 0.25 }) {
  const { camera, gl, set } = useThree();
  const ref = useRef();

  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enablePan = false;
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.rotateSpeed = 0.85;
    c.minPolarAngle = 0.25;
    c.maxPolarAngle = maxPolar;
    c.minDistance = minDistance;
    c.maxDistance = maxDistance;
    ref.current = c;
    set({ controls: c });
    return () => {
      c.dispose();
      set({ controls: null });
    };
  }, [camera, gl, set, minDistance, maxDistance, maxPolar]);

  useFrame(() => ref.current?.update());
  return null;
}

export default function Stage({
  params, onBuilt, idle = true, onMood, sound, viewReset = 0,
  edit = false, editParams = null, onParam = null, onPlaced = null, onSculpt = null,
  onSelect = null, placeKind = null, placeRef = null, onNote = null,
}) {
  const pixelate = params.pixelate !== 'off';
  const poke = useRef(() => {});
  const down = useRef({ x: 0, y: 0 });
  // the editor raycasts against whatever build is current; a ref, because a
  // slider drag replaces the build several times a second
  const builtRef = useRef(null);
  const paramsRef = useRef(editParams ?? params);
  paramsRef.current = editParams ?? params;

  // A click pokes the creature, a drag orbits the camera — tell them apart by
  // how far the pointer travelled.
  const onDown = (e) => { down.current = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    if (edit) return;   // in EDIT mode a tap is a grab, not a poke
    if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) < 5) poke.current();
  };

  const handleBuilt = (b) => {
    builtRef.current = b;
    onBuilt?.(b);
  };

  return (
    <Canvas
      className={pixelate ? 'stage pixelated' : 'stage'}
      dpr={pixelate ? 1 / params.pixelSize : 1.5}
      gl={{ antialias: false, alpha: false, preserveDrawingBuffer: true }}
      camera={{ fov: 34, position: [0, 1.5, 6] }}
      onPointerDown={onDown}
      onPointerUp={onUp}
    >
      <color attach="background" args={[params.bgColor]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#8fa6c4', '#241a2b', 1.1]} />
      <directionalLight position={[3, 5, 6]} intensity={2.6} />
      <directionalLight position={[-5, 2, -3]} intensity={0.9} color="#7f6bb0" />
      <PixelScale pixelSize={params.pixelSize} pixelate={pixelate} />
      <Controls />
      {/* the creature holds still while it is being operated on */}
      <Creature params={params} onBuilt={handleBuilt} idle={idle && !edit} poke={poke} onMood={onMood} sound={sound} viewReset={viewReset} />
      {onParam && (
        <Editor
          enabled={edit}
          quick={!edit}
          builtRef={builtRef}
          paramsRef={paramsRef}
          onParam={onParam}
          onPlaced={onPlaced}
          onSculpt={onSculpt}
          onSelect={onSelect}
          placeKind={placeKind}
          placeRef={placeRef}
          onNote={onNote}
        />
      )}
    </Canvas>
  );
}
