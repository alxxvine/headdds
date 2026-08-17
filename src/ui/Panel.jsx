import { GROUPS, PARAMS } from '../creature/schema.js';
import Control from './Control.jsx';

const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const HINT = TOUCH ? 'drag to spin, pinch to zoom' : 'drag to spin, wheel to zoom';

export default function Panel({ params, onChange, onRandom, onSeed, onReset, onCopyJson, onCopyLink, note }) {
  return (
    <aside className="panel">
      <header className="panel-head">
        <div className="title">HEADDDS</div>
        <div className="sub">freak builder</div>
      </header>

      <div className="actions">
        <button type="button" className="primary" onClick={onRandom}>RANDOM</button>
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
      <div className="note">{note || HINT}</div>

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
    </aside>
  );
}
