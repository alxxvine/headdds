import { useCallback, useState } from 'react';
import { SECTIONS, sectionOptions, peekShot, ensureSection } from '../lib/partShots.js';

// The catalog of parts: every kind of arm, hand, leg, hair, eye, maw and the
// rest, each with a thumbnail on the mannequin. Tapping a tile puts that part
// on the current freak — it is a picker as much as an index.
//
// Thumbnails render lazily, section by section, the first time a section is
// opened; until one lands its tile shows the label alone.

function Section({ sec, params, onChange }) {
  const [, setTick] = useState(0);
  const options = sectionOptions(sec);

  const onToggle = useCallback((e) => {
    // render this section's thumbnails on first open; repaint as each lands
    if (e.target.open) ensureSection(sec, () => setTick((n) => n + 1));
  }, [sec]);

  return (
    <details onToggle={onToggle}>
      <summary>
        {sec.label}
        <span className="cat-count">{options.length}</span>
      </summary>
      <div className="tiles">
        {options.map((o) => {
          const on = params[sec.key] === o.value;
          const shot = peekShot(sec, o.value);
          return (
            <button
              key={o.value}
              type="button"
              className={on ? 'tile on' : 'tile'}
              title={`put ${o.label} on this freak — tap, or drag it onto the creature`}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', `${sec.key}:${o.value}`)}
              onClick={() => onChange(sec.key, o.value)}
            >
              {shot
                ? <img src={shot} alt={o.label} draggable={false} />
                : <span className="tile-wait">···</span>}
              <span className="tile-label">{o.label}</span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

export default function Catalog({ params, onChange }) {
  return (
    <details className="catalog">
      <summary>PARTS CATALOG</summary>
      <div className="cat-hint">
        every part the builder knows, worn by the standard freak — tap one to
        put it on yours
      </div>
      {SECTIONS.map((sec) => (
        <Section key={sec.key} sec={sec} params={params} onChange={onChange} />
      ))}
    </details>
  );
}
