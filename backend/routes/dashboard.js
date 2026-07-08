import { Router } from 'express';
import { db } from '../db.js';

export const dashboardRouter = Router();
export const machinesRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const holdPct = (dIn, dOut) => (dIn > 0 ? Math.round(((dIn - dOut) / dIn) * 100) : null);

const addDays = (iso, delta) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
const chooseGranularity = (spanDays) => (spanDays <= 45 ? 'day' : spanDays <= 210 ? 'week' : 'month');

function bucketKey(dateStr, g) {
  if (g === 'month') return dateStr.slice(0, 7);
  if (g === 'week') {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return dateStr;
}

function bucketRange(key, g) {
  if (g === 'month') {
    const [y, m] = key.split('-').map(Number);
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { from: `${key}-01`, to };
  }
  if (g === 'week') {
    return { from: key, to: addDays(key, 6) };
  }
  return { from: key, to: key };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

function bucketLabel(key, g) {
  if (g === 'month') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  if (g === 'week') return `${shortDate(key)}–${shortDate(bucketRange(key, g).to)}`;
  return shortDate(key);
}

/** Parses & validates from/to query params. Returns { from, to, allTime, label }. */
function resolveRange(req) {
  const { from, to, label } = req.query;
  if (from && to && DATE_RE.test(from) && DATE_RE.test(to) && from <= to) {
    return { from, to, allTime: false, label: label ? String(label) : `${from} to ${to}` };
  }
  const sheetBounds = db.prepare('SELECT MIN(sheet_date) AS min, MAX(sheet_date) AS max FROM sheets').get();
  const expenseBounds = db.prepare('SELECT MIN(expense_date) AS min, MAX(expense_date) AS max FROM other_expenses').get();
  const mins = [sheetBounds.min, expenseBounds.min].filter(Boolean);
  const maxs = [sheetBounds.max, expenseBounds.max].filter(Boolean);
  return {
    from: mins.length ? mins.sort()[0] : '0001-01-01',
    to: maxs.length ? maxs.sort().at(-1) : '9999-12-31',
    allTime: true,
    label: label ? String(label) : 'All Time',
  };
}

function aggregate(from, to) {
  const sheets = db.prepare(`
    SELECT id, sheet_date, total_in, total_out, meter_profit, cash_profit, over_short
    FROM sheets WHERE sheet_date BETWEEN ? AND ? ORDER BY sheet_date, id
  `).all(from, to);

  const totals = sheets.reduce(
    (acc, s) => ({
      total_in: acc.total_in + (s.total_in || 0),
      total_out: acc.total_out + (s.total_out || 0),
      meter_profit: acc.meter_profit + (s.meter_profit || 0),
      cash_profit: s.cash_profit != null ? (acc.cash_profit || 0) + s.cash_profit : acc.cash_profit,
      over_short: s.over_short != null ? (acc.over_short || 0) + s.over_short : acc.over_short,
    }),
    { total_in: 0, total_out: 0, meter_profit: 0, cash_profit: null, over_short: null }
  );
  totals.hold_pct = holdPct(totals.total_in, totals.total_out);
  totals.sheet_count = sheets.length;
  totals.match = db.prepare('SELECT COALESCE(SUM(match_amount),0) AS m FROM sheets WHERE sheet_date BETWEEN ? AND ?').get(from, to).m;
  totals.other_expenses = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM other_expenses WHERE expense_date BETWEEN ? AND ?').get(from, to).s;
  totals.sheet_expenses = db.prepare(`
    SELECT COALESCE(SUM(e.amount),0) AS s FROM expenses e JOIN sheets s ON s.id = e.sheet_id
    WHERE s.sheet_date BETWEEN ? AND ?
  `).get(from, to).s;
  totals.expenses_total = totals.sheet_expenses + totals.other_expenses;
  // meter_profit no longer subtracts expenses (see computeMeterProfit) — net_profit
  // subtracts all of them (sheet + other) to get the true bottom line.
  totals.net_profit = totals.meter_profit - totals.expenses_total;

  return { sheets, totals };
}

/** Alerts computed over an aggregated date range. */
function alertsForRange(from, to, label) {
  const alerts = [];
  const suffix = label ? ` — ${label}` : '';

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
        message: `Machine ${r.machine_number} paid out $${r.out_sum.toLocaleString()} against $${r.in_sum.toLocaleString()} played${suffix}`,
      });
    } else if (r.in_sum === 0 && r.out_sum > 0) {
      alerts.push({
        machine: r.machine_number, level: 'high',
        message: `Machine ${r.machine_number} paid out $${r.out_sum.toLocaleString()} with $0 played${suffix}`,
      });
    } else if (h != null && h < -100) {
      alerts.push({
        machine: r.machine_number, level: 'medium',
        message: `Machine ${r.machine_number} hold is ${h}%${suffix} (in $${r.in_sum.toLocaleString()}, out $${r.out_sum.toLocaleString()})`,
      });
    }
  }

  const cash = db.prepare(
    'SELECT SUM(over_short) AS os FROM sheets WHERE sheet_date BETWEEN ? AND ? AND over_short IS NOT NULL'
  ).get(from, to).os;
  if (cash != null && cash <= -100) {
    alerts.unshift({ machine: null, level: 'high', message: `Cash short $${Math.abs(cash).toLocaleString()}${suffix}` });
  }

  return alerts;
}

// GET /api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&label=...
dashboardRouter.get('/', (req, res) => {
  const range = resolveRange(req);
  const { sheets, totals } = aggregate(range.from, range.to);

  let previous = null;
  if (!range.allTime) {
    const span = daysBetween(range.from, range.to);
    const prevTo = addDays(range.from, -1);
    const prevFrom = addDays(prevTo, -(span - 1));
    const prevAgg = aggregate(prevFrom, prevTo);
    if (prevAgg.totals.sheet_count > 0) previous = prevAgg.totals;
  }

  const chartGran = chooseGranularity(daysBetween(range.from, range.to));
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

  const sheetExpenses = db.prepare(`
    SELECT e.category, SUM(e.amount) AS amount
    FROM expenses e JOIN sheets s ON s.id = e.sheet_id
    WHERE s.sheet_date BETWEEN ? AND ?
    GROUP BY e.category
  `).all(range.from, range.to);
  const otherExpenses = db.prepare(`
    SELECT category, SUM(amount) AS amount FROM other_expenses
    WHERE expense_date BETWEEN ? AND ? GROUP BY category
  `).all(range.from, range.to);
  const expenseMap = new Map();
  for (const e of [...sheetExpenses, ...otherExpenses]) {
    expenseMap.set(e.category, (expenseMap.get(e.category) || 0) + e.amount);
  }
  const expenses = [...expenseMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const deadMachines = db.prepare(`
    SELECT machine_number FROM machine_readings mr JOIN sheets s ON s.id = mr.sheet_id
    WHERE s.sheet_date BETWEEN ? AND ?
    GROUP BY machine_number HAVING SUM(mr.daily_in) = 0
    ORDER BY machine_number
  `).all(range.from, range.to).map((r) => r.machine_number);

  const latestDate = db.prepare('SELECT MAX(sheet_date) AS d FROM sheets').get().d;

  res.json({
    range: { from: range.from, to: range.to, label: range.label, allTime: range.allTime },
    totals,
    previous,
    chartGranularity: chartGran,
    buckets,
    alerts: alertsForRange(range.from, range.to, range.label),
    expenses,
    otherExpensesTotal: totals.other_expenses,
    deadMachines,
    latestDate,
  });
});

// GET /api/machines?from=YYYY-MM-DD&to=YYYY-MM-DD&label=...
machinesRouter.get('/', (req, res) => {
  const range = resolveRange(req);

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
  `).all(range.from, range.to);

  const machines = rows.map((r) => {
    const net = (r.total_in || 0) - (r.total_out || 0);
    const hold = holdPct(r.total_in, r.total_out);
    let flag = null;
    if (r.total_in === 0 && r.total_out === 0) flag = 'dead';
    else if (r.total_in === 0 && r.total_out > 0) flag = 'bleeding';
    else if (hold != null && hold < -50) flag = 'bleeding';
    else if (hold != null && hold < 0) flag = 'negative';
    else if (net > 0) flag = 'profit';
    return { ...r, net, hold_pct: hold, flag };
  });

  res.json({ range: { from: range.from, to: range.to, label: range.label, allTime: range.allTime }, machines });
});

// GET /api/machines/meta — machine-number bounds actually present in the data
// (used for prev/next navigation; sheets can have any number of machine rows, not just 40)
machinesRouter.get('/meta', (req, res) => {
  const row = db.prepare('SELECT MIN(machine_number) AS min, MAX(machine_number) AS max, COUNT(DISTINCT machine_number) AS count FROM machine_readings').get();
  res.json({ min: row.min ?? null, max: row.max ?? null, count: row.count ?? 0 });
});

// GET /api/machines/:number — full daily history for one machine (not date-range scoped)
machinesRouter.get('/:number', (req, res) => {
  const n = Number(req.params.number);
  if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: 'Invalid machine number' });

  const series = db.prepare(`
    SELECT s.id AS sheet_id, s.sheet_date, mr.prev_in, mr.curr_in, mr.daily_in, mr.prev_out, mr.curr_out, mr.daily_out
    FROM machine_readings mr JOIN sheets s ON s.id = mr.sheet_id
    WHERE mr.machine_number = ? ORDER BY s.sheet_date, s.id
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
