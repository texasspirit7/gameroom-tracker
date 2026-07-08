import { useEffect, useRef, useState } from 'react';
import { useDateRange } from '../DateRangeContext.jsx';

export default function DateRangePicker() {
  const { preset, from, to, label, presets, setPreset, setCustomRange } = useDateRange();
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(from || '');
  const [customTo, setCustomTo] = useState(to || '');
  const ref = useRef(null);

  useEffect(() => {
    setCustomFrom(from || '');
    setCustomTo(to || '');
  }, [from, to]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const validCustom = customFrom && customTo && customFrom <= customTo;

  const apply = () => {
    if (!validCustom) return;
    setCustomRange(customFrom, customTo);
    setOpen(false);
  };

  return (
    <div className="daterange" ref={ref}>
      <button className="daterange-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="daterange-icon">📅</span>
        <span>{label}</span>
        {preset !== 'allTime' && <span className="daterange-sub">{from} → {to}</span>}
        <span className="daterange-caret">▾</span>
      </button>
      {open && (
        <div className="daterange-panel">
          <div className="daterange-presets">
            {presets.map((p) => (
              <button
                key={p.key}
                className={preset === p.key ? 'seg-active' : ''}
                onClick={() => { setPreset(p.key); setOpen(false); }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="daterange-custom">
            <div className="daterange-custom-title">Custom range</div>
            <label>
              From
              <input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
            <button onClick={apply} disabled={!validCustom}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
