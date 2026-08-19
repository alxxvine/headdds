import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { PARAM_BY_KEY } from '../creature/schema.js';

// EDIT mode: grab the creature instead of the sliders. Every mesh in the
// build carries a `userData.part` tag; the raycast walks up from whatever it
// hit to the nearest tag, and the drag is translated into the parameters that
// part answers to. The editor never touches geometry — it drives the same
// schema the panel does, so links, favourites and RANDOM stay untouched.
//
// Sign conventions: dragging AWAY from the midline widens (whichever way the
// camera faces — the outward direction is projected to the screen first), and
// dragging UP raises. The wheel resizes whatever is under the cursor.

// what each part answers to: x/y are drag axes, wheel is the scroll.
// y mode 'up' = dragging up increases; 'down' = dragging down increases.
// x is always 'side': dragging away from the midline increases.
const MAP = {
  skull: { x: 'headWidth', y: ['headHeight', 'up'], wheel: 'headDepth' },
  torso: { x: 'BAND', y: ['belly', 'down'], wheel: 'bodyWidth' },
  eye: { x: 'eyeSpread', y: ['eyeY', 'up'], wheel: 'eyeSize' },
  mouth: { x: 'mouthWidth', y: ['mouthY', 'up'], wheel: 'mouthOpen' },
  tooth: { y: ['toothSize', 'down'], wheel: 'toothSize' },
  nose: { y: ['noseY', 'up'], wheel: 'noseSize' },
  ear: { y: ['earY', 'up'], wheel: 'earSize' },
  horn: { y: ['hornLen', 'up'], wheel: 'horns' },
  hair: { y: ['tendrilLen', 'up'], wheel: 'tendrils' },
  wart: { y: ['wartSize', 'up'], wheel: 'warts' },
  arm: { y: ['armLen', 'down'], wheel: 'limbThick' },
  leg: { x: 'stance', y: ['legLen', 'down'], wheel: 'limbThick' },
  aura: { y: ['auraSize', 'up'], wheel: 'spores' },
};

const clampTo = (def, v) => Math.min(def.max, Math.max(def.min, v));

/** hit object -> the nearest tagged ancestor, or null. */
function resolvePart(object) {
  let o = object;
  while (o) {
    if (o.userData?.part) return { root: o, part: o.userData.part };
    o = o.parent;
  }
  return null;
}

/**
 * Which of the three torso bands the grab landed in, by height within the
 * torso mesh itself.
 */
function torsoBand(rig, hitY) {
  const box = new THREE.Box3().setFromObject(rig.torso);
  const f = (hitY - box.min.y) / Math.max(1e-6, box.max.y - box.min.y);
  return f > 0.62 ? 'chestWide' : f < 0.35 ? 'hipWide' : 'waistWide';
}

/**
 * +1 when dragging right on the SCREEN moves the grabbed point away from the
 * creature's midline, -1 when it is the left that does. Depends on where the
 * camera is, so it is worked out by projecting the outward direction.
 */
function sideSign(camera, hitPoint) {
  const side = hitPoint.x >= 0 ? 1 : -1;
  const a = hitPoint.clone().project(camera);
  const b = hitPoint.clone().add(new THREE.Vector3(side * 0.1, 0, 0)).project(camera);
  return b.x - a.x >= 0 ? 1 : -1;
}

// highlight = the part's own materials, a shade brighter. Clones are cached
// per source material and thrown away with the build they were cloned from.
function makeHighlight(mat) {
  const hl = mat.clone();
  if (hl.emissive) hl.emissive.setHex(0x1f6b3a);
  else if (hl.color) hl.color.lerp(new THREE.Color('#ffffff'), 0.22);
  return hl;
}

function setHighlight(root, cache, on) {
  root.traverse((o) => {
    if (!o.isMesh || o.material?.side === THREE.BackSide) return;
    if (on) {
      if (!cache.has(o.material)) cache.set(o.material, makeHighlight(o.material));
      o.userData._mat = o.material;
      o.material = cache.get(o.material);
    } else if (o.userData._mat) {
      o.material = o.userData._mat;
      delete o.userData._mat;
    }
  });
}

/**
 * Lives inside the Canvas. `builtRef` always points at the current build,
 * `paramsRef` at the panel's live (undeferred) parameters, and every change
 * goes out through `onParam` — the same road the sliders take.
 */
export function Editor({ enabled, builtRef, paramsRef, onParam }) {
  const { gl, camera, controls } = useThree();
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const hover = useRef(null);
  const drag = useRef(null);
  const cache = useRef(new Map());

  // a rebuild swaps every mesh and material: the old highlight clones can only
  // leak, and the old hover points into a disposed graph
  const seen = useRef(null);
  useEffect(() => {
    const id = setInterval(() => {
      const b = builtRef.current;
      if (b === seen.current) return;
      seen.current = b;
      hover.current = null;
      cache.current.forEach((m) => m.dispose());
      cache.current.clear();
    }, 200);
    return () => clearInterval(id);
  }, [builtRef]);

  useEffect(() => {
    if (!enabled) return undefined;
    const dom = gl.domElement;
    const holder = dom.parentElement ?? dom;

    const pick = (e) => {
      const built = builtRef.current;
      if (!built) return null;
      const rect = dom.getBoundingClientRect();
      ray.setFromCamera({
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
      }, camera);
      for (const h of ray.intersectObject(built.group, true)) {
        const found = resolvePart(h.object);
        if (found && MAP[found.part]) return { ...found, hit: h };
      }
      return null;
    };

    const unhover = () => {
      if (hover.current) setHighlight(hover.current.root, cache.current, false);
      hover.current = null;
      dom.style.cursor = '';
    };

    const onMove = (e) => {
      if (drag.current) return;
      const found = pick(e);
      if (found?.root === hover.current?.root) return;
      unhover();
      if (found) {
        hover.current = found;
        setHighlight(found.root, cache.current, true);
        dom.style.cursor = 'grab';
      }
    };

    const applyDrag = (e) => {
      const d = drag.current;
      const h = dom.clientHeight || 600;
      const deltas = { x: e.clientX - d.sx, y: e.clientY - d.sy };
      for (const axis of ['x', 'y']) {
        const m = d.map[axis];
        if (!m) continue;
        const [key, mode] = Array.isArray(m) ? m : [m, 'side'];
        const realKey = key === 'BAND' ? d.band : key;
        const def = PARAM_BY_KEY[realKey];
        if (!def) continue;
        const sign = mode === 'up' ? -1 : mode === 'down' ? 1 : d.side;
        // a drag over 60% of the viewport's height covers the whole range
        let v = d.base[realKey] + sign * deltas[axis] * ((def.max - def.min) / (h * 0.6));
        v = clampTo(def, v);
        if (def.type === 'int') v = Math.round(v);
        onParam(realKey, v);
      }
    };

    const endDrag = () => {
      if (!drag.current) return;
      drag.current = null;
      if (controls) controls.enabled = true;
      dom.style.cursor = hover.current ? 'grab' : '';
      window.removeEventListener('pointermove', applyDrag);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };

    const onDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      // a second finger while a grab is running belongs to nobody: not to a
      // fresh grab (it would overwrite the live one) and not to the orbit
      if (drag.current) { e.stopPropagation(); e.preventDefault(); return; }
      const found = pick(e);
      if (!found) return;   // empty space: the orbit keeps the event
      e.stopPropagation();  // ...but a grabbed part is not a camera drag
      e.preventDefault();
      const p = paramsRef.current;
      const base = {};
      for (const def of Object.values(PARAM_BY_KEY)) base[def.key] = p[def.key];
      drag.current = {
        map: MAP[found.part],
        base,
        sx: e.clientX,
        sy: e.clientY,
        side: sideSign(camera, found.hit.point),
        band: found.part === 'torso' ? torsoBand(builtRef.current.rig, found.hit.point.y) : null,
      };
      if (controls) controls.enabled = false;
      dom.style.cursor = 'grabbing';
      window.addEventListener('pointermove', applyDrag);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    };

    const onWheel = (e) => {
      const found = pick(e);
      if (!found) return;   // empty space: the zoom keeps the wheel
      const key = MAP[found.part].wheel;
      const def = key && PARAM_BY_KEY[key];
      if (!def) return;
      e.stopPropagation();
      e.preventDefault();
      const step = (def.max - def.min) * 0.06 * (e.deltaY < 0 ? 1 : -1);
      const p = paramsRef.current;
      let v = clampTo(def, p[key] + (def.type === 'int' ? Math.sign(step) * Math.max(1, Math.round(Math.abs(step))) : step));
      if (def.type === 'int') v = Math.round(v);
      onParam(key, v);
    };

    // On the canvas's PARENT in the capture phase: OrbitControls and the poke
    // both listen on the canvas itself, and listeners on the target element
    // run in registration order with capture flags ignored — an ancestor is
    // the only place these are guaranteed to see the event first.
    holder.addEventListener('pointerdown', onDown, true);
    holder.addEventListener('pointermove', onMove, true);
    holder.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      holder.removeEventListener('pointerdown', onDown, true);
      holder.removeEventListener('pointermove', onMove, true);
      holder.removeEventListener('wheel', onWheel, { capture: true });
      unhover();
      endDrag();
    };
  }, [enabled, gl, camera, controls, ray, builtRef, paramsRef, onParam]);

  return null;
}
