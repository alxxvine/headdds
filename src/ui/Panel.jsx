import { useMemo } from 'react';
import { GROUPS, PARAMS } from '../creature/schema.js';
import { STATS, computeStats, describeMods } from '../creature/stats.js';
import { nameOf } from '../creature/name.js';
import Control from './Control.jsx';
import Catalog from './Catalog.jsx';

const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const HINT = TOUCH ? 'drag to spin, pinch to zoom' : 'drag to spin, wheel to zoom';

function Stats({ params }) {
  const { values, traits, spread, archetype, budget } = useMemo(() => computeStats(params), [params]);

  return (
    <section className="stats">
      <div className="stats-head">
        <span title={`every creature spends the same ${budget} points — a build is how you spend them`}>
          STATS Σ{budget}
        </span>
        <span className="power" title="the stat this build leans into, and how specialised it is">
          {archetype} {Math.round(spread * 100)}%
        </span>
      </div>

      {STATS.map((s) => (
        <div className="stat" key={s.key} title={s.hint}>
          <span className="stat-label">{s.label}</span>
          <span className="stat-bar"><i style={{ width: `${values[s.key]}%` }} /></span>
          <span className="stat-value">{values[s.key]}</span>
        </div>
      ))}

      <div className="traits">
        {traits.length === 0 && <span className="trait none">no traits</span>}
        {traits.map((t) => (
          <span className="trait" key={t.id} title={describeMods(t.mods)}>{t.label}</span>
        ))}
      </div>
    </section>
  );
}

const MOOD_HINT = 'how it feels about you right now: it warms up when you hover '
  + 'and spin the camera, gets angry if you keep poking it, and tires out';

function Collection({ favs, onPick, onRemove }) {
  if (!favs.length) return null;
  return (
    <div className="favs">
      {favs.map((f) => (
        <figure className="fav" key={f.code} title={`${f.name} · #${f.seed}`}>
          {/* the button is the picture: tap anywhere on the freak to load it */}
          <button type="button" className="fav-pick" onClick={() => onPick(f)}>
            {f.thumb
              ? <img src={f.thumb} alt={f.name} draggable={false} />
              : <span className="fav-blank">#{f.seed}</span>}
          </button>
          <button
            type="button"
            className="fav-del"
            aria-label={`forget ${f.name}`}
            onClick={() => onRemove(f)}
          >
            ×
          </button>
          <figcaption>{f.name}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export default function Panel({
  params, note, idle, mood, sfx,
  onChange, onRandom, onSeed, onReset, onCopyJson, onCopyLink, onToggleIdle, onToggleSound,
  favs = [], onSaveFav, onPickFav, onRemoveFav,
}) {
  const name = useMemo(() => nameOf(params), [params]);
  return (
    <aside className="panel">
      <header className="panel-head">
        {/* the creature is the headline, not the app: its name where the
            title plate used to sit, its seed as the small print */}
        <div className="names" title="its name — grown from the seed, epithet from its loudest trait">
          <div className="freak-name">{name}</div>
          <div className="sub">#{params.seed}</div>
        </div>
        {mood && <div className="mood" data-mood={mood} title={MOOD_HINT}>{mood}</div>}
      </header>

      <div className="actions">
        <button type="button" className="primary" onClick={onRandom}>RANDOM</button>
        <button
          type="button"
          className="star"
          onClick={onSaveFav}
          title="save this freak to the collection"
          aria-label="save to collection"
        >
          ★
        </button>
        <label className="seed">
          seed
          <input
            type="number"
            value={params.seed}
            min={0}
            onChange={(e) => onSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
        </label>
      </div>
      <div className="actions">
        <button type="button" onClick={onCopyLink}>LINK</button>
        <button type="button" onClick={onCopyJson}>JSON</button>
        <button type="button" onClick={onReset}>RESET</button>
      </div>
      <div className="actions">
        <button
          type="button"
          className={idle ? 'toggle on' : 'toggle'}
          onClick={onToggleIdle}
          title="idle motion — breathing, blinking, wobble"
        >
          IDLE
        </button>
        <button
          type="button"
          className={sfx ? 'toggle on' : 'toggle'}
          onClick={onToggleSound}
          title="procedural voice, synthesised from the stats — on an iPhone the ring/silent switch mutes it"
        >
          SOUND
        </button>
      </div>
      <div className="note">{note || HINT}</div>

      <Collection favs={favs} onPick={onPickFav} onRemove={onRemoveFav} />

      <Stats params={params} />

      <div className="groups">
        {GROUPS.map((g) => (
          <details key={g.id} open={g.open}>
            <summary>{g.label}</summary>
            <div className="group-body">
              {PARAMS.filter((p) => p.group === g.id).map((def) => (
                <Control key={def.key} def={def} value={params[def.key]} onChange={onChange} />
              ))}
            </div>
          </details>
        ))}
      </div>

      {/* the index of everything the builder can grow: tap a part to try it */}
      <Catalog params={params} onChange={onChange} />

      {/* which build this page is — the short commit and when it was built,
          so a stale deploy is visible from the phone it is stale on */}
      <div className="build">build {typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'}</div>
    </aside>
  );
}
