import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { api, fmt, signedMoney } from '../api.js';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.dashboard().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted"><span className="spinner" />Loading dashboard…</p>;

  const { totals, trend, expenses, alerts, deadMachines, sheetCount, latestDate } = data;
  const hasData = sheetCount > 0;

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <div className="page-sub">
        {hasData ? `${sheetCount} daily sheet${sheetCount === 1 ? '' : 's'} · latest ${latestDate}` : 'No sheets yet — upload your first daily sheet'}
      </div>

      <div className="cards">
        <Card label="Total In" value={`$${fmt(totals.total_in)}`} />
        <Card label="Total Out" value={`$${fmt(totals.total_out)}`} />
        <Card label="Meter Profit" value={signedMoney(totals.meter_profit)} tone={totals.meter_profit >= 0 ? 'good' : 'bad'} />
        <Card label="Cash Profit" value={signedMoney(totals.cash_profit)} tone={totals.cash_profit >= 0 ? 'good' : 'bad'} />
        <Card label="Over / Short" value={signedMoney(totals.over_short)} tone={totals.over_short >= 0 ? 'good' : 'bad'} />
        <Card label="Hold %" value={totals.hold_pct != null ? `${totals.hold_pct}%` : '—'} />
      </div>

      {alerts.length > 0 && (
        <div className="panel">
          <h2>Alerts — latest sheet</h2>
          <div className="alert-list">
            {alerts.map((a, i) => (
              <div key={i} className={`alert-item ${a.level}`}>
                <span className={`badge ${a.level}`}>{a.level}</span>
                {a.machine ? <Link to={`/machines/${a.machine}`}>{a.message}</Link> : a.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Daily profit trend</h2>
        {hasData ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e8f0" />
              <XAxis dataKey="sheet_date" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => `$${fmt(v)}`} />
              <Legend />
              <ReferenceLine y={0} stroke="#999" />
              <Line type="monotone" dataKey="meter_profit" name="Meter profit" stroke="#0f6dd1" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="cash_profit" name="Cash profit" stroke="#16803c" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="over_short" name="Over/Short" stroke="#c22f2f" strokeDasharray="5 4" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <p className="muted">Upload sheets to see the trend.</p>}
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Daily in vs out</h2>
          {hasData ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e8f0" />
                <XAxis dataKey="sheet_date" fontSize={12} />
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
          <h2>Expenses</h2>
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
          ) : <p className="muted">No expenses recorded yet.</p>}
          <p className="muted" style={{ fontSize: 12 }}>Match play total: ${fmt(totals.match)}</p>
        </div>
      </div>

      {deadMachines.length > 0 && (
        <div className="panel">
          <h2>Dead machines (no play across all sheets)</h2>
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

function Card({ label, value, tone }) {
  return (
    <div className={`card ${tone || ''}`}>
      <div className="label">{label}</div>
      <div className={`value ${tone || ''}`}>{value}</div>
    </div>
  );
}
