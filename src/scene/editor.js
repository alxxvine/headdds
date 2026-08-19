import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { PARAM_BY_KEY, PLACED_MAX } from '../creature/schema.js';

// EDIT mode: grab the creature instead of the sliders. Every mesh in the
// build carries a `userData.part` tag; the raycast walks up from whatever it
// hit to the nearest tag, and the part under it answers directly. The editor
// never touches geometry — it drives the same schema the panel does, so
// links, favourites and RANDOM stay untouched.
//
// On top of the grown parts there are PLACED parts — the ones the player put
// on the skull by hand. Placing: pick a kind from the toolbar, click the
// head. Moving: drag the part across the skull. Resizing: wheel over it.
// Removing: right-click it, or drag it clean off the head and let go.
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
 * goes out through `onParam`/`onPlaced` — the same road the sliders take.
 * `placeKind` armed means the next click on the skull plants that part there.
 */
export function Editor({ enabled, builtRef, paramsRef, onParam, onPlaced, placeKind = null, onNote }) {
  const { gl, camera, controls } = useThree();
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const hover = useRef(null);
  const drag = useRef(null);
  const cache = useRef(new Map());

  // Rebuilding on every pixel of a drag is what made EDIT mode stutter: a
  // full rebuild runs 100-300ms and pointermove fires far faster than that.
  // Changes are accumulated and flushed on a timer instead — the last value
  // wins — so a drag rebuilds at most ~8 times a second and the final value
  // always lands.
  const queue = useRef({ params: new Map(), placed: null, timer: 0 });
  const flush = useRef(() => {});
  useEffect(() => {
    flush.current = () => {
      const q = queue.current;
      clearTimeout(q.timer);
      q.timer = 0;
      for (const [k, v] of q.params) onParam(k, v);
      q.params.clear();
      if (q.placed) { onPlaced?.(q.placed); q.placed = null; }
    };
  }, [onParam, onPlaced]);
  const arm = () => {
    const q = queue.current;
    if (!q.timer) q.timer = setTimeout(() => flush.current(), 120);
  };
  const push = (k, v) => { queue.current.params.set(k, v); arm(); };
  const pushPlaced = (list) => { queue.current.placed = list; arm(); };

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

    const castFrom = (e) => {
      const rect = dom.getBoundingClientRect();
      ray.setFromCamera({
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
      }, camera);
    };

    const pick = (e) => {
      const built = builtRef.current;
      if (!built) return null;
      castFrom(e);
      for (const h of ray.intersectObject(built.group, true)) {
        const found = resolvePart(h.object);
        if (found && (found.part === 'placed' || MAP[found.part])) return { ...found, hit: h };
      }
      return null;
    };

    /** Where the pointer lands on the skull, in the skull's own coordinates. */
    const skullPoint = (e) => {
      const built = builtRef.current;
      if (!built?.rig.headMesh) return null;
      castFrom(e);
      const h = ray.intersectObject(built.rig.headMesh, false)[0];
      if (!h) return null;
      return built.rig.headMesh.worldToLocal(h.point.clone());
    };

    const placedEntry = (kind, local, s = 1) => (kind === 'eye'
      ? { k: 'eye', x: local.x, y: local.y, z: 0, s }
      : { k: kind, ...(() => { const d = local.clone().normalize(); return { x: d.x, y: d.y, z: d.z }; })(), s });

    const unhover = () => {
      if (hover.current) setHighlight(hover.current.root, cache.current, false);
      hover.current = null;
      dom.style.cursor = placeKind ? 'crosshair' : '';
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
      if (!d) return;
      if (d.placedIndex !== undefined) {
        // a placed part follows the pointer across the skull; off the skull it
        // is marked for removal and dropped if the pointer lets go out there
        const local = skullPoint(e);
        d.offSkull = !local;
        if (!local) { dom.style.cursor = 'not-allowed'; return; }
        dom.style.cursor = 'grabbing';
        const list = (paramsRef.current.placed || []).slice();
        if (!list[d.placedIndex]) return;
        list[d.placedIndex] = { ...placedEntry(d.kind, local, list[d.placedIndex].s) };
        pushPlaced(list);
        return;
      }
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
        push(realKey, v);
      }
    };

    const endDrag = () => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      if (d.placedIndex !== undefined && d.offSkull) {
        // let go off the head: the part comes off in your hand
        const list = (paramsRef.current.placed || []).filter((_, i) => i !== d.placedIndex);
        queue.current.placed = list;
        onNote?.('part removed');
      }
      flush.current();   // the final value lands immediately, not on the timer
      if (controls) controls.enabled = true;
      dom.style.cursor = hover.current ? 'grab' : placeKind ? 'crosshair' : '';
      window.removeEventListener('pointermove', applyDrag);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };

    const startDrag = (e, d) => {
      drag.current = d;
      if (controls) controls.enabled = false;
      dom.style.cursor = 'grabbing';
      window.addEventListener('pointermove', applyDrag);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    };

    const onDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      // a second finger while a grab is running belongs to nobody: not to a
      // fresh grab (it would overwrite the live one) and not to the orbit
      if (drag.current) { e.stopPropagation(); e.preventDefault(); return; }

      const found = pick(e);

      // a part kind is armed: a click on the skull plants it there. A click
      // on an existing placed part still grabs that part instead.
      if (placeKind && found?.part !== 'placed') {
        const local = skullPoint(e);
        if (!local) return;   // missed the head — the orbit keeps the drag
        e.stopPropagation();
        e.preventDefault();
        const list = (paramsRef.current.placed || []).slice(0, PLACED_MAX - 1);
        list.push(placedEntry(placeKind, local));
        queue.current.placed = list;
        flush.current();
        onNote?.(`${placeKind} planted — drag it to move, wheel to resize`);
        return;
      }

      if (!found) return;   // empty space: the orbit keeps the event
      e.stopPropagation();  // ...but a grabbed part is not a camera drag
      e.preventDefault();
      if (found.part === 'placed') {
        startDrag(e, {
          placedIndex: found.root.userData.placedIndex,
          kind: (paramsRef.current.placed || [])[found.root.userData.placedIndex]?.k,
          offSkull: false,
        });
        return;
      }
      const p = paramsRef.current;
      const base = {};
      for (const def of Object.values(PARAM_BY_KEY)) base[def.key] = p[def.key];
      startDrag(e, {
        map: MAP[found.part],
        base,
        sx: e.clientX,
        sy: e.clientY,
        side: sideSign(camera, found.hit.point),
        band: found.part === 'torso' ? torsoBand(builtRef.current.rig, found.hit.point.y) : null,
      });
    };

    const onWheel = (e) => {
      const found = pick(e);
      if (!found) return;   // empty space: the zoom keeps the wheel
      e.stopPropagation();
      e.preventDefault();
      if (found.part === 'placed') {
        const i = found.root.userData.placedIndex;
        const list = (paramsRef.current.placed || []).slice();
        if (!list[i]) return;
        const s = Math.min(2.5, Math.max(0.3, list[i].s * (e.deltaY < 0 ? 1.12 : 0.9)));
        list[i] = { ...list[i], s };
        pushPlaced(list);
        return;
      }
      const key = MAP[found.part].wheel;
      const def = key && PARAM_BY_KEY[key];
      if (!def) return;
      const step = (def.max - def.min) * 0.06 * (e.deltaY < 0 ? 1 : -1);
      const p = paramsRef.current;
      let v = clampTo(def, p[key] + (def.type === 'int' ? Math.sign(step) * Math.max(1, Math.round(Math.abs(step))) : step));
      if (def.type === 'int') v = Math.round(v);
      push(key, v);
    };

    // right-click takes a placed part off
    const onMenu = (e) => {
      const found = pick(e);
      if (found?.part !== 'placed') return;
      e.stopPropagation();
      e.preventDefault();
      const i = found.root.userData.placedIndex;
      queue.current.placed = (paramsRef.current.placed || []).filter((_, k) => k !== i);
      flush.current();
      onNote?.('part removed');
    };

    // On the canvas's PARENT in the capture phase: OrbitControls and the poke
    // both listen on the canvas itself, and listeners on the target element
    // run in registration order with capture flags ignored — an ancestor is
    // the only place these are guaranteed to see the event first.
    holder.addEventListener('pointerdown', onDown, true);
    holder.addEventListener('pointermove', onMove, true);
    holder.addEventListener('wheel', onWheel, { capture: true, passive: false });
    holder.addEventListener('contextmenu', onMenu, true);
    dom.style.cursor = placeKind ? 'crosshair' : '';
    return () => {
      holder.removeEventListener('pointerdown', onDown, true);
      holder.removeEventListener('pointermove', onMove, true);
      holder.removeEventListener('wheel', onWheel, { capture: true });
      holder.removeEventListener('contextmenu', onMenu, true);
      unhover();
      endDrag();
      flush.current();
      dom.style.cursor = '';
    };
  }, [enabled, placeKind, gl, camera, controls, ray, builtRef, paramsRef, onNote]);

  return null;
}
