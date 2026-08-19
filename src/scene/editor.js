import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { PARAM_BY_KEY, PLACED_MAX, SCULPT_MAX } from '../creature/schema.js';

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
export function Editor({ enabled, builtRef, paramsRef, onParam, onPlaced, onSculpt, placeKind = null, placeRef = null, onNote }) {
  const { gl, camera, controls } = useThree();
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const hover = useRef(null);
  const drag = useRef(null);
  const cache = useRef(new Map());

  // What the next click plants is read from App's ref at event time, never
  // from props: props into the Canvas go through react-three-fiber's own
  // scheduler and can lag a frame — long enough for a click right after a
  // style pick to plant the PREVIOUS style.
  const armedNow = () => placeRef?.current ?? { kind: placeKind, style: null };

  // Rebuilding on every pixel of a drag is what made EDIT mode stutter: a
  // full rebuild runs 100-300ms and pointermove fires far faster than that.
  // Changes are accumulated and flushed on a timer instead — the last value
  // wins — so a drag rebuilds at most ~8 times a second and the final value
  // always lands.
  const queue = useRef({ params: new Map(), placed: null, sculpt: null, timer: 0 });
  const flush = useRef(() => {});
  useEffect(() => {
    flush.current = () => {
      const q = queue.current;
      clearTimeout(q.timer);
      q.timer = 0;
      for (const [k, v] of q.params) onParam(k, v);
      q.params.clear();
      if (q.placed) { onPlaced?.(q.placed); q.placed = null; }
      if (q.sculpt) { onSculpt?.(q.sculpt); q.sculpt = null; }
    };
  }, [onParam, onPlaced, onSculpt]);
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

    const placedEntry = (kind, local, s = 1, t = null) => {
      const base = kind === 'eye' || kind === 'nose'
        ? { k: kind, x: local.x, y: local.y, z: 0, s }
        : { k: kind, ...(() => { const d = local.clone().normalize(); return { x: d.x, y: d.y, z: d.z }; })(), s };
      if (t) base.t = t;
      return base;
    };

    /** A world point in the canvas's client pixels. */
    const toClient = (v) => {
      const rect = dom.getBoundingClientRect();
      const pr = v.clone().project(camera);
      return {
        x: rect.left + ((pr.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - pr.y) / 2) * rect.height,
      };
    };

    /**
     * A planted arm roots on the trunk, and the trunk is thin on screen — a
     * raycast the pointer has to keep hitting would drop the arm the moment
     * the cursor slid onto the arm itself. So the torso's screen box is taken
     * once, at grab time, and the drag lives in it: pointer height inside the
     * box is how high the arm roots, which half it is in is the side.
     */
    const torsoFrame = () => {
      const rig = builtRef.current?.rig;
      if (!rig?.torso) return null;
      const box = new THREE.Box3().setFromObject(rig.torso);
      const c = box.getCenter(new THREE.Vector3());
      const lo = toClient(new THREE.Vector3(c.x, box.min.y, c.z));
      const hi = toClient(new THREE.Vector3(c.x, box.max.y, c.z));
      const w = toClient(new THREE.Vector3(c.x + 0.35, c.y, c.z));
      return {
        topY: hi.y,
        botY: lo.y,
        centerX: lo.x,
        // which side of the screen is the creature's +x half right now
        rightIsPlus: w.x >= lo.x,
        spanX: Math.abs(w.x - lo.x) * 3,
      };
    };

    const armEntryAt = (e, tf, s = 1, t = null) => {
      const fy = THREE.MathUtils.clamp((tf.botY - e.clientY) / Math.max(1, tf.botY - tf.topY), 0, 1);
      const onRight = e.clientX >= tf.centerX;
      const side = tf.rightIsPlus === onRight ? 1 : -1;
      const entry = { k: 'arm', x: side, y: fy, z: 0, s };
      if (t) entry.t = t;
      return entry;
    };

    // ------------------------------------------------------------- sculpt ---
    // A dab is a gaussian pressed into the skin. BUMP swells, DENT hollows,
    // SMOOTH removes the nearest dab. A drag is a stroke of dabs.
    const SCULPT_A = { bump: 0.16, dent: -0.14, smooth: 0 };

    const sculptTarget = (e) => {
      const rig = builtRef.current?.rig;
      if (!rig) return null;
      castFrom(e);
      const hh = rig.headMesh ? ray.intersectObject(rig.headMesh, false)[0] : null;
      const th = rig.torso ? ray.intersectObject(rig.torso, false)[0] : null;
      const h = hh && th ? (hh.distance <= th.distance ? hh : th) : hh || th;
      if (!h) return null;
      return {
        part: th && h === th ? 'body' : 'head',
        dir: h.object.worldToLocal(h.point.clone()).normalize(),
      };
    };

    const dabAt = (e, kind) => {
      const t = sculptTarget(e);
      if (!t) return false;
      const list = (paramsRef.current.sculpt || []).slice();
      if (kind === 'smooth') {
        let best = -1;
        let bestDot = 0.5;
        list.forEach((s, i) => {
          if (s.part !== t.part) return;
          const d = s.x * t.dir.x + s.y * t.dir.y + s.z * t.dir.z;
          if (d > bestDot) { bestDot = d; best = i; }
        });
        if (best < 0) return false;
        list.splice(best, 1);
      } else {
        const a = SCULPT_A[kind];
        // a dab close to an existing same-sign dab deepens it instead of
        // stacking a new entry, so a stroke stays inside the cap
        const near = list.findIndex((s) => s.part === t.part
          && Math.sign(s.a) === Math.sign(a)
          && (s.x * t.dir.x + s.y * t.dir.y + s.z * t.dir.z) > 0.965);
        if (near >= 0) {
          const s = list[near];
          list[near] = { ...s, a: Math.min(0.6, Math.max(-0.5, s.a + a * 0.5)) };
        } else {
          if (list.length >= SCULPT_MAX) { onNote?.('sculpt is full — SMOOTH some of it away'); return false; }
          list.push({ part: t.part, x: t.dir.x, y: t.dir.y, z: t.dir.z, r: 0.45, a });
        }
      }
      queue.current.sculpt = list;
      arm();
      return true;
    };

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
      if (d.sculptKind) {
        // a stroke: another dab each time the pointer has travelled a bit
        if (Math.hypot(e.clientX - d.lx, e.clientY - d.ly) > 26) {
          d.lx = e.clientX;
          d.ly = e.clientY;
          dabAt(e, d.sculptKind);
        }
        return;
      }
      if (d.placedIndex !== undefined) {
        const list = (paramsRef.current.placed || []).slice();
        const prev = list[d.placedIndex];
        if (!prev) return;
        if (d.kind === 'arm') {
          // the drag lives in the torso's screen box (see torsoFrame); far
          // outside it means the arm is being pulled off
          const tf = d.torso;
          if (!tf) return;
          const far = Math.abs(e.clientX - tf.centerX) > tf.spanX
            || e.clientY > tf.botY + (tf.botY - tf.topY) * 0.6
            || e.clientY < tf.topY - (tf.botY - tf.topY) * 0.6;
          d.offSkull = far;
          if (far) { dom.style.cursor = 'not-allowed'; return; }
          dom.style.cursor = 'grabbing';
          list[d.placedIndex] = armEntryAt(e, tf, prev.s, prev.t || null);
          pushPlaced(list);
          return;
        }
        // a placed part follows the pointer across the skull; off the skull it
        // is marked for removal and dropped if the pointer lets go out there
        const local = skullPoint(e);
        d.offSkull = !local;
        if (!local) { dom.style.cursor = 'not-allowed'; return; }
        dom.style.cursor = 'grabbing';
        list[d.placedIndex] = placedEntry(d.kind, local, prev.s, prev.t || null);
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

      const aim = armedNow();

      // an armed sculpt tool dabs whatever skin the click lands on — the
      // raycast goes to the skull and the trunk themselves, so a dab lands
      // under a part rather than on it
      if (SCULPT_A[aim.kind] !== undefined) {
        if (!dabAt(e, aim.kind)) return;   // missed the skin — orbit keeps it
        e.stopPropagation();
        e.preventDefault();
        startDrag(e, { sculptKind: aim.kind, lx: e.clientX, ly: e.clientY });
        return;
      }

      const found = pick(e);

      // a part kind is armed: a click on the skull (or the trunk, for an arm)
      // plants it there. A click on an existing placed part still grabs it.
      if (aim.kind && found?.part !== 'placed') {
        let entry = null;
        if (aim.kind === 'arm') {
          castFrom(e);
          const rig = builtRef.current?.rig;
          const onTorso = rig?.torso && ray.intersectObject(rig.torso, false).length > 0;
          const tf = onTorso && torsoFrame();
          if (tf) entry = armEntryAt(e, tf, 1, aim.style);
        } else {
          const local = skullPoint(e);
          if (local) entry = placedEntry(aim.kind, local, 1, aim.style);
        }
        if (!entry) return;   // missed the body part it roots on — orbit keeps the drag
        e.stopPropagation();
        e.preventDefault();
        const list = (paramsRef.current.placed || []).slice(0, PLACED_MAX - 1);
        list.push(entry);
        queue.current.placed = list;
        flush.current();
        onNote?.(`${aim.kind} planted — drag it to move, wheel to resize`);
        return;
      }

      if (!found) return;   // empty space: the orbit keeps the event
      e.stopPropagation();  // ...but a grabbed part is not a camera drag
      e.preventDefault();
      if (found.part === 'placed') {
        const idx = found.root.userData.placedIndex;
        const kind = (paramsRef.current.placed || [])[idx]?.k;
        startDrag(e, {
          placedIndex: idx,
          kind,
          torso: kind === 'arm' ? torsoFrame() : null,
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
  }, [enabled, placeKind, gl, camera, controls, ray, builtRef, paramsRef, placeRef, onNote]);

  return null;
}
