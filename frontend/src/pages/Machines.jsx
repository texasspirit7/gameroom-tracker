import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmt, signedMoney } from '../api.js';
import { useDateRange } from '../DateRangeContext.jsx';

// Worst-first: bleeding > negative > dead > (no flag) > profit
const FLAG_RANK = { bleeding: 0, negative: 1, dead: 2, profit: 4 };
const flagRank = (f) => FLAG_RANK[f] ?? 3;

// The word a cabinet wears on its plate — read before any number.
const STATE_LABEL = { profit: 'Holding', bleeding: 'Bleeding', negative: 'Negative', dead: 'No play' };

/**
 * Where a machine sits on a bleeding → holding range, as a 0–100% track position.
 * Break-even (0% hold) sits dead centre; anything at or past −100% pins to the far left, so a
 * wild figure like −1650% still renders somewhere sensible instead of blowing out the track.
 */
const gaugePos = (holdPct) => Math.min(100, Math.max(0, (holdPct + 100) / 2));

const SORTS = {
  number: (a, b) => a.machine_number - b.machine_number,
  net: (a, b) => b.net - a.net,
  in: (a, b) => b.total_in - a.total_in,
  hold: (a, b) => (b.hold_pct ?? -Infinity) - (a.hold_pct ?? -Infinity),
  flag: (a, b) => flagRank(a.flag) - flagRank(b.flag) || a.net - b.net,
};

export default function Machines() {
  const { from, to, label, preset } = useDateRange();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('number');
  // Cabinets read faster at a glance; the table keeps the dense columns (averages, max payout)
  // that the cards deliberately leave out.
  const [view, setView] = useState('cabs');
  const navigate = useNavigate();

  useEffect(() => {
    setData(null);
    const params = preset === 'allTime'
      ? ''
      : `?from=${from}&to=${to}&label=${encodeURIComponent(label)}`;
    api.machines(params).then(setData).catch((e) => setError(e.message));
  }, [from, to, label, preset]);

  const sorted = useMemo(
    () => (data ? [...data.machines].sort(SORTS[sort]) : []),
    [data, sort]
  );

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted"><span className="spinner" />Loading…</p>;

  const rows = data.machines;
  const winners = rows.filter((r) => r.net > 0).length;
  const losers = rows.filter((r) => r.net < 0).length;
  const dead = rows.filter((r) => r.flag === 'dead').length;

  return (
    <>
      <h1 className="page-title">Machines</h1>
      <div className="page-sub">
        Per-machine performance for <strong>{data.range.label}</strong>
        {!data.range.allTime && <> ({data.range.from} → {data.range.to})</>}
        {' '}— click a row for the full history
      </div>

      <div className="cards">
        <div className="card good"><div className="label">Profitable</div><div className="value good">{winners}</div></div>
        <div className="card bad"><div className="label">Losing money</div><div className="value bad">{losers}</div></div>
        <div className="card"><div className="label">No play</div><div className="value">{dead}</div></div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>All machines — {data.range.label}</h2>
          <div className="spacer" />
          <div className="segmented">
            <button className={view === 'cabs' ? 'seg-active' : ''} onClick={() => setView('cabs')}>Cabinets</button>
            <button className={view === 'table' ? 'seg-active' : ''} onClick={() => setView('table')}>Table</button>
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="number">Sort: machine #</option>
            <option value="net">Sort: net profit</option>
            <option value="in">Sort: total in</option>
            <option value="hold">Sort: hold %</option>
            <option value="flag">Sort: flag</option>
          </select>
        </div>
        {rows.length === 0 ? (
          <p className="muted">No readings in this range.</p>
        ) : view === 'cabs' ? (
          <div className="cabs">
            {sorted.map((m) => (
              <div
                key={m.machine_number}
                className="cab"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/machines/${m.machine_number}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/machines/${m.machine_number}`); } }}
              >
                <div className="cab-plate">
                  <span className="cab-no">#{m.machine_number}</span>
                  <span className={`cab-state ${m.flag || 'dead'}`}>{STATE_LABEL[m.flag] || 'Even'}</span>
                </div>
                <div className="cab-body">
                  <div className="cab-fig"><span>In</span><span>${fmt(m.total_in)}</span></div>
                  <div className="cab-fig"><span>Out</span><span>${fmt(m.total_out)}</span></div>
                  <div className="cab-fig">
                    <span>Net</span>
                    <span className={m.net >= 0 ? 'pos' : 'neg'}>{signedMoney(m.net)}</span>
                  </div>
                  <div className="gauge">
                    <div className={`gauge-track${m.hold_pct == null ? ' empty' : ''}`}>
                      <i
                        className={`gauge-pin${m.hold_pct == null ? ' empty' : ''}`}
                        style={{ '--at': `${m.hold_pct == null ? 50 : gaugePos(m.hold_pct)}%` }}
                      />
                    </div>
                    <div className="gauge-cap">
                      <span>Hold</span>
                      <b>{m.hold_pct == null ? '—' : `${m.hold_pct}%`}</b>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th><th>Days</th><th>Active</th><th>Total In</th><th>Total Out</th>
                <th>Net Profit</th><th>Hold %</th><th>Average Daily In</th><th>Average Daily Out</th><th>Maximum Payout</th><th>Flag</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <tr key={m.machine_number} className="clickable" onClick={() => navigate(`/machines/${m.machine_number}`)}>
                  <td><strong>#{m.machine_number}</strong></td>
                  <td>{m.days}</td>
                  <td>{m.active_days}</td>
                  <td>${fmt(m.total_in)}</td>
                  <td>${fmt(m.total_out)}</td>
                  <td className={m.net >= 0 ? 'pos' : 'neg'}>{signedMoney(m.net)}</td>
                  <td className={m.hold_pct == null ? '' : m.hold_pct >= 0 ? 'pos' : 'neg'}>
                    {m.hold_pct == null ? '—' : `${m.hold_pct}%`}
                  </td>
                  <td>${fmt(m.avg_in)}</td>
                  <td>${fmt(m.avg_out)}</td>
                  <td>${fmt(m.max_out)}</td>
                  <td>{m.flag ? <span className={`badge ${m.flag}`}>{m.flag}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
