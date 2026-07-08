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
        <Card label="Meter Profit" value={signedMoney(totals.meter_profit)} tone={totals.meter_profit >= 0 ? 'good' : 'bad'} delta={delta('meter_profit')} />
        <Card
          label="Net Profit (after overhead)"
          value={signedMoney(totals.net_profit)}
          tone={totals.net_profit >= 0 ? 'good' : 'bad'}
          delta={delta('net_profit')}
        />
        <Card label="Cash Profit" value={signedMoney(totals.cash_profit)} tone={totals.cash_profit == null ? '' : totals.cash_profit >= 0 ? 'good' : 'bad'} delta={delta('cash_profit')} />
        <Card label="Over / Short" value={signedMoney(totals.over_short)} tone={totals.over_short == null ? '' : totals.over_short >= 0 ? 'good' : 'bad'} delta={delta('over_short')} />
        <Card label="Hold %" value={totals.hold_pct != null ? `${totals.hold_pct}%` : '—'} />
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
              <Line type="monotone" dataKey="meter_profit" name="Meter profit" stroke="#0f6dd1" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="cash_profit" name="Cash profit" stroke="#16803c" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="over_short" name="Over/Short" stroke="#c22f2f" strokeDasharray="5 4" dot={{ r: 3 }} connectNulls />
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
          <h2>Expenses — {range.label} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(sheet + <Link to="/other-expenses">other</Link>)</span></h2>
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
            Match play: ${fmt(totals.match)}
            {otherExpensesTotal > 0 && <> · Other expenses: ${fmt(otherExpensesTotal)}</>}
          </p>
          <p className="muted" style={{ fontSize: 12 }}>
            Sheet expenses (pay, food, supplies, etc.) are already subtracted in Meter Profit.
            {' '}<Link to="/other-expenses">Other Expenses</Link> (${fmt(otherExpensesTotal)}) are subtracted
            on top of that to get Net Profit.
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
