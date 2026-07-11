import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine, Legend,
} from 'recharts';
import { api, fmt, signedMoney } from '../api.js';

function PeriodSection({ title, columnLabel, description, fetchSummary, fetchMachines }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [machines, setMachines] = useState(null);
  const [machinesLoading, setMachinesLoading] = useState(false);

  useEffect(() => {
    fetchSummary().then(setRows).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = async (row) => {
    if (selectedKey === row.key) {
      setSelectedKey(null);
      setMachines(null);
      return;
    }
    setSelectedKey(row.key);
    setMachines(null);
    setMachinesLoading(true);
    try {
      const data = await fetchMachines(row.key);
      setMachines(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setMachinesLoading(false);
    }
  };

  return (
    <div className="panel">
      <h2>{title}</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 14 }}>{description}</p>
      {error && <div className="error-box">{error}</div>}
      {!rows ? (
        <p className="muted"><span className="spinner" />Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Not enough data yet.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rows} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e8f0" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => `$${fmt(v)}`} />
              <ReferenceLine y={0} stroke="#999" />
              <Bar dataKey="avg_net_profit" name="Avg Net Profit" radius={[3, 3, 0, 0]} onClick={select} cursor="pointer">
                {rows.map((r) => <Cell key={r.key} fill={r.avg_net_profit >= 0 ? '#16803c' : '#c22f2f'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>{columnLabel}</th><th>Sheets</th><th>Avg In</th><th>Avg Out</th>
                <th>Avg Meter Profit</th><th>Avg Net Profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.key}>
                  <tr className="clickable" onClick={() => select(r)}>
                    <td><strong>{r.label}</strong></td>
                    <td>{r.sheet_count}</td>
                    <td>${fmt(r.avg_total_in)}</td>
                    <td>${fmt(r.avg_total_out)}</td>
                    <td className={r.avg_meter_profit >= 0 ? 'pos' : 'neg'}>{signedMoney(r.avg_meter_profit)}</td>
                    <td className={r.avg_net_profit >= 0 ? 'pos' : 'neg'}>{signedMoney(r.avg_net_profit)}</td>
                  </tr>
                  {selectedKey === r.key && (
                    <tr>
                      <td colSpan={6} style={{ background: '#f7f9fd' }}>
                        {machinesLoading ? (
                          <p className="muted" style={{ margin: '10px 0' }}><span className="spinner" />Loading machine averages…</p>
                        ) : machines.length === 0 ? (
                          <p className="muted" style={{ margin: '10px 0' }}>No machine readings in this period.</p>
                        ) : (
                          <table style={{ margin: '8px 0' }}>
                            <thead>
                              <tr><th>Machine</th><th>Readings</th><th>Avg Daily In</th><th>Avg Daily Out</th><th>Avg Net</th></tr>
                            </thead>
                            <tbody>
                              {machines.map((m) => (
                                <tr key={m.machine_number}>
                                  <td>#{m.machine_number}</td>
                                  <td>{m.reading_count}</td>
                                  <td>${fmt(m.avg_daily_in)}</td>
                                  <td>${fmt(m.avg_daily_out)}</td>
                                  <td className={m.avg_net >= 0 ? 'pos' : 'neg'}>{signedMoney(m.avg_net)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function TrendSection() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.analyticsTrend().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="panel"><h2>Profit Trend</h2><div className="error-box">{error}</div></div>;
  if (!data) return <div className="panel"><h2>Profit Trend</h2><p className="muted"><span className="spinner" />Loading…</p></div>;

  const chartData = data.daily.map((d) => ({ ...d, label: shortDate(d.date) }));
  const arrow = data.direction === 'up' ? '▲' : data.direction === 'down' ? '▼' : '→';
  const tone = data.direction === 'up' ? 'pos' : data.direction === 'down' ? 'neg' : '';

  return (
    <div className="panel">
      <h2>Profit Trend</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 14 }}>
        Daily net profit with a 7-day trailing average, and a simple projection for the next day based on the
        overall trend. Treat the projection as a rough signal, not a guarantee — it gets more meaningful with
        more history.
      </p>
      {data.days_tracked < 2 ? (
        <p className="muted">Not enough data yet — need at least 2 days with sheets.</p>
      ) : (
        <>
          <p style={{ fontSize: 14, marginBottom: 12 }}>
            Trend is <strong className={tone}>{arrow} {data.direction}</strong>
            {' '}(~{signedMoney(data.slope)}/day) over {data.days_tracked} tracked day{data.days_tracked === 1 ? '' : 's'}.
            {data.projected_next != null && (
              <> Next day's net profit is projected around <strong className={data.projected_next >= 0 ? 'pos' : 'neg'}>{signedMoney(data.projected_next)}</strong>.</>
            )}
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e8f0" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => `$${fmt(v)}`} />
              <Legend />
              <ReferenceLine y={0} stroke="#999" />
              <Line type="monotone" dataKey="net_profit" name="Daily Net Profit" stroke="#9db6d8" strokeWidth={1.5} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="moving_avg" name="7-day Avg" stroke="#0f6dd1" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}

function LeaderboardSection() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.analyticsLeaderboard().then(setRows).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="panel"><h2>All-Time Machine Leaderboard</h2><div className="error-box">{error}</div></div>;
  if (!rows) return <div className="panel"><h2>All-Time Machine Leaderboard</h2><p className="muted"><span className="spinner" />Loading…</p></div>;

  return (
    <div className="panel">
      <h2>All-Time Machine Leaderboard</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 14 }}>
        Cumulative net (all daily in − all daily out) across each machine's whole tracked history, best first —
        which machines are actually worth keeping, not just who did well recently. Click a row for full history.
      </p>
      {rows.length === 0 ? <p className="muted">Not enough data yet.</p> : (
        <table>
          <thead>
            <tr><th>Machine</th><th>Readings</th><th>Total In</th><th>Total Out</th><th>Total Net (all-time)</th><th>Avg Net / Day</th></tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.machine_number} className="clickable" onClick={() => navigate(`/machines/${m.machine_number}`)}>
                <td><strong>#{m.machine_number}</strong></td>
                <td>{m.reading_count}</td>
                <td>${fmt(m.total_in)}</td>
                <td>${fmt(m.total_out)}</td>
                <td className={m.total_net >= 0 ? 'pos' : 'neg'}>{signedMoney(m.total_net)}</td>
                <td className={m.avg_net >= 0 ? 'pos' : 'neg'}>{signedMoney(m.avg_net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Analytics() {
  return (
    <>
      <h1 className="page-title">Analytics</h1>
      <div className="page-sub">
        Trend, seasonality, and machine-level breakdowns — click any bar or row to drill into the
        per-machine numbers for that period. Use this to spot which days/periods tend to run hot or cold,
        and which machines are actually worth keeping.
      </div>

      <TrendSection />
      <LeaderboardSection />

      <PeriodSection
        title="By Day of Week"
        columnLabel="Day"
        description="Averaged across all history — is one day of the week consistently better or worse?"
        fetchSummary={api.analyticsByWeekday}
        fetchMachines={api.analyticsByWeekdayMachines}
      />
      <PeriodSection
        title="By Day of Month"
        columnLabel="Day of Month"
        description="Looking for a payday effect — spikes around common pay dates (1st, 15th, end of month)."
        fetchSummary={api.analyticsByDayOfMonth}
        fetchMachines={api.analyticsByDayOfMonthMachines}
      />
      <PeriodSection
        title="By Pay Period"
        columnLabel="Period"
        description="Same idea, rolled up into thirds of the month — less sparse than exact day-of-month with limited history."
        fetchSummary={api.analyticsByPayPeriod}
        fetchMachines={api.analyticsByPayPeriodMachines}
      />
      <PeriodSection
        title="By Week"
        columnLabel="Week"
        description="Each calendar week (Mon–Sun), most recent first."
        fetchSummary={api.analyticsByWeek}
        fetchMachines={api.analyticsByWeekMachines}
      />
      <PeriodSection
        title="By Month"
        columnLabel="Month"
        description="Each calendar month, most recent first."
        fetchSummary={api.analyticsByMonth}
        fetchMachines={api.analyticsByMonthMachines}
      />
    </>
  );
}
