import { Router } from 'express';
import { db } from '../db.js';

export const dashboardRouter = Router();
export const machinesRouter = Router();

const holdPct = (dIn, dOut) => (dIn > 0 ? Math.round(((dIn - dOut) / dIn) * 100) : null);
const GRANULARITIES = new Set(['day', 'week', 'month', 'all']);

/** Bucket key for a YYYY-MM-DD date at a granularity (week = Monday start date). */
function bucketKey(dateStr, g) {
  if (g === 'month') return dateStr.slice(0, 7);
  if (g === 'week') {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return dateStr;
}

/** Inclusive from/to date range covered by a bucket. */
function bucketRange(key, g) {
  if (g === 'month') {
    const [y, m] = key.split('-').map(Number);
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { from: `${key}-01`, to };
  }
  if (g === 'week') {
    const d = new Date(`${key}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    return { from: key, to: d.toISOString().slice(0, 10) };
  }
  return { from: key, to: key };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

function bucketLabel(key, g) {
  if (g === 'month') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  if (g === 'week') {
    const { to } = bucketRange(key, g);
    return `${shortDate(key)}–${shortDate(to)}`;
  }
  return key;
}

/** Alerts computed over an aggregated date range (a day, a week, or a month). */
function alertsForRange(from, to, scopeLabel) {
  const alerts = [];

  const agg = db.prepare(`
    SELECT mr.machine_number, SUM(mr.daily_in) AS in_sum, SUM(mr.daily_out) AS out_sum
    FROM machine_readings mr JOIN sheets s ON s.id = mr.sheet_id
    WHERE s.sheet_date BETWEEN ? AND ?
    GROUP BY mr.machine_number ORDER BY mr.machine_number
  `).all(from, to);

  for (const r of agg) {
    const h = holdPct(r.in_sum, r.out_sum);
    if (r.out_sum >= 1000 && r.out_sum > r.in_sum * 2) {
      alerts.push({
        machine: r.machine_number, level: 'high',
        message: `Machine ${r.machine_number} paid out $${r.out_sum.toLocaleString()} against $${r.in_sum.toLocaleString()} played ${scopeLabel}`,
      });
    } else if (r.in_sum === 0 && r.out_sum > 0) {
      alerts.push({
        machine: r.machine_number, level: 'high',
        message: `Machine ${r.machine_number} paid out $${r.out_sum.toLocaleString()} with $0 played ${scopeLabel}`,
      });
    } else if (h != null && h < -100) {
      alerts.push({
        machine: r.machine_number, level: 'medium',
        message: `Machine ${r.machine_number} hold is ${h}% ${scopeLabel} (in $${r.in_sum.toLocaleString()}, out $${r.out_sum.toLocaleString()})`,
      });
    }
  }

  const cash = db.prepare(
    'SELECT SUM(over_short) AS os FROM sheets WHERE sheet_date BETWEEN ? AND ? AND over_short IS NOT NULL'
  ).get(from, to).os;
  if (cash != null && cash <= -100) {
    alerts.unshift({
      machine: null, level: 'high',
      message: `Cash short $${Math.abs(cash).toLocaleString()} ${scopeLabel}`,
    });
  }

  return alerts;
}

// GET /api/dashboard?granularity=day|week|month|all
dashboardRouter.get('/', (req, res) => {
  const g = GRANULARITIES.has(req.query.granularity) ? req.query.granularity : 'all';
  const chartGran = g === 'all' ? 'day' : g;

  const sheets = db.prepare(`
    SELECT id, sheet_date, total_in, total_out, meter_profit, cash_profit, over_short
    FROM sheets ORDER BY sheet_date
  `).all();

  // Group sheets into buckets at the chart granularity
  const map = new Map();
  for (const s of sheets) {
    const key = bucketKey(s.sheet_date, chartGran);
    if (!map.has(key)) {
      map.set(key, {
        period: key, label: bucketLabel(key, chartGran),
        total_in: 0, total_out: 0, meter_profit: 0,
        cash_profit: null, over_short: null, sheet_count: 0,
      });
    }
    const b = map.get(key);
    b.total_in += s.total_in || 0;
    b.total_out += s.total_out || 0;
    b.meter_profit += s.meter_profit || 0;
    if (s.cash_profit != null) b.cash_profit = (b.cash_profit || 0) + s.cash_profit;
    if (s.over_short != null) b.over_short = (b.over_short || 0) + s.over_short;
    b.sheet_count += 1;
  }
  const buckets = [...map.values()].map((b) => ({ ...b, hold_pct: holdPct(b.total_in, b.total_out) }));

  const totals = sheets.reduce(
    (acc, s) => ({
      total_in: acc.total_in + (s.total_in || 0),
      total_out: acc.total_out + (s.total_out || 0),
      meter_profit: acc.meter_profit + (s.meter_profit || 0),
      cash_profit: acc.cash_profit + (s.cash_profit || 0),
      over_short: acc.over_short + (s.over_short || 0),
    }),
    { total_in: 0, total_out: 0, meter_profit: 0, cash_profit: 0, over_short: 0 }
  );
  totals.hold_pct = holdPct(totals.total_in, totals.total_out);
  totals.match = db.prepare('SELECT COALESCE(SUM(match_amount),0) AS m FROM sheets').get().m;

  const latestDate = sheets.length ? sheets[sheets.length - 1].sheet_date : null;

  // Current period (latest bucket) + previous for comparison, and alert/expense scope
  let current = null;
  let previous = null;
  let scope = null;
  if (latestDate) {
    if (g === 'all') {
      scope = { from: '0000-01-01', to: '9999-12-31', label: 'all time' };
    } else {
      current = buckets[buckets.length - 1];
      previous = buckets.length > 1 ? buckets[buckets.length - 2] : null;
      const range = bucketRange(current.period, g);
      const label = g === 'day' ? `on ${current.period}` : `during ${current.label}`;
      scope = { ...range, label };
    }
  }

  const alerts = scope ? alertsForRange(scope.from, scope.to, scope.label) : [];

  const expenses = scope
    ? db.prepare(`
        SELECT e.category, SUM(e.amount) AS amount
        FROM expenses e JOIN sheets s ON s.id = e.sheet_id
        WHERE s.sheet_date BETWEEN ? AND ?
        GROUP BY e.category ORDER BY amount DESC
      `).all(scope.from, scope.to)
    : [];

  const scopedMatch = scope
    ? db.prepare('SELECT COALESCE(SUM(match_amount),0) AS m FROM sheets WHERE sheet_date BETWEEN ? AND ?')
        .get(scope.from, scope.to).m
    : 0;

  const deadMachines = scope
    ? db.prepare(`
        SELECT machine_number FROM machine_readings mr JOIN sheets s ON s.id = mr.sheet_id
        WHERE s.sheet_date BETWEEN ? AND ?
        GROUP BY machine_number HAVING SUM(mr.daily_in) = 0
        ORDER BY machine_number
      `).all(scope.from, scope.to).map((r) => r.machine_number)
    : [];

  res.json({
    granularity: g,
    buckets,
    totals,
    current,
    previous,
    scopeLabel: scope?.label ?? null,
    alerts,
    expenses,
    match: scopedMatch,
    deadMachines,
    sheetCount: sheets.length,
    latestDate,
  });
});

// GET /api/machines?granularity=day|week|month|all — stats scoped to the latest period
machinesRouter.get('/', (req, res) => {
  const g = GRANULARITIES.has(req.query.granularity) ? req.query.granularity : 'all';

  let from = '0000-01-01';
  let to = '9999-12-31';
  let label = 'all time';
  if (g !== 'all') {
    const latest = db.prepare('SELECT MAX(sheet_date) AS d FROM sheets').get().d;
    if (latest) {
      const key = bucketKey(latest, g);
      ({ from, to } = bucketRange(key, g));
      label = g === 'day' ? latest : bucketLabel(key, g);
    }
  }

  const rows = db.prepare(`
    SELECT mr.machine_number,
           COUNT(*) AS days,
           SUM(CASE WHEN mr.daily_in > 0 THEN 1 ELSE 0 END) AS active_days,
           SUM(mr.daily_in) AS total_in,
           SUM(mr.daily_out) AS total_out,
           AVG(mr.daily_in) AS avg_in,
           AVG(mr.daily_out) AS avg_out,
           MAX(mr.daily_out) AS max_out
    FROM machine_readings mr JOIN sheets s ON s.id = mr.sheet_id
    WHERE s.sheet_date BETWEEN ? AND ?
    GROUP BY mr.machine_number ORDER BY mr.machine_number
  `).all(from, to);

  const machines = rows.map((r) => {
    const net = (r.total_in || 0) - (r.total_out || 0);
    const hold = holdPct(r.total_in, r.total_out);
    let flag = null;
    if (r.total_in === 0 && r.total_out === 0) flag = 'dead';
    else if (r.total_in === 0 && r.total_out > 0) flag = 'bleeding';
    else if (hold != null && hold < -50) flag = 'bleeding';
    else if (hold != null && hold < 0) flag = 'negative';
    return { ...r, net, hold_pct: hold, flag };
  });

  res.json({ scope: { granularity: g, from, to, label }, machines });
});

// GET /api/machines/:number — daily series for one machine (full history)
machinesRouter.get('/:number', (req, res) => {
  const n = Number(req.params.number);
  if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: 'Invalid machine number' });

  const series = db.prepare(`
    SELECT s.sheet_date, mr.prev_in, mr.curr_in, mr.daily_in, mr.prev_out, mr.curr_out, mr.daily_out
    FROM machine_readings mr JOIN sheets s ON s.id = mr.sheet_id
    WHERE mr.machine_number = ? ORDER BY s.sheet_date
  `).all(n);

  const totalIn = series.reduce((s, r) => s + r.daily_in, 0);
  const totalOut = series.reduce((s, r) => s + r.daily_out, 0);

  res.json({
    machine_number: n,
    series: series.map((r) => ({ ...r, net: r.daily_in - r.daily_out, hold_pct: holdPct(r.daily_in, r.daily_out) })),
    summary: {
      days: series.length,
      active_days: series.filter((r) => r.daily_in > 0).length,
      total_in: totalIn,
      total_out: totalOut,
      net: totalIn - totalOut,
      hold_pct: holdPct(totalIn, totalOut),
      best_day: series.reduce((b, r) => (r.daily_in - r.daily_out > (b?.net ?? -Infinity) ? { date: r.sheet_date, net: r.daily_in - r.daily_out } : b), null),
      worst_day: series.reduce((w, r) => (r.daily_in - r.daily_out < (w?.net ?? Infinity) ? { date: r.sheet_date, net: r.daily_in - r.daily_out } : w), null),
    },
  });
});
