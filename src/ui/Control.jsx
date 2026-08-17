const fmt = (v) => (Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(2));

export default function Control({ def, value, onChange }) {
  if (def.type === 'select') {
    return (
      <label className="row">
        <span className="row-label">{def.label}</span>
        <select value={value} onChange={(e) => onChange(def.key, e.target.value)}>
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    );
  }

  if (def.type === 'color') {
    return (
      <div className="row row-color">
        <span className="row-label">{def.label}</span>
        <div className="swatches">
          {def.palette.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${c.toLowerCase() === String(value).toLowerCase() ? ' on' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => onChange(def.key, c)}
            />
          ))}
          <input
            type="color"
            className="swatch pick"
            value={value}
            onChange={(e) => onChange(def.key, e.target.value)}
            title="custom color"
          />
        </div>
      </div>
    );
  }

  return (
    <label className="row">
      <span className="row-label">{def.label}</span>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onChange={(e) => onChange(def.key, Number(e.target.value))}
      />
      <span className="row-value">{fmt(Number(value))}</span>
    </label>
  );
}
