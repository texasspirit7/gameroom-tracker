import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { api, fmt, signedMoney } from '../api.js';
import { useDateRange } from '../DateRangeContext.jsx';

export default function Dashboard() {
  const { from, to, label, preset } = useDateRange();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [audit, setAudit] = useState(null);

  useEffect(() => {
    setData(null);
    const params = preset === 'allTime'
      ? ''
      : `?from=${from}&to=${to}&label=${encodeURIComponent(label)}`;
    api.dashboard(params).then(setData).catch((e) => setError(e.message));
  }, [from, to, label, preset]);

  useEffect(() => { api.auditLog(15).then(setAudit).catch(() => setAudit([])); }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted"><span className="spinner" />Loading dashboard…</p>;

  const { totals, previous, buckets, alerts, expenses, otherExpensesTotal, deadMachines, range, chartGranularity, latestDate } = data;
  const hasData = totals.sheet_count > 0;
  const chartNoun = chartGranularity === 'month' ? 'month' : chartGranularity === 'week' ? 'week' : 'day';

  const delta = (key) => (previous && totals[key] != null && previous[key] != null ? totals[key] - previous[key] : null);

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <div className="page-sub">
        Showing <strong>{range.label}</strong>
        {!range.allTime && <> ({range.from} → {range.to})</>}
        {' · '}{totals.sheet_count} sheet{totals.sheet_count === 1 ? '' : 's'} in range
        {latestDate && <> · latest upload {latestDate}</>}
      </div>

      <div className="cards">
        <Card label="Total In" value={`$${fmt(totals.total_in)}`} delta={delta('total_in')} />
        <Card label="Total Out" value={`$${fmt(totals.total_out)}`} delta={delta('total_out')} invert />
        <Card label="Match" value={`$${fmt(totals.match)}`} delta={delta('match')} invert />
        <Card label="Expenses" value={`$${fmt(totals.expenses_total)}`} delta={delta('expenses_total')} invert />
        <Card label="Meter Profit" value={signedMoney(totals.meter_profit)} tone={totals.meter_profit >= 0 ? 'good' : 'bad'} delta={delta('meter_profit')} />
        <Card
          label="Net Profit (after overhead)"
          value={signedMoney(totals.net_profit)}
          tone={totals.net_profit >= 0 ? 'good' : 'bad'}
          delta={delta('net_profit')}
        />
      </div>

      <div className="panel">
        <h2>Alerts — {range.label}</h2>
        {!hasData ? (
          <p className="muted" style={{ margin: 0 }}>No sheets uploaded for {range.label}.</p>
        ) : alerts.length ? (
          <div className="alert-list">
            {alerts.map((a, i) => (
              <div key={i} className={`alert-item ${a.level}`}>
                <span className={`badge ${a.level}`}>{a.level}</span>
                {a.machine ? <Link to={`/machines/${a.machine}`}>{a.message}</Link> : a.message}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No alerts — all clear ✅</p>
        )}
      </div>

      <div className="panel">
        <h2>Profit trend by {chartNoun}</h2>
        {hasData ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={buckets} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e8f0" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => `$${fmt(v)}`} />
              <Legend />
              <ReferenceLine y={0} stroke="#999" />
              <Line type="monotone" dataKey="total_in" name="Total In" stroke="#0f6dd1" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="total_out" name="Total Out" stroke="#9db6d8" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="match" name="Match" stroke="#8e5cd9" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="expenses" name="Expenses" stroke="#b97c10" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="meter_profit" name="Meter Profit" stroke="#16803c" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="net_profit" name="Net Profit" stroke="#2ca8b3" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <p className="muted">No data in this range.</p>}
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>In vs out by {chartNoun}</h2>
          {hasData ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={buckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e8f0" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v) => `$${fmt(v)}`} />
                <Legend />
                <Bar dataKey="total_in" name="In" fill="#0f6dd1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="total_out" name="Out" fill="#9db6d8" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="muted">No data yet.</p>}
        </div>

        <div className="panel">
          <h2>Expenses — {range.label} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(sheet + <Link to="/expenses">manual</Link>)</span></h2>
          {expenses.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={expenses} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" fontSize={12} />
                <YAxis type="category" dataKey="category" fontSize={12} width={80} />
                <Tooltip formatter={(v) => `$${fmt(v)}`} />
                <Bar dataKey="amount" fill="#b97c10" radius={[0, 3, 3, 0]}>
                  {expenses.map((e, i) => <Cell key={i} fill={i % 2 ? '#d29a2e' : '#b97c10'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="muted">No expenses recorded in this range.</p>}
          <p className="muted" style={{ fontSize: 12 }}>
            Meter Profit doesn't subtract any expenses. Net Profit (After Overhead) subtracts all of
            them — sheet expenses (pay, family dollar, supplies) plus whatever you log manually on the
            {' '}<Link to="/expenses">Expenses</Link> page (${fmt(otherExpensesTotal)}).
          </p>
        </div>
      </div>

      {deadMachines.length > 0 && (
        <div className="panel">
          <h2>Machines with no play — {range.label}</h2>
          <p style={{ fontSize: 13 }}>
            {deadMachines.map((n) => (
              <Link key={n} to={`/machines/${n}`} style={{ marginRight: 10 }}>#{n}</Link>
            ))}
          </p>
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <h2>Export</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Downloads data for the current range ({range.label}) as CSV.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a className="btn secondary" href={api.exportUrl('sheets', from, to)} download>Sheets CSV</a>
            <a className="btn secondary" href={api.exportUrl('expenses', from, to)} download>Expenses CSV</a>
            <a className="btn secondary" href={api.exportUrl('profit-split')} download>Profit Split CSV</a>
          </div>
        </div>

        <div className="panel">
          <h2>Recent Activity</h2>
          {!audit ? (
            <p className="muted"><span className="spinner" />Loading…</p>
          ) : audit.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No activity recorded yet.</p>
          ) : (
            <ul className="activity-list">
              {audit.map((a) => (
                <li key={a.id}>
                  <strong>{ACTION_LABEL[a.action] || a.action}</strong>{' '}
                  {a.action !== 'deleted' && a.sheet_id ? (
                    <Link to={`/sheets/${a.sheet_id}`}>sheet {a.sheet_date}</Link>
                  ) : (
                    <>sheet {a.sheet_date}</>
                  )}
                  {' — '}{a.actor_name || a.actor_email || 'someone'}
                  <span className="muted" style={{ fontSize: 11 }}> · {relativeTime(a.created_at)}</span>
                  {a.detail && <div className="muted" style={{ fontSize: 11 }}>{a.detail}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

const ACTION_LABEL = { created: 'Uploaded', edited: 'Edited', verified: 'Verified', deleted: 'Deleted' };

// SQLite's datetime('now') stores UTC as "YYYY-MM-DD HH:MM:SS" with no timezone marker —
// without an explicit "Z", Date() would parse it as local time and skew the diff.
function relativeTime(sqliteUtc) {
  const diffMs = Date.now() - new Date(`${sqliteUtc.replace(' ', 'T')}Z`).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function Card({ label, value, tone, delta, invert }) {
  let deltaEl = null;
  if (delta != null) {
    const good = invert ? delta < 0 : delta >= 0;
    deltaEl = (
      <div className={`card-delta ${good ? 'pos' : 'neg'}`}>
        {delta >= 0 ? '▲' : '▼'} {signedMoney(Math.abs(delta))} vs previous period
      </div>
    );
  }
  return (
    <div className={`card ${tone || ''}`}>
      <div className="label">{label}</div>
      <div className={`value ${tone || ''}`}>{value}</div>
      {deltaEl}
    </div>
  );
}
