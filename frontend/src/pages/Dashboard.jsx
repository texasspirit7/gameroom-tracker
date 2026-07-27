import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { api, fmt, signedMoney } from '../api.js';
import { CHART, axisProps, tooltipProps } from '../chartTheme.js';
import { useDateRange } from '../DateRangeContext.jsx';
import { useAuth } from '../AuthContext.jsx';
import CabinetCard from '../components/CabinetCard.jsx';

const weekday = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

export default function Dashboard() {
  const { from, to, label, preset } = useDateRange();
  const { isAdmin, authEnabled } = useAuth();
  const canModify = !authEnabled || isAdmin;
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [audit, setAudit] = useState(null);
  const [activityMaxH, setActivityMaxH] = useState(null);
  const activityRef = useRef(null);

  useEffect(() => {
    setData(null);
    const params = preset === 'allTime'
      ? ''
      : `?from=${from}&to=${to}&label=${encodeURIComponent(label)}`;
    api.dashboard(params).then(setData).catch((e) => setError(e.message));
  }, [from, to, label, preset]);

  // Pulled deeper than what's visible — the list shows ACTIVITY_VISIBLE rows and scrolls for the rest.
  useEffect(() => { api.auditLog(50).then(setAudit).catch(() => setAudit([])); }, []);

  // Cap the activity list at exactly ACTIVITY_VISIBLE rows. Measured rather than a fixed
  // pixel height because rows are variable — an entry with a `detail` line is taller than one
  // without. offsetTop is used (not getBoundingClientRect) so re-measuring stays correct even
  // when the list is already scrolled.
  //
  // `data` is a dependency as well as `audit`: the activity list only exists in the DOM once
  // the dashboard body renders, and /api/audit (a small LIMIT query) normally resolves before
  // /api/dashboard (many aggregations). Keyed on `audit` alone, the effect fired while the ref
  // was still null and never ran again once the list mounted, so the list rendered uncapped.
  useLayoutEffect(() => {
    const el = activityRef.current;
    if (!el) return undefined;
    const measure = () => {
      const items = el.children;
      if (items.length <= ACTIVITY_VISIBLE) { setActivityMaxH(null); return; }
      const last = items[ACTIVITY_VISIBLE - 1];
      setActivityMaxH(last.offsetTop + last.offsetHeight - items[0].offsetTop);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [audit, data]);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted"><span className="spinner" />Loading dashboard…</p>;

  const {
    totals, previous, buckets, alerts, expenses, otherExpensesTotal, deadMachines,
    recentSheets = [], topMachines = [], range, chartGranularity, latestDate,
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
              <Line type="monotone" dataKey="total_in" name="Total In" stroke={CHART.totalIn} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="total_out" name="Total Out" stroke={CHART.totalOut} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="match" name="Match" stroke={CHART.match} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="expenses" name="Expenses" stroke={CHART.expenses} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="meter_profit" name="Meter Profit" stroke={CHART.meterProfit} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="net_profit" name="Net Profit" stroke={CHART.netProfit} strokeWidth={2} dot={{ r: 3 }} />
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
              <CabinetCard key={m.machine_number} machine={m} onOpen={(n) => navigate(`/machines/${n}`)} />
            ))}
          </div>
        </div>
      )}

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

          {canModify && <BackupsSection />}
        </div>

        <div className="panel">
          <h2>
            Recent Activity
            {audit && audit.length > ACTIVITY_VISIBLE && (
              <span className="panel-count">{audit.length} logged · scroll for more</span>
            )}
          </h2>
          {!audit ? (
            <p className="muted"><span className="spinner" />Loading…</p>
          ) : audit.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No activity recorded yet.</p>
          ) : (
            <ul
              className={`activity-list${activityMaxH ? ' scrollable' : ''}`}
              ref={activityRef}
              style={activityMaxH ? { maxHeight: activityMaxH } : undefined}
            >
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

/** Admin-only: the nightly database snapshots, with an on-demand button and download links. */
function BackupsSection() {
  const [backups, setBackups] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () => api.backups().then(setBackups).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const backUpNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createBackup();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const latest = backups?.[0];

  return (
    <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>Database backups</strong>
        <button className="secondary row-action" onClick={backUpNow} disabled={busy}>
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
      </div>
      {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
        {!backups
          ? 'Loading…'
          : latest
            ? <>Runs nightly, keeping the last 14. Latest: {new Date(latest.created_at).toLocaleString()} ({Math.round(latest.size / 1024)} KB).</>
            : 'No snapshots yet — the first one is written shortly after the server starts.'}
      </p>
      {backups && backups.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {backups.slice(0, 3).map((b) => (
            <a key={b.name} className="btn secondary row-action" href={api.backupUrl(b.name)} download>
              {b.created_at.slice(0, 10)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const ACTION_LABEL = { created: 'Uploaded', edited: 'Edited', verified: 'Verified', deleted: 'Deleted' };

/** How many activity rows stay visible before the list starts scrolling. */
const ACTIVITY_VISIBLE = 4;

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
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = to;
      setShown(to);
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
    return () => cancelAnimationFrame(raf);
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
