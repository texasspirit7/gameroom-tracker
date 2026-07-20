import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, ReferenceLine,
} from 'recharts';
import { api, fmt, signedMoney } from '../api.js';

export default function MachineDetail() {
  const { number } = useParams();
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.machine(number).then(setData).catch((e) => setError(e.message));
  }, [number]);

  useEffect(() => {
    api.machinesMeta().then(setMeta).catch(() => {});
  }, []);

  // When multiple sheets share a date (e.g. separate shifts), label them
  // distinctly so the chart/table don't show ambiguous duplicate dates.
  // Also flags exactly where meter continuity breaks between consecutive
  // sheets — this machine's Previous In/Out should equal the prior sheet's
  // Current In/Out; a mismatch means a missed day, a misread, or a meter swap.
  const series = useMemo(() => {
    if (!data) return [];
    const dateCounts = new Map();
    for (const r of data.series) dateCounts.set(r.sheet_date, (dateCounts.get(r.sheet_date) || 0) + 1);
    return data.series.map((r, i) => {
      const prior = data.series[i - 1];
      return {
        ...r,
        label: dateCounts.get(r.sheet_date) > 1 ? `${r.sheet_date} (#${r.sheet_id})` : r.sheet_date,
        break_in: i > 0 && prior.curr_in !== r.prev_in,
        break_out: i > 0 && prior.curr_out !== r.prev_out,
        expected_prev_in: i > 0 ? prior.curr_in : null,
        expected_prev_out: i > 0 ? prior.curr_out : null,
      };
    });
  }, [data]);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted"><span className="spinner" />Loading…</p>;

  const { summary } = data;
  const n = Number(number);
  const min = meta?.min ?? 1;
  const max = meta?.max ?? n;

  return (
    <>
      <div className="toolbar">
        <h1 className="page-title" style={{ margin: 0 }}>Machine #{number}</h1>
        <div className="spacer" />
        <Link className="btn secondary" to="/machines">All machines</Link>
        {n > min && <Link className="btn secondary" to={`/machines/${n - 1}`}>← #{n - 1}</Link>}
        {n < max && <Link className="btn" to={`/machines/${n + 1}`}>#{n + 1} →</Link>}
      </div>
      <div className="page-sub">{summary.days} sheet{summary.days === 1 ? '' : 's'} on record · active {summary.active_days}</div>

      <div className="cards">
        <div className="card"><div className="label">Total In</div><div className="value">${fmt(summary.total_in)}</div></div>
        <div className="card"><div className="label">Total Out</div><div className="value">${fmt(summary.total_out)}</div></div>
        <div className={`card ${summary.net >= 0 ? 'good' : 'bad'}`}>
          <div className="label">Net Profit</div>
          <div className={`value ${summary.net >= 0 ? 'good' : 'bad'}`}>{signedMoney(summary.net)}</div>
        </div>
        <div className="card"><div className="label">Hold %</div><div className="value">{summary.hold_pct == null ? '—' : `${summary.hold_pct}%`}</div></div>
        <div className="card good"><div className="label">Best day</div><div className="value good" style={{ fontSize: 16 }}>{summary.best_day ? `${signedMoney(summary.best_day.net)} · ${summary.best_day.date}` : '—'}</div></div>
        <div className="card bad"><div className="label">Worst day</div><div className="value bad" style={{ fontSize: 16 }}>{summary.worst_day ? `${signedMoney(summary.worst_day.net)} · ${summary.worst_day.date}` : '—'}</div></div>
      </div>

      <div className="panel">
        <h2>Daily In / Out / Net Profit</h2>
        {series.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e8f0" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => `$${fmt(v)}`} />
              <Legend />
              <ReferenceLine y={0} stroke="#999" />
              <Bar dataKey="daily_in" name="In" fill="#0f6dd1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="daily_out" name="Out" fill="#d98c8c" radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="net" name="Net Profit" stroke="#16803c" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <p className="muted">No readings for this machine yet.</p>}
      </div>

      <div className="panel">
        <h2>History</h2>
        {series.some((r) => r.break_in || r.break_out) && (
          <p className="muted" style={{ marginTop: 0 }}>
            ⚠ Highlighted cells don't match the previous sheet's reading for this machine — hover for the expected value.
          </p>
        )}
        <table>
          <thead>
            <tr>
              <th>Sheet</th><th>Previous In</th><th>Current In</th><th>Daily In</th>
              <th>Previous Out</th><th>Current Out</th><th>Daily Out</th><th>Net Profit</th><th>Hold %</th>
            </tr>
          </thead>
          <tbody>
            {series.slice().reverse().map((r) => (
              <tr key={r.sheet_id}>
                <td><Link to={`/sheets/${r.sheet_id}`}>{r.label}</Link></td>
                <td
                  className={r.break_in ? 'cell-flag' : ''}
                  title={r.break_in ? `Expected ${fmt(r.expected_prev_in)} (Current In from the previous sheet)` : undefined}
                >
                  {fmt(r.prev_in)}{r.break_in && ' ⚠'}
                </td>
                <td>{fmt(r.curr_in)}</td>
                <td>${fmt(r.daily_in)}</td>
                <td
                  className={r.break_out ? 'cell-flag' : ''}
                  title={r.break_out ? `Expected ${fmt(r.expected_prev_out)} (Current Out from the previous sheet)` : undefined}
                >
                  {fmt(r.prev_out)}{r.break_out && ' ⚠'}
                </td>
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
