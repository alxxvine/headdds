import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Stage from './scene/Stage.jsx';
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

export default function App() {
  const [params, setParams] = useState(() => readUrlParams() || { ...DEFAULTS });
  const [note, setNote] = useState('');
  const [idle, setIdle] = useState(WANTS_MOTION);
  const [mood, setMood] = useState(null);
  const [sfx, setSfx] = useState(false);
  const [favs, setFavs] = useState(loadFavs);
  const [viewReset, setViewReset] = useState(0);
  const [edit, setEdit] = useState(false);
  const [placeKind, setPlaceKind] = useState(null);
  // which style the next planted part of a kind wears; null = same as the face
  const [placeStyles, setPlaceStyles] = useState({ eye: null, arm: 'stick', ear: null, hair: null, nose: null });
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

  const onToggleEdit = useCallback(() => {
    sound.ui('tap');
    setPlaceKind(null);
    setEdit((v) => {
      flash(v ? 'edit mode off' : 'EDIT: drag a part to reshape it, wheel to resize');
      return !v;
    });
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
    <div className="app">
      <div className="viewport" onDragOver={(e) => e.preventDefault()} onDrop={onDropPart}>
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
          placeKind={placeKind}
          placeRef={placeRef}
          onNote={flash}
        />
        <button
          type="button"
          className={edit ? 'edit-toggle on' : 'edit-toggle'}
          onClick={onToggleEdit}
          title="grab the creature itself: drag a part to reshape it, wheel over it to resize"
        >
          EDIT
        </button>
        {edit && (
          <div className="edit-tools">
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
