import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmt, signedMoney } from '../api.js';

const SORTS = {
  number: (a, b) => a.machine_number - b.machine_number,
  net: (a, b) => b.net - a.net,
  in: (a, b) => b.total_in - a.total_in,
  hold: (a, b) => (b.hold_pct ?? -Infinity) - (a.hold_pct ?? -Infinity),
};

export default function Machines() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('number');
  const navigate = useNavigate();

  useEffect(() => {
    api.machines().then(setRows).catch((e) => setError(e.message));
  }, []);

  const sorted = useMemo(() => (rows ? [...rows].sort(SORTS[sort]) : []), [rows, sort]);

  if (error) return <div className="error-box">{error}</div>;
  if (!rows) return <p className="muted"><span className="spinner" />Loading…</p>;

  const winners = rows.filter((r) => r.net > 0).length;
  const losers = rows.filter((r) => r.net < 0 && r.total_in > 0).length;
  const dead = rows.filter((r) => r.flag === 'dead').length;

  return (
    <>
      <h1 className="page-title">Machines</h1>
      <div className="page-sub">Per-machine performance across all uploaded sheets — click a row for the full history</div>

      <div className="cards">
        <div className="card good"><div className="label">Profitable</div><div className="value good">{winners}</div></div>
        <div className="card bad"><div className="label">Losing money</div><div className="value bad">{losers}</div></div>
        <div className="card"><div className="label">Dead (no play)</div><div className="value">{dead}</div></div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>All machines</h2>
          <div className="spacer" />
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="number">Sort: machine #</option>
            <option value="net">Sort: net profit</option>
            <option value="in">Sort: total in</option>
            <option value="hold">Sort: hold %</option>
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Days</th><th>Active</th><th>Total In</th><th>Total Out</th>
              <th>Net</th><th>Hold %</th><th>Avg In/Day</th><th>Max Payout</th><th>Flag</th>
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
                <td>${fmt(m.max_out)}</td>
                <td>{m.flag ? <span className={`badge ${m.flag}`}>{m.flag}</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
