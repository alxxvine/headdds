import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import Stage from './scene/Stage.jsx';
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

  return (
    <div className="app">
      <div className="viewport">
        <Stage params={scene} idle={idle} />
      </div>
      <Panel
        params={params}
        note={note}
        idle={idle}
        onChange={setParam}
        onRandom={onRandom}
        onSeed={onSeed}
        onReset={onReset}
        onCopyJson={onCopyJson}
        onCopyLink={onCopyLink}
        onToggleIdle={onToggleIdle}
      />
    </div>
  );
}
