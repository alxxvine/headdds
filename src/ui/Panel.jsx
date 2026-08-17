import { GROUPS, PARAMS } from '../creature/schema.js';
import Control from './Control.jsx';

const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const HINT = TOUCH ? 'тащи — вращать, щипок — зум' : 'ЛКМ — вращать, колесо — зум';

export default function Panel({ params, onChange, onRandom, onSeed, onReset, onCopyJson, onCopyLink, note }) {
  return (
    <aside className="panel">
      <header className="panel-head">
        <div className="title">HEADDDS</div>
        <div className="sub">конструктор уродцев</div>
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
        <button type="button" onClick={onCopyLink}>ССЫЛКА</button>
        <button type="button" onClick={onCopyJson}>JSON</button>
        <button type="button" onClick={onReset}>СБРОС</button>
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
