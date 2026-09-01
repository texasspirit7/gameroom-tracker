import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { api, fmt, signedMoney } from '../api.js';
import { CHART, axisProps, tooltipProps } from '../chartTheme.js';
import { useDateRange } from '../DateRangeContext.jsx';
import CabinetCard, { netBounds } from '../components/CabinetCard.jsx';

const weekday = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

export default function Dashboard() {
  const { from, to, label, preset } = useDateRange();
  const navigate = useNavigate();
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

  const {
    totals, previous, buckets, alerts, expenses, otherExpensesTotal,
    recentSheets = [], topMachines = [], range, chartGranularity, latestDate, weeklyTrend = [],
  } = data;
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

      <div className="meterbank">
        <Meter label="Total In" value={totals.total_in} delta={delta('total_in')} />
        <Meter label="Total Out" value={totals.total_out} delta={delta('total_out')} invert />
        <Meter label="Match" value={totals.match} delta={delta('match')} invert />
        <Meter label="Expenses" value={totals.expenses_total} delta={delta('expenses_total')} invert />
        <Meter label="Meter Profit" value={totals.meter_profit} signed toned delta={delta('meter_profit')} />
        <Meter label="Net Profit" value={totals.net_profit} signed toned delta={delta('net_profit')} />
      </div>

      {recentSheets.length > 0 && (
        <div className="panel">
          <h2>
            Recent sheets
            <span className="panel-count">{recentSheets.length} most recent · click to open</span>
          </h2>
          <div className="cabs fixed-3">
            {recentSheets.map((s) => (
              <div
                key={s.id}
                className="cab"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/sheets/${s.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/sheets/${s.id}`); }
                }}
              >
                <div className="cab-plate">
                  <span className="cab-no">{s.sheet_date}</span>
                  <span className="cab-state dead">{weekday(s.sheet_date)}</span>
                </div>
                <div className="cab-body">
                  <div className="cab-fig"><span>Total In</span><span>${fmt(s.total_in)}</span></div>
                  <div className="cab-fig"><span>Total Out</span><span>${fmt(s.total_out)}</span></div>
                  <div className="cab-fig"><span>Match</span><span>${fmt(s.match_amount)}</span></div>
                  <div className="cab-fig"><span>Expenses</span><span>${fmt(s.expenses)}</span></div>
                  <div className="cab-fig cab-fig-total">
                    <span>Net Profit</span>
                    <span className={s.net_profit >= 0 ? 'pos' : 'neg'}>{signedMoney(s.net_profit)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
        <h2>
          Profit trend by week
          {/* Says "last N" only when the window is genuinely the full lookback — once it's
              clamped to the first sheet on record, "last 9 weeks" would be misleading. */}
          <span className="panel-count">
            {weeklyTrend.length >= 12 ? 'last 12 weeks' : `since ${weeklyTrend[0]?.label.split('–')[0] ?? 'the start'}`} · Mon–Sun
          </span>
        </h2>
        {weeklyTrend.some((w) => w.net_profit || w.expenses) ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={weeklyTrend} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip formatter={(v) => `$${fmt(v)}`} {...tooltipProps} />
              <Legend />
              <ReferenceLine y={0} stroke={CHART.zero} />
              <Line type="monotone" dataKey="net_profit" name="Net Profit" stroke={CHART.netProfit} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="expenses" name="Expenses" stroke={CHART.expenses} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <p className="muted">Nothing recorded yet.</p>}
      </div>

      <div className="panel">
        <h2>Profit trend by {chartNoun}</h2>
        {hasData ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={buckets} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip formatter={(v) => `$${fmt(v)}`} {...tooltipProps} />
              <Legend />
              <ReferenceLine y={0} stroke={CHART.zero} />
              {/* Net profit and expenses only — in/out/match/meter crowded the axis and are
                  already broken out in the panels below. */}
              <Line type="monotone" dataKey="net_profit" name="Net Profit" stroke={CHART.netProfit} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="expenses" name="Expenses" stroke={CHART.expenses} strokeWidth={2} dot={{ r: 3 }} />
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
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip formatter={(v) => `$${fmt(v)}`} {...tooltipProps} />
                <Legend />
                <Bar dataKey="total_in" name="In" fill={CHART.in} radius={[3, 3, 0, 0]} />
                <Bar dataKey="total_out" name="Out" fill={CHART.out} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="muted">No data yet.</p>}
        </div>

        <div className="panel">
          <h2>Expenses — {range.label} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(sheet + <Link to="/expenses">manual</Link>)</span></h2>
          {expenses.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={expenses} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" {...axisProps} />
                <YAxis type="category" dataKey="category" width={80} {...axisProps} />
                <Tooltip formatter={(v) => `$${fmt(v)}`} {...tooltipProps} />
                <Bar dataKey="amount" fill={CHART.expenses} radius={[0, 3, 3, 0]}>
                  {expenses.map((e, i) => <Cell key={i} fill={i % 2 ? CHART.accent : CHART.expenses} />)}
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

      {topMachines.length > 0 && (
        <div className="panel">
          <h2>
            Top performers — {range.label}
            <span className="panel-count">
              best {topMachines.length} by net · <Link to="/machines">all machines</Link>
            </span>
          </h2>
          <div className="cabs fixed-5">
            {topMachines.map((m) => (
              <CabinetCard
                key={m.machine_number}
                machine={m}
                bounds={netBounds(topMachines)}
                onOpen={(n) => navigate(`/machines/${n}`)}
              />
            ))}
          </div>
        </div>
      )}

    </>
  );
}

/** Admin-only: the nightly database snapshots, with an on-demand button and download links. */




/**
 * Rolls a figure up from zero once on load, and between values when the date range changes.
 * One orchestrated moment rather than scattered animation — and it sits out entirely when the
 * viewer prefers reduced motion, landing on the final number immediately.
 */
function useCountUp(target, duration = 700) {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const to = Number(target) || 0;
    const snapToTarget = () => { fromRef.current = to; setShown(to); };

    // Browsers don't deliver animation frames to a hidden tab, so an animated count-up would
    // sit frozen on its starting value — which on a money dashboard reads as "$0 earned",
    // not "still loading". Skip the animation and show the real figure.
    if (document.visibilityState === 'hidden'
        || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      snapToTarget();
      return undefined;
    }
    const from = fromRef.current;
    if (from === to) return undefined;

    let raf;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setShown(from + (to - from) * eased);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    raf = requestAnimationFrame(tick);
    // Backstop for frames drying up mid-run — the tab being hidden partway, or heavy
    // throttling. Landing on the true number matters more than the animation finishing.
    const backstop = setTimeout(snapToTarget, duration + 250);
    return () => { cancelAnimationFrame(raf); clearTimeout(backstop); };
  }, [target, duration]);

  return shown;
}

/** One readout in the meter bank. `signed` shows +/-, `toned` colours it by profit/loss. */
function Meter({ label, value, signed, toned, delta, invert }) {
  const shown = useCountUp(value);
  const tone = toned ? (value >= 0 ? 'good' : 'bad') : '';
  const text = signed ? signedMoney(shown) : `$${fmt(shown)}`;

  let deltaEl = null;
  if (delta != null) {
    const good = invert ? delta < 0 : delta >= 0;
    deltaEl = (
      <div className={`d ${good ? 'pos' : 'neg'}`}>
        {delta >= 0 ? '▲' : '▼'} {signedMoney(Math.abs(delta))} vs prev
      </div>
    );
  }

  return (
    <div className="meter" style={tone ? { '--tone': `var(--${tone})` } : undefined}>
      <div className="k">{label}</div>
      <div className={`v ${tone}`}>{text}</div>
      {deltaEl}
    </div>
  );
}
