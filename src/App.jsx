import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import Stage from './scene/Stage.jsx';
import Panel from './ui/Panel.jsx';
import { DEFAULTS, randomize, randomSeed } from './creature/schema.js';
import { readUrlParams, syncUrl, shareUrl, copyText, prettyJson } from './lib/codec.js';

export default function App() {
  const [params, setParams] = useState(() => readUrlParams() || { ...DEFAULTS });
  const [note, setNote] = useState('');
  const noteTimer = useRef(0);

  // Сцену кормим отложенным значением: слайдер остаётся отзывчивым,
  // даже если пересборка меша занимает пару кадров.
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
    flash(`новый уродец #${seed}`);
  }, [flash]);

  const onSeed = useCallback((seed) => setParams(randomize(seed)), []);

  const onReset = useCallback(() => {
    setParams({ ...DEFAULTS });
    flash('параметры сброшены');
  }, [flash]);

  const onCopyJson = useCallback(async () => {
    const ok = await copyText(prettyJson(params));
    flash(ok ? 'JSON скопирован' : 'не дали доступ к буферу');
  }, [params, flash]);

  const onCopyLink = useCallback(async () => {
    const url = shareUrl(params);
    syncUrl(params);
    const ok = await copyText(url);
    flash(ok ? 'ссылка скопирована' : 'ссылка в адресной строке');
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
