import { useEffect, useState } from 'react';
import { SECTIONS, sectionOptions, peekShot, ensureSection } from '../lib/partShots.js';

// The catalog of parts as a fitting room: every kind of arm, hand, leg, hair,
// eye, maw and the rest, each worn by the CURRENT freak. Tapping a tile puts
// that part on it — a picker as much as an index.
//
// Thumbnails render lazily for whichever sections are open, and re-bake a
// beat after the creature changes; the moment it changes the old tiles drop
// to placeholders — half-old half-new read as the freak slowly mutating.

function Section({ sec, params, onChange }) {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const options = sectionOptions(sec);

  // Re-shoot this section's tiles when it is open and the creature has
  // changed — debounced, so a slider drag bakes once at the end, not on
  // every pixel of travel.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => ensureSection(sec, params, () => setTick((n) => n + 1)), 350);
    return () => clearTimeout(t);
  }, [open, params, sec]);

  return (
    <details onToggle={(e) => setOpen(e.target.open)}>
      <summary>
        {sec.label}
        <span className="cat-count">{options.length}</span>
      </summary>
      <div className="tiles">
        {options.map((o) => {
          const on = params[sec.key] === o.value;
          const shot = peekShot(sec, params, o.value);
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
        every part the builder knows, tried on by YOUR current freak — tap one
        to keep it
      </div>
      {SECTIONS.map((sec) => (
        <Section key={sec.key} sec={sec} params={params} onChange={onChange} />
      ))}
    </details>
  );
}
