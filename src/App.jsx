import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Stage from './scene/Stage.jsx';
import { createSound } from './scene/sound.js';
import Panel from './ui/Panel.jsx';
import { DEFAULTS, randomize, randomSeed } from './creature/schema.js';
import { readUrlParams, syncUrl, shareUrl, copyText, prettyJson } from './lib/codec.js';

// Someone who asked the system for less motion should not be met by a
// twitching freak; they can still switch it on with the IDLE button.
const WANTS_MOTION = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

export default function App() {
  const [params, setParams] = useState(() => readUrlParams() || { ...DEFAULTS });
  const [note, setNote] = useState('');
  const [idle, setIdle] = useState(WANTS_MOTION);
  const [mood, setMood] = useState(null);
  const [sfx, setSfx] = useState(false);
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
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const onRandom = useCallback(() => {
    const seed = randomSeed();
    setParams(randomize(seed));
    flash(`new freak #${seed}`);
  }, [flash]);

  const onSeed = useCallback((seed) => setParams(randomize(seed)), []);

  const onReset = useCallback(() => {
    setParams({ ...DEFAULTS });
    flash('parameters reset');
  }, [flash]);

  const onCopyJson = useCallback(async () => {
    const ok = await copyText(prettyJson(params));
    flash(ok ? 'JSON copied' : 'clipboard access denied');
  }, [params, flash]);

  const onCopyLink = useCallback(async () => {
    const url = shareUrl(params);
    syncUrl(params);
    const ok = await copyText(url);
    flash(ok ? 'link copied' : 'link is in the address bar');
  }, [params, flash]);

  const onToggleIdle = useCallback(() => {
    setIdle((v) => {
      flash(v ? 'idle motion off' : 'idle motion on');
      return !v;
    });
  }, [flash]);

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
      <div className="viewport">
        <Stage params={scene} idle={idle} onMood={setMood} sound={sound} />
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
      />
    </div>
  );
}
