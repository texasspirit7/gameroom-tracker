import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, Cell,
} from 'recharts';
import { api, fmt, signedMoney } from '../api.js';
import { useDateRange } from '../DateRangeContext.jsx';

export default function Dashboard() {
  const { from, to, label, preset } = useDateRange();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    const params = preset === 'allTime'
      ? ''
      : `?from=${from}&to=${to}&label=${encodeURIComponent(label)}`;
    api.dashboard(params).then(setData).catch((e) => setError(e.message));
  }, [from, to, label, preset]);

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
    </>
  );
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
