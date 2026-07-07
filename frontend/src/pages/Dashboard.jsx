import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { api, fmt, signedMoney } from '../api.js';
import { usePeriod } from '../PeriodContext.jsx';

const PERIOD_NOUN = { day: 'day', week: 'week', month: 'month' };

export default function Dashboard() {
  const { period } = usePeriod();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.dashboard(`?granularity=${period}`).then(setData).catch((e) => setError(e.message));
  }, [period]);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted"><span className="spinner" />Loading dashboard…</p>;

  const {
    totals, buckets, current, previous, scopeLabel,
    expenses, match, alerts, deadMachines, sheetCount, latestDate, granularity,
  } = data;
  const hasData = sheetCount > 0;
  const isAll = granularity === 'all';

  // Cards show the latest period (or all-time totals in "All time" view)
  const cards = isAll ? totals : current || {};
  const cardScope = isAll
    ? 'All time'
    : current
      ? granularity === 'day' ? current.period : current.label
      : 'No data';
  const noun = PERIOD_NOUN[granularity];

  const delta = (key) =>
    !isAll && previous && cards[key] != null && previous[key] != null
      ? cards[key] - previous[key]
      : null;

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <div className="page-sub">
        {hasData
          ? <>Showing <strong>{cardScope}</strong> · {sheetCount} sheet{sheetCount === 1 ? '' : 's'} on record · latest {latestDate}</>
          : 'No sheets yet — upload your first daily sheet'}
      </div>

      <div className="cards">
        <Card label="Total In" value={`$${fmt(cards.total_in)}`} delta={delta('total_in')} noun={noun} />
        <Card label="Total Out" value={`$${fmt(cards.total_out)}`} delta={delta('total_out')} noun={noun} invert />
        <Card label="Meter Profit" value={signedMoney(cards.meter_profit)} tone={cards.meter_profit >= 0 ? 'good' : 'bad'} delta={delta('meter_profit')} noun={noun} />
        <Card label="Cash Profit" value={signedMoney(cards.cash_profit)} tone={cards.cash_profit == null ? '' : cards.cash_profit >= 0 ? 'good' : 'bad'} delta={delta('cash_profit')} noun={noun} />
        <Card label="Over / Short" value={signedMoney(cards.over_short)} tone={cards.over_short == null ? '' : cards.over_short >= 0 ? 'good' : 'bad'} delta={delta('over_short')} noun={noun} />
        <Card label="Hold %" value={cards.hold_pct != null ? `${cards.hold_pct}%` : '—'} />
      </div>

      <div className="panel">
        <h2>Alerts — {scopeLabel || 'no data'}</h2>
        {alerts.length ? (
          <div className="alert-list">
            {alerts.map((a, i) => (
              <div key={i} className={`alert-item ${a.level}`}>
                <span className={`badge ${a.level}`}>{a.level}</span>
                {a.machine ? <Link to={`/machines/${a.machine}`}>{a.message}</Link> : a.message}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No alerts {scopeLabel} — all clear ✅</p>
        )}
      </div>

      <div className="panel">
        <h2>Profit trend {isAll ? 'by day' : `by ${noun}`}</h2>
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
        ) : <p className="muted">Upload sheets to see the trend.</p>}
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>In vs out {isAll ? 'by day' : `by ${noun}`}</h2>
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
          <h2>Expenses — {scopeLabel || 'no data'}</h2>
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
          ) : <p className="muted">No expenses recorded {scopeLabel}.</p>}
          <p className="muted" style={{ fontSize: 12 }}>Match play {scopeLabel}: ${fmt(match)}</p>
        </div>
      </div>

      {deadMachines.length > 0 && (
        <div className="panel">
          <h2>Machines with no play — {scopeLabel}</h2>
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

function Card({ label, value, tone, delta, noun, invert }) {
  let deltaEl = null;
  if (delta != null && noun) {
    const good = invert ? delta < 0 : delta >= 0;
    deltaEl = (
      <div className={`card-delta ${good ? 'pos' : 'neg'}`}>
        {delta >= 0 ? '▲' : '▼'} {signedMoney(Math.abs(delta))} vs prev {noun}
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
