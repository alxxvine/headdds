import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Stage from './scene/Stage.jsx';
import WorldStage from './world/WorldStage.jsx';
import Joystick from './world/Joystick.jsx';
import { createSound } from './scene/sound.js';
import Panel from './ui/Panel.jsx';
import { DEFAULTS, PARAM_BY_KEY, PLACED_TYPES, randomize, randomSeed } from './creature/schema.js';
import { readUrlParams, syncUrl, shareUrl, copyText, prettyJson } from './lib/codec.js';
import { nameOf } from './creature/name.js';
import { loadFavs, addFav, removeFav, favParams, snapThumb } from './lib/favs.js';

// Someone who asked the system for less motion should not be met by a
// twitching freak; they can still switch it on with the IDLE button.
const WANTS_MOTION = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

// which schema select each placeable kind draws its styles from
const TYPE_SOURCE = { eye: 'eyeStyle', arm: 'armType', ear: 'earType', hair: 'hairType', nose: 'noseType' };

// The family remote: tap a GROWN part and get its whole family's dials —
// counts first, so nobody has to plant teeth one by one. Each row is
// [caption, schema key]; steps come from the schema (ints move by 1).
const FAMILY_ROWS = {
  tooth: [['top', 'teethTop'], ['low', 'teethBottom'], ['size', 'toothSize']],
  mouth: [['width', 'mouthWidth'], ['open', 'mouthOpen'], ['shift', 'mouthX'], ['top', 'teethTop'], ['low', 'teethBottom']],
  hair: [['count', 'tendrils'], ['length', 'tendrilLen']],
  wart: [['count', 'warts'], ['size', 'wartSize']],
  horn: [['count', 'horns'], ['length', 'hornLen']],
  eye: [['count', 'eyeCount'], ['size', 'eyeSize'], ['spread', 'eyeSpread'], ['height', 'eyeY']],
  ear: [['size', 'earSize'], ['height', 'earY']],
  nose: [['size', 'noseSize'], ['height', 'noseY']],
  aura: [['count', 'spores'], ['size', 'auraSize']],
  skull: [['width', 'headWidth'], ['height', 'headHeight'], ['depth', 'headDepth'], ['boxy', 'boxiness'], ['jaw', 'jaw']],
  torso: [['width', 'bodyWidth'], ['belly', 'belly'], ['chest', 'chestWide'], ['waist', 'waistWide'], ['hips', 'hipWide']],
  leg: [['length', 'legLen'], ['stance', 'stance'], ['thick', 'limbThick']],
  arm: [['length', 'armLen'], ['lift', 'armLift'], ['uneven', 'asymmetry'], ['thick', 'limbThick']],
};
const FAMILY_LABEL = {
  tooth: 'teeth', mouth: 'maw', hair: 'hair', wart: 'warts', horn: 'horns',
  eye: 'eyes', ear: 'ears', nose: 'nose', aura: 'aura',
  skull: 'skull', torso: 'body', leg: 'legs', arm: 'arms',
};

export default function App() {
  const [params, setParams] = useState(() => readUrlParams() || { ...DEFAULTS });
  const [note, setNote] = useState('');
  const [idle, setIdle] = useState(WANTS_MOTION);
  const [mood, setMood] = useState(null);
  const [sfx, setSfx] = useState(false);
  const [favs, setFavs] = useState(loadFavs);
  const [viewReset, setViewReset] = useState(0);
  const [edit, setEdit] = useState(false);
  const [walk, setWalk] = useState(false);
  // what the walk stick / keys are asking for right now; refs, because the
  // world reads them every frame and touch events fire far faster than React
  const walkInput = useRef({ x: 0, y: 0 });
  const walkCam = useRef({ x: 0, y: 0 });
  const walkJump = useRef(false);
  const walkRun = useRef(false);
  // the stamina bar's DOM, written by the world every frame without React
  const walkHud = useRef({ box: null, fill: null });
  // BOMB TAG: each round number is a fresh game, 0 = off; bombEnd holds the
  // outcome banner ('win' | 'lose')
  const [bombRound, setBombRound] = useState(0);
  const [bombEnd, setBombEnd] = useState(null);
  const bombHud = useRef({ el: null });
  const onBombEnd = useCallback((result) => {
    setBombEnd(result);
    // free the cursor so the banner's buttons are reachable right away
    try { document.exitPointerLock?.(); } catch { /* fine */ }
  }, []);
  const onToggleBomb = useCallback(() => {
    setBombEnd(null);
    setBombRound((n) => (n > 0 ? 0 : n + 1));
  }, []);
  // mouse-look speed multiplier, remembered between visits
  const [walkSens, setWalkSens] = useState(() => {
    const v = parseFloat(typeof localStorage !== 'undefined' ? localStorage.getItem('hd_walkSens') : '');
    return Number.isFinite(v) && v >= 0.3 && v <= 3 ? v : 1;
  });
  useEffect(() => {
    try { localStorage.setItem('hd_walkSens', String(walkSens)); } catch { /* private mode */ }
  }, [walkSens]);
  // camera distance for the phone's zoom slider (the desktop has the wheel)
  const [walkZoom, setWalkZoom] = useState(8);
  const [placeKind, setPlaceKind] = useState(null);
  // which style the next planted part of a kind wears; null = same as the face
  const [placeStyles, setPlaceStyles] = useState({ eye: null, arm: 'stick', ear: null, hair: null, nose: null });
  // which placed part the gizmo is driving; a tap on a part sets it
  const [selected, setSelected] = useState(null);
  // The editor reads this ref at event time. Props into the Canvas go through
  // react-three-fiber's own scheduler and can lag a frame behind the panel —
  // long enough for a click right after a style pick to plant the OLD style.
  const placeRef = useRef({ kind: null, style: null });
  placeRef.current = {
    kind: placeKind,
    style: placeKind === 'eye' ? (placeStyles.eye ?? params.eyeStyle)
      : placeKind === 'arm' ? placeStyles.arm
      : placeKind === 'ear' ? (placeStyles.ear ?? (params.earType !== 'none' ? params.earType : 'flaps'))
      : placeKind === 'hair' ? (placeStyles.hair ?? (params.hairType !== 'none' && params.hairType !== 'crest' ? params.hairType : 'tendrils'))
      : placeKind === 'nose' ? (placeStyles.nose ?? (params.noseType !== 'none' ? params.noseType : 'bump'))
      : null,
  };
  // Off until asked for: a browser will not start an AudioContext without a
  // gesture anyway, and a page that greets you with a roar is one you close.
  const sound = useMemo(() => createSound(), []);
  const noteTimer = useRef(0);

  // The scene gets a deferred value: the slider stays responsive even when
  // rebuilding the mesh takes a couple of frames.
  const scene = useDeferredValue(params);

  const flash = useCallback((text) => {
    setNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(''), 2200);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => syncUrl(params), 400);
    return () => clearTimeout(t);
  }, [params]);

  useEffect(() => {
    if (selected?.placed !== undefined && !(params.placed || [])[selected.placed]) setSelected(null);
  }, [params.placed, selected]);

  // iOS Safari ignores user-scalable=no: a pinch during editing zooms the
  // PAGE, the EDIT button sails off-screen, and there is no way back. While
  // EDIT is on, page zoom is blocked outright (gesturestart is Safari's own
  // pinch event; the touchmove guard covers the rest).
  useEffect(() => {
    if (!edit && !walk) return undefined;
    const block = (e) => e.preventDefault();
    const blockPinch = (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
    document.addEventListener('gesturestart', block, { passive: false });
    document.addEventListener('gesturechange', block, { passive: false });
    document.addEventListener('touchmove', blockPinch, { passive: false });
    const dbl = (e) => e.preventDefault();   // double-tap zoom
    document.addEventListener('dblclick', dbl, { passive: false });
    return () => {
      document.removeEventListener('gesturestart', block);
      document.removeEventListener('gesturechange', block);
      document.removeEventListener('touchmove', blockPinch);
      document.removeEventListener('dblclick', dbl);
    };
  }, [edit, walk]);

  // The desktop's legs: WASD and the arrows steer while the world is up.
  // Matched by PHYSICAL key (e.code), not by the letter — on a Russian layout
  // W reads as 'ц' and matching e.key left the creature standing still.
  useEffect(() => {
    if (!walk) return undefined;
    const held = new Set();
    const apply = () => {
      const y = (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0) - (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0);
      const x = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
      walkInput.current = { x, y };
    };
    const STEER = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    const down = (e) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        walkRun.current = true;
        return;
      }
      // the pointer is usually captured, so the buttons are out of reach:
      // R starts a FRESH round (also mid-game and over the end banner),
      // B shuts the mode down — neither lets the mouse go
      if (e.code === 'KeyR' && !e.repeat) {
        setBombEnd(null);
        setBombRound((n) => n + 1);
        return;
      }
      if (e.code === 'KeyB' && !e.repeat) {
        setBombEnd(null);
        setBombRound((n) => (n > 0 ? 0 : n + 1));
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        walkJump.current = true;
        return;
      }
      if (!STEER.has(e.code)) return;
      e.preventDefault();
      held.add(e.code);
      apply();
    };
    const up = (e) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        walkRun.current = false;
        return;
      }
      held.delete(e.code);
      apply();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      walkInput.current = { x: 0, y: 0 };
      walkRun.current = false;
    };
  }, [walk]);

  const setParam = useCallback((key, value) => {
    // Picking a kind or a colour is a click and gets one; dragging a slider
    // fires on every pixel of travel and would turn the panel into a rattle.
    const type = PARAM_BY_KEY[key]?.type;
    if (type === 'select' || type === 'color') sound.ui('tap');
    setParams((prev) => ({ ...prev, [key]: value }));
  }, [sound]);

  // RANDOM and the seed box get no click of their own: the new creature cries
  // out in its own voice as soon as it is built, and a blip on top of that
  // would only step on it.
  const onRandom = useCallback(() => {
    const seed = randomSeed();
    const next = randomize(seed);
    setParams(next);
    flash(`${nameOf(next)} · #${seed}`);
  }, [flash]);

  const onSeed = useCallback((seed) => setParams(randomize(seed)), []);

  const onReset = useCallback(() => {
    setParams({ ...DEFAULTS });
    // ...and the view goes back to stock with them: a reset that keeps the
    // player's zoom and spin reads as a reset that did not work
    setViewReset((n) => n + 1);
    sound.ui('reset');
    flash('everything back to standard');
  }, [sound, flash]);

  const onCopyJson = useCallback(async () => {
    const ok = await copyText(prettyJson(params));
    sound.ui(ok ? 'ok' : 'nope');
    flash(ok ? 'JSON copied' : 'clipboard access denied');
  }, [params, sound, flash]);

  const onCopyLink = useCallback(async () => {
    const url = shareUrl(params);
    syncUrl(params);
    const ok = await copyText(url);
    sound.ui(ok ? 'ok' : 'nope');
    flash(ok ? 'link copied' : 'link is in the address bar');
  }, [params, sound, flash]);

  const onToggleIdle = useCallback(() => {
    // the click lives out here, not inside the updater: React may call an
    // updater twice, and a doubled blip is the sort of thing you hear
    sound.ui('tap');
    setIdle((v) => {
      flash(v ? 'idle motion off' : 'idle motion on');
      return !v;
    });
  }, [sound, flash]);

  const onSaveFav = useCallback(() => {
    // The thumbnail comes off the live canvas — whatever pose and angle the
    // player is looking at is the one the collection remembers.
    const canvas = document.querySelector('.viewport canvas');
    const next = addFav(favs, params, nameOf(params), snapThumb(canvas));
    if (!next) { flash('already in the collection'); return; }
    setFavs(next);
    sound.ui('ok');
    flash('saved to the collection');
  }, [favs, params, sound, flash]);

  const onPickFav = useCallback((fav) => {
    const p = favParams(fav);
    if (!p) { flash('this one is corrupted'); return; }
    setParams(p);
    flash(`${fav.name} · #${fav.seed}`);
  }, [flash]);

  const onRemoveFav = useCallback((fav) => {
    setFavs((list) => removeFav(list, fav.code));
    sound.ui('tap');
  }, [sound]);

  const lastEditToggle = useRef(0);
  const onToggleEdit = useCallback(() => {
    // iOS fires a late synthetic click after the pointer events; without the
    // guard one tap on EXIT could toggle EDIT twice and land back inside
    const now = performance.now();
    if (now - lastEditToggle.current < 450) return;
    lastEditToggle.current = now;
    sound.ui('tap');
    setPlaceKind(null);
    setSelected(null);
    setEdit((v) => {
      flash(v ? 'edit mode off' : 'EDIT: drag a part to reshape it, wheel to resize');
      return !v;
    });
    // when leaving, shove the phone browser back to reality: unscroll and
    // make every resize observer re-measure the restored layout
    setTimeout(() => {
      window.scrollTo(0, 0);
      window.dispatchEvent(new Event('resize'));
    }, 60);
  }, [sound, flash]);

  const lastWalkToggle = useRef(0);
  const onToggleWalk = useCallback(() => {
    // same iOS late-synthetic-click guard as EDIT: one tap must toggle once
    const now = performance.now();
    if (now - lastWalkToggle.current < 450) return;
    lastWalkToggle.current = now;
    sound.ui('tap');
    setEdit(false);
    setPlaceKind(null);
    setSelected(null);
    setBombRound(0);
    setBombEnd(null);
    setWalk((v) => {
      flash(v ? 'back on the pedestal' : 'WALK: WASD / arrows / the stick — go climb the hill');
      return !v;
    });
    setTimeout(() => {
      window.scrollTo(0, 0);
      window.dispatchEvent(new Event('resize'));
    }, 60);
  }, [sound, flash]);

  // the placement toolbar: arm a kind, then every click on the skull plants one
  const onPickPlace = useCallback((kind) => {
    sound.ui('tap');
    setPlaceKind((cur) => {
      const next = cur === kind ? null : kind;
      if (!next) flash('tool off');
      else if (kind === 'bump' || kind === 'dent') flash(`${next}: click or stroke the head or the trunk`);
      else if (kind === 'smooth') flash('smooth: click a bump or dent to take it back out');
      else flash(`click the ${next === 'arm' ? 'trunk' : 'head'} to plant a ${next} — right-click or drag off to remove`);
      return next;
    });
  }, [sound, flash]);

  const onPlaced = useCallback((list) => {
    setParams((prev) => ({ ...prev, placed: list }));
  }, []);

  // ------------------------------------------------------------- gizmo ---
  // The selected part's remote control: nudge its seat, size it, aim it.
  // Everything below rewrites one entry of `placed` — the same road the
  // editor's drags take, so links and favourites see no difference.
  const editEntry = useCallback((fn) => {
    setParams((prev) => {
      const list = (prev.placed || []).slice();
      const idx = selectedRef.current?.placed;
      if (idx === undefined || !list[idx]) return prev;
      list[idx] = fn({ ...list[idx] });
      return { ...prev, placed: list };
    });
  }, []);
  const selectedRef = useRef(null);
  selectedRef.current = selected;

  const gizmoNudge = useCallback((dx, dy) => {
    editEntry((it) => {
      if (it.k === 'eye' || it.k === 'nose') {
        it.x += dx * 0.05;
        it.y += dy * 0.05;
      } else if (it.k === 'arm') {
        if (dy) it.y = Math.min(1, Math.max(0, it.y + dy * 0.06));
        if (dx) it.x = dx;   // left/right button picks the side
      } else {
        // direction kinds: swing the root direction a step at a time
        const th = 0.1;
        if (dx) {
          const c = Math.cos(dx * th), s = Math.sin(dx * th);
          const nx = it.x * c + it.z * s;
          it.z = -it.x * s + it.z * c;
          it.x = nx;
        }
        if (dy) {
          const h = Math.hypot(it.x, it.z) || 1e-6;
          const ang = Math.min(1.5, Math.max(-1.5, Math.atan2(it.y, h) + dy * th));
          const nh = Math.cos(ang);
          it.y = Math.sin(ang);
          it.x *= nh / h;
          it.z *= nh / h;
        }
      }
      return it;
    });
  }, [editEntry]);

  const gizmoScale = useCallback((dir) => {
    editEntry((it) => {
      it.s = Math.min(2.5, Math.max(0.3, it.s * (dir > 0 ? 1.12 : 0.9)));
      return it;
    });
  }, [editEntry]);

  const gizmoTilt = useCallback((axis, dir) => {
    editEntry((it) => {
      it[axis] = Math.min(1.3, Math.max(-1.3, (it[axis] || 0) + dir * 0.12));
      return it;
    });
  }, [editEntry]);

  const gizmoRemove = useCallback(() => {
    const idx = selectedRef.current?.placed;
    setSelected(null);
    setParams((prev) => ({ ...prev, placed: (prev.placed || []).filter((_, i) => i !== idx) }));
    flash('part removed');
  }, [flash]);

  // the family remote turns one schema dial a notch at a time
  const familyStep = useCallback((key, dir) => {
    const def = PARAM_BY_KEY[key];
    if (!def) return;
    const step = def.type === 'int' ? 1 : (def.max - def.min) / 12;
    setParams((prev) => {
      let v = Math.min(def.max, Math.max(def.min, (prev[key] ?? def.def) + dir * step));
      if (def.type === 'int') v = Math.round(v);
      return { ...prev, [key]: v };
    });
  }, []);

  // press-and-hold repeats, so a nudge button behaves like a held key
  const hold = useCallback((fn) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      fn();
      const id = setInterval(fn, 130);
      const stop = () => { clearInterval(id); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    },
    onContextMenu: (e) => e.preventDefault(),
  }), []);

  const onSculpt = useCallback((list) => {
    setParams((prev) => ({ ...prev, sculpt: list }));
  }, []);

  // a tile dragged out of the parts catalog and dropped on the creature
  const onDropPart = useCallback((e) => {
    const data = e.dataTransfer?.getData('text/plain') || '';
    const [key, value] = data.split(':');
    if (!key || value === undefined || PARAM_BY_KEY[key]?.type !== 'select') return;
    if (!PARAM_BY_KEY[key].options.some((o) => o.value === value)) return;
    e.preventDefault();
    setParam(key, value);
    flash(`${value} grafted on`);
  }, [setParam, flash]);

  const onToggleSound = useCallback(() => {
    const state = sound.toggle();
    if (state === null) { flash('no audio in this browser'); return; }
    setSfx(state);
    // an iPhone's ring/silent switch mutes web audio outright, and the only
    // symptom is a button that appears to do nothing
    flash(state ? 'sound on — iPhone: check the ring switch' : 'sound off');
  }, [sound, flash]);

  return (
    <div className={edit ? 'app edit-on' : walk ? 'app walk-on' : 'app'}>
      <div className="viewport" onDragOver={(e) => e.preventDefault()} onDrop={onDropPart}>
        {walk ? (
          <WorldStage
            params={scene}
            inputRef={walkInput}
            camRef={walkCam}
            jumpRef={walkJump}
            runRef={walkRun}
            hudRef={walkHud}
            sens={walkSens}
            zoom={walkZoom}
            bombRound={bombRound}
            onBombEnd={onBombEnd}
            bombHudRef={bombHud}
          />
        ) : (
        <Stage
          params={scene}
          idle={idle}
          onMood={setMood}
          sound={sound}
          viewReset={viewReset}
          edit={edit}
          editParams={params}
          onParam={setParam}
          onPlaced={onPlaced}
          onSculpt={onSculpt}
          onSelect={setSelected}
          placeKind={placeKind}
          placeRef={placeRef}
          onNote={flash}
        />
        )}
        {!walk && (
        <button
          type="button"
          className={edit ? 'edit-toggle on' : 'edit-toggle'}
          onClick={onToggleEdit}
          title="grab the creature itself: drag a part to reshape it, wheel over it to resize"
        >
          EDIT
        </button>
        )}
        {!edit && (
          <button
            type="button"
            className={walk ? 'edit-toggle walk-toggle on' : 'edit-toggle walk-toggle'}
            onClick={onToggleWalk}
            title="drop the freak into the micro-world and take it for a walk"
          >
            {walk ? '⏎ EXIT' : 'WALK'}
          </button>
        )}
        {walk && (
          <>
            <div className="walk-hint">WASD · shift — run · space — jump · R — bomb round · B — bomb off · esc — cursor</div>
            <label className="walk-sens" title="mouse look speed (esc frees the cursor to reach this)">
              <span>mouse speed</span>
              <input
                type="range"
                min="0.3"
                max="3"
                step="0.1"
                value={walkSens}
                onChange={(e) => setWalkSens(parseFloat(e.target.value))}
              />
              <span className="walk-sens-val">{walkSens.toFixed(1)}x</span>
            </label>
            <label className="walk-zoom" title="camera distance">
              <span>＋</span>
              <input
                type="range"
                min="2.2"
                max="20"
                step="0.1"
                value={walkZoom}
                onChange={(e) => setWalkZoom(parseFloat(e.target.value))}
              />
              <span>−</span>
            </label>
            <button
              type="button"
              className="edit-toggle bomb-btn"
              onClick={onToggleBomb}
              title="bomb tag: five freaks, one lit bomb, last one standing wins"
            >
              {bombRound > 0 ? '\u2715 BOMB' : '\ud83d\udca3 BOMB'}
            </button>
            {bombRound > 0 && !bombEnd && (
              <div className="bomb-hud" ref={(el) => { bombHud.current.el = el; }} />
            )}
            {bombEnd && (
              <div className="bomb-banner">
                <div className="bomb-title">
                  {bombEnd === 'win' ? 'LAST ONE STANDING' : 'BOOM \u2014 it was in your hands'}
                </div>
                <div className="gz-hint">R — straight into the next round</div>
                <div className="bomb-actions">
                  <button type="button" onClick={() => { setBombEnd(null); setBombRound((n) => n + 1); }}>AGAIN</button>
                  <button type="button" onClick={() => { setBombEnd(null); setBombRound(0); }}>DONE</button>
                </div>
              </div>
            )}
            <div className="stamina" ref={(el) => { walkHud.current.box = el; }}>
              <i ref={(el) => { walkHud.current.fill = el; }} />
            </div>
            <Joystick inputRef={walkInput} />
            <Joystick inputRef={walkCam} className="stick stick-right" />
            <button
              type="button"
              className="jump-btn"
              onPointerDown={(e) => { e.preventDefault(); walkJump.current = true; }}
              onContextMenu={(e) => e.preventDefault()}
              title="jump"
            >
              ⭡
            </button>
          </>
        )}
        {edit && selected === null && (
          <div className="edit-tools">
            <button
              type="button"
              className="edit-tool edit-exit"
              onClick={onToggleEdit}
              title="leave edit mode"
            >
              ⏎ EXIT
            </button>
            <div className="edit-grid">
              {['eye', 'horn', 'wart', 'arm', 'ear', 'hair', 'nose'].map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={placeKind === kind ? 'edit-tool on' : 'edit-tool'}
                  onClick={() => onPickPlace(kind)}
                  title={kind === 'arm'
                    ? 'arm, then click the trunk to plant an extra arm there'
                    : `arm, then click the head to plant a ${kind} there`}
                >
                  + {kind.toUpperCase()}
                </button>
              ))}
            </div>
            {/* the armed kind may wear its own style, picked here */}
            {placeKind && TYPE_SOURCE[placeKind] && (
              <select
                className="edit-style"
                value={placeRef.current.style ?? ''}
                onChange={(e) => setPlaceStyles((s) => ({ ...s, [placeKind]: e.target.value }))}
                title={`which kind of ${placeKind} the next click plants`}
              >
                {PLACED_TYPES[placeKind]().map((v) => (
                  <option key={v} value={v}>
                    {PARAM_BY_KEY[TYPE_SOURCE[placeKind]].options.find((o) => o.value === v)?.label ?? v}
                  </option>
                ))}
              </select>
            )}
            {/* the clay: bumps and dents pressed straight into the skin */}
            <div className="edit-grid">
              {['bump', 'dent', 'smooth'].map((tool) => (
                <button
                  key={tool}
                  type="button"
                  className={placeKind === tool ? 'edit-tool on' : 'edit-tool'}
                  onClick={() => onPickPlace(tool)}
                  title={tool === 'smooth'
                    ? 'arm, then click a dab to take it back out'
                    : `arm, then click or stroke the head or the trunk to ${tool} it`}
                >
                  {tool.toUpperCase()}
                </button>
              ))}
            </div>
            {params.placed?.length > 0 && (
              <button
                type="button"
                className="edit-tool"
                onClick={() => { onPlaced([]); flash('planted parts cleared'); }}
                title="take every hand-planted part off"
              >
                × PARTS ({params.placed.length})
              </button>
            )}
            {params.sculpt?.length > 0 && (
              <button
                type="button"
                className="edit-tool"
                onClick={() => { onSculpt([]); flash('sculpt cleared'); }}
                title="flatten every bump and dent"
              >
                × SCULPT ({params.sculpt.length})
              </button>
            )}
          </div>
        )}
        {edit && selected?.family && FAMILY_ROWS[selected.family] && (
          <div className="gizmo">
            <div className="gizmo-head">
              <span>{FAMILY_LABEL[selected.family]}</span>
              <button type="button" className="gz-x gz-ok" onClick={() => setSelected(null)} title="done">ok</button>
            </div>
            {FAMILY_ROWS[selected.family].map(([cap, key]) => {
              const def = PARAM_BY_KEY[key];
              const v = params[key];
              return (
                <div className="gz-row" key={key}>
                  <span className="gz-cap">{cap}</span>
                  <button type="button" className="gz" {...hold(() => familyStep(key, -1))}>−</button>
                  <span className="gz-val">{def.type === 'int' ? v : Number(v).toFixed(2)}</span>
                  <button type="button" className="gz" {...hold(() => familyStep(key, 1))}>＋</button>
                </div>
              );
            })}
            {selected.split && (
              <button
                type="button"
                className="gz gz-split"
                onClick={() => {
                  const idx = selected.split();
                  if (idx >= 0) { setSelected({ placed: idx }); flash('each one is on its own now'); }
                  else flash('too many to take apart — clear some hand-placed parts');
                }}
                title="hand every one of these over: each will move, size and aim on its own"
              >
                ⛏ SPLIT — each on its own
              </button>
            )}
            <div className="gz-hint">
              {selected.split ? 'or drag the part itself to take it in hand' : 'tap empty space to finish'}
            </div>
          </div>
        )}
        {edit && selected?.placed !== undefined && params.placed?.[selected.placed] && (
          <div className="gizmo">
            <div className="gizmo-head">
              <span>{params.placed[selected.placed].k}{params.placed[selected.placed].t ? ` · ${params.placed[selected.placed].t}` : ''}</span>
              <button type="button" className="gz-x" onClick={gizmoRemove} title="take this part off">×</button>
            </div>
            <div className="gz-row">
              <span className="gz-cap">move</span>
              <button type="button" className="gz" {...hold(() => gizmoNudge(-1, 0))}>◀</button>
              <button type="button" className="gz" {...hold(() => gizmoNudge(0, 1))}>▲</button>
              <button type="button" className="gz" {...hold(() => gizmoNudge(0, -1))}>▼</button>
              <button type="button" className="gz" {...hold(() => gizmoNudge(1, 0))}>▶</button>
            </div>
            <div className="gz-row">
              <span className="gz-cap">size</span>
              <button type="button" className="gz" {...hold(() => gizmoScale(-1))}>−</button>
              <button type="button" className="gz" {...hold(() => gizmoScale(1))}>＋</button>
            </div>
            {['eye', 'ear', 'hair', 'horn', 'wart'].includes(params.placed[selected.placed].k) && (
              <div className="gz-row">
                <span className="gz-cap">aim</span>
                <button type="button" className="gz" {...hold(() => gizmoTilt('b', -1))}>↰</button>
                <button type="button" className="gz" {...hold(() => gizmoTilt('a', -1))}>⤴</button>
                <button type="button" className="gz" {...hold(() => gizmoTilt('a', 1))}>⤵</button>
                <button type="button" className="gz" {...hold(() => gizmoTilt('b', 1))}>↱</button>
              </div>
            )}
            <div className="gz-hint">tap empty space to finish</div>
          </div>
        )}
      </div>
      <Panel
        params={params}
        note={note}
        idle={idle}
        mood={mood}
        sfx={sfx}
        onChange={setParam}
        onRandom={onRandom}
        onSeed={onSeed}
        onReset={onReset}
        onCopyJson={onCopyJson}
        onCopyLink={onCopyLink}
        onToggleIdle={onToggleIdle}
        onToggleSound={onToggleSound}
        favs={favs}
        onSaveFav={onSaveFav}
        onPickFav={onPickFav}
        onRemoveFav={onRemoveFav}
      />
    </div>
  );
}
