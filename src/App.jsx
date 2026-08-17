import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import Stage from './scene/Stage.jsx';
import Panel from './ui/Panel.jsx';
import { DEFAULTS, randomize, randomSeed } from './creature/schema.js';
import { readUrlParams, syncUrl, shareUrl, copyText, prettyJson } from './lib/codec.js';

export default function App() {
  const [params, setParams] = useState(() => readUrlParams() || { ...DEFAULTS });
  const [note, setNote] = useState('');
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

  return (
    <div className="app">
      <div className="viewport">
        <Stage params={scene} />
      </div>
      <Panel
        params={params}
        note={note}
        onChange={setParam}
        onRandom={onRandom}
        onSeed={onSeed}
        onReset={onReset}
        onCopyJson={onCopyJson}
        onCopyLink={onCopyLink}
      />
    </div>
  );
}
