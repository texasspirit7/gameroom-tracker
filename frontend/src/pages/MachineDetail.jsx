import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, ReferenceLine,
} from 'recharts';
import { api, fmt, signedMoney } from '../api.js';

export default function MachineDetail() {
  const { number } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.machine(number).then(setData).catch((e) => setError(e.message));
  }, [number]);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted"><span className="spinner" />Loading…</p>;

  const { summary, series } = data;
  const n = Number(number);

  return (
    <>
      <div className="toolbar">
        <h1 className="page-title" style={{ margin: 0 }}>Machine #{number}</h1>
        <div className="spacer" />
        <Link className="btn secondary" to="/machines">All machines</Link>
        {n > 1 && <Link className="btn secondary" to={`/machines/${n - 1}`}>← #{n - 1}</Link>}
        {n < 40 && <Link className="btn" to={`/machines/${n + 1}`}>#{n + 1} →</Link>}
      </div>
      <div className="page-sub">{summary.days} day{summary.days === 1 ? '' : 's'} on record · active {summary.active_days}</div>

      <div className="cards">
        <div className="card"><div className="label">Total In</div><div className="value">${fmt(summary.total_in)}</div></div>
        <div className="card"><div className="label">Total Out</div><div className="value">${fmt(summary.total_out)}</div></div>
        <div className={`card ${summary.net >= 0 ? 'good' : 'bad'}`}>
          <div className="label">Net</div>
          <div className={`value ${summary.net >= 0 ? 'good' : 'bad'}`}>{signedMoney(summary.net)}</div>
        </div>
        <div className="card"><div className="label">Hold %</div><div className="value">{summary.hold_pct == null ? '—' : `${summary.hold_pct}%`}</div></div>
        <div className="card good"><div className="label">Best day</div><div className="value good" style={{ fontSize: 16 }}>{summary.best_day ? `${signedMoney(summary.best_day.net)} · ${summary.best_day.date}` : '—'}</div></div>
        <div className="card bad"><div className="label">Worst day</div><div className="value bad" style={{ fontSize: 16 }}>{summary.worst_day ? `${signedMoney(summary.worst_day.net)} · ${summary.worst_day.date}` : '—'}</div></div>
      </div>

      <div className="panel">
        <h2>Daily in / out / net</h2>
        {series.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e8f0" />
              <XAxis dataKey="sheet_date" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => `$${fmt(v)}`} />
              <Legend />
              <ReferenceLine y={0} stroke="#999" />
              <Bar dataKey="daily_in" name="In" fill="#0f6dd1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="daily_out" name="Out" fill="#d98c8c" radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="net" name="Net" stroke="#16803c" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <p className="muted">No readings for this machine yet.</p>}
      </div>

      <div className="panel">
        <h2>History</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Prev In</th><th>Curr In</th><th>Daily In</th>
              <th>Prev Out</th><th>Curr Out</th><th>Daily Out</th><th>Net</th><th>Hold %</th>
            </tr>
          </thead>
          <tbody>
            {series.slice().reverse().map((r) => (
              <tr key={r.sheet_date}>
                <td>{r.sheet_date}</td>
                <td>{fmt(r.prev_in)}</td>
                <td>{fmt(r.curr_in)}</td>
                <td>${fmt(r.daily_in)}</td>
                <td>{fmt(r.prev_out)}</td>
                <td>{fmt(r.curr_out)}</td>
                <td>${fmt(r.daily_out)}</td>
                <td className={r.net >= 0 ? 'pos' : 'neg'}>{signedMoney(r.net)}</td>
                <td>{r.hold_pct == null ? '—' : `${r.hold_pct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
