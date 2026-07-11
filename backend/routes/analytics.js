import { Router } from 'express';
import { db } from '../db.js';
import { adminGate } from '../auth.js';

export const analyticsRouter = Router();

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Monday-first order, for readability
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const addDaysISO = (iso, delta) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const weekStartISO = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const shortDate = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/** Every sheet with its net profit (meter profit minus that sheet's own logged expenses). */
function sheetsWithNetProfit() {
  return db.prepare(`
    SELECT s.id, s.sheet_date, s.total_in, s.total_out, s.meter_profit,
           COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.sheet_id = s.id), 0) AS sheet_expenses
    FROM sheets s
  `).all().map((s) => ({ ...s, net_profit: s.meter_profit - s.sheet_expenses }));
}

function summarize(key, label, sheets) {
  const n = sheets.length;
  const sum = (f) => sheets.reduce((acc, s) => acc + (s[f] || 0), 0);
  return {
    key,
    label,
    sheet_count: n,
    avg_total_in: n ? sum('total_in') / n : 0,
    avg_total_out: n ? sum('total_out') / n : 0,
    avg_meter_profit: n ? sum('meter_profit') / n : 0,
    avg_net_profit: n ? sum('net_profit') / n : 0,
  };
}

function machineAverages(sheetIds) {
  if (!sheetIds.length) return [];
  const placeholders = sheetIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT machine_number, COUNT(*) AS reading_count,
           AVG(daily_in) AS avg_daily_in, AVG(daily_out) AS avg_daily_out
    FROM machine_readings
    WHERE sheet_id IN (${placeholders})
    GROUP BY machine_number
    ORDER BY (AVG(daily_in) - AVG(daily_out)) DESC
  `).all(...sheetIds).map((r) => ({ ...r, avg_net: r.avg_daily_in - r.avg_daily_out }));
}

// GET /api/analytics/weekday — average performance for each day of the week, across all history
analyticsRouter.get('/weekday', adminGate, (req, res) => {
  const sheets = sheetsWithNetProfit();
  const byDay = new Map();
  for (const s of sheets) {
    const wd = new Date(`${s.sheet_date}T00:00:00Z`).getUTCDay();
    if (!byDay.has(wd)) byDay.set(wd, []);
    byDay.get(wd).push(s);
  }
  const result = WEEKDAY_ORDER
    .filter((wd) => byDay.has(wd))
    .map((wd) => summarize(String(wd), WEEKDAY_LABELS[wd], byDay.get(wd)));
  res.json(result);
});

// GET /api/analytics/weekday/:day/machines — per-machine averages for all sheets on that weekday
analyticsRouter.get('/weekday/:day/machines', adminGate, (req, res) => {
  const day = Number(req.params.day);
  const sheetIds = db.prepare('SELECT id, sheet_date FROM sheets').all()
    .filter((s) => new Date(`${s.sheet_date}T00:00:00Z`).getUTCDay() === day)
    .map((s) => s.id);
  res.json(machineAverages(sheetIds));
});

// GET /api/analytics/week — average/total performance per calendar week, most recent first
analyticsRouter.get('/week', adminGate, (req, res) => {
  const sheets = sheetsWithNetProfit();
  const byWeek = new Map();
  for (const s of sheets) {
    const key = weekStartISO(s.sheet_date);
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(s);
  }
  const result = [...byWeek.entries()]
    .map(([key, list]) => summarize(key, `${shortDate(key)} – ${shortDate(addDaysISO(key, 6))}`, list))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
  res.json(result);
});

// GET /api/analytics/week/:weekStart/machines
analyticsRouter.get('/week/:weekStart/machines', adminGate, (req, res) => {
  const { weekStart } = req.params;
  const weekEnd = addDaysISO(weekStart, 6);
  const sheetIds = db.prepare('SELECT id FROM sheets WHERE sheet_date BETWEEN ? AND ?').all(weekStart, weekEnd).map((s) => s.id);
  res.json(machineAverages(sheetIds));
});

// GET /api/analytics/month — average/total performance per calendar month, most recent first
analyticsRouter.get('/month', adminGate, (req, res) => {
  const sheets = sheetsWithNetProfit();
  const byMonth = new Map();
  for (const s of sheets) {
    const key = s.sheet_date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(s);
  }
  const result = [...byMonth.entries()]
    .map(([key, list]) => summarize(key, `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, list))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
  res.json(result);
});

// GET /api/analytics/month/:month/machines  (month = YYYY-MM)
analyticsRouter.get('/month/:month/machines', adminGate, (req, res) => {
  const { month } = req.params;
  const sheetIds = db.prepare("SELECT id FROM sheets WHERE strftime('%Y-%m', sheet_date) = ?").all(month).map((s) => s.id);
  res.json(machineAverages(sheetIds));
});

// GET /api/analytics/day-of-month — average performance for each day-of-month (1-31), across all history.
// Looks for a "payday effect" — spikes around common pay dates (1st, 15th, end of month).
analyticsRouter.get('/day-of-month', adminGate, (req, res) => {
  const sheets = sheetsWithNetProfit();
  const byDay = new Map();
  for (const s of sheets) {
    const dom = Number(s.sheet_date.slice(8, 10));
    if (!byDay.has(dom)) byDay.set(dom, []);
    byDay.get(dom).push(s);
  }
  const result = [...byDay.keys()]
    .sort((a, b) => a - b)
    .map((dom) => summarize(String(dom), String(dom), byDay.get(dom)));
  res.json(result);
});

// GET /api/analytics/day-of-month/:day/machines
analyticsRouter.get('/day-of-month/:day/machines', adminGate, (req, res) => {
  const dom = Number(req.params.day);
  const sheetIds = db.prepare('SELECT id, sheet_date FROM sheets').all()
    .filter((s) => Number(s.sheet_date.slice(8, 10)) === dom)
    .map((s) => s.id);
  res.json(machineAverages(sheetIds));
});

const PAY_PERIODS = [
  { key: 'early', label: 'Early month (1–10)', test: (d) => d >= 1 && d <= 10 },
  { key: 'mid', label: 'Mid month (11–20)', test: (d) => d >= 11 && d <= 20 },
  { key: 'late', label: 'Late month (21–31)', test: (d) => d >= 21 },
];

// GET /api/analytics/pay-period — same idea as day-of-month, rolled up into thirds of the month
// (less sparse than exact day-of-month once history is short).
analyticsRouter.get('/pay-period', adminGate, (req, res) => {
  const sheets = sheetsWithNetProfit();
  const result = PAY_PERIODS.map((p) => {
    const dayOf = (s) => Number(s.sheet_date.slice(8, 10));
    return summarize(p.key, p.label, sheets.filter((s) => p.test(dayOf(s))));
  });
  res.json(result);
});

// GET /api/analytics/pay-period/:period/machines
analyticsRouter.get('/pay-period/:period/machines', adminGate, (req, res) => {
  const period = PAY_PERIODS.find((p) => p.key === req.params.period);
  if (!period) return res.status(400).json({ error: 'Unknown pay period' });
  const sheetIds = db.prepare('SELECT id, sheet_date FROM sheets').all()
    .filter((s) => period.test(Number(s.sheet_date.slice(8, 10))))
    .map((s) => s.id);
  res.json(machineAverages(sheetIds));
});

// GET /api/analytics/leaderboard — cumulative all-time performance per machine, best first.
// Unlike the per-period drill-downs above, this looks at each machine's whole tracked history —
// answers "which machines are actually worth keeping" rather than "who did well this Monday."
analyticsRouter.get('/leaderboard', adminGate, (req, res) => {
  const rows = db.prepare(`
    SELECT machine_number, COUNT(*) AS reading_count,
           SUM(daily_in) AS total_in, SUM(daily_out) AS total_out,
           AVG(daily_in) AS avg_daily_in, AVG(daily_out) AS avg_daily_out
    FROM machine_readings
    GROUP BY machine_number
    ORDER BY (SUM(daily_in) - SUM(daily_out)) DESC
  `).all();
  res.json(rows.map((r) => ({
    ...r,
    total_net: r.total_in - r.total_out,
    avg_net: r.avg_daily_in - r.avg_daily_out,
  })));
});

// GET /api/analytics/trend — daily net profit history + 7-day trailing average + a simple linear
// projection for the next day. Modest by design: one projected point, not a multi-day forecast —
// a handful of noisy daily numbers doesn't support more than that.
analyticsRouter.get('/trend', adminGate, (req, res) => {
  const sheets = sheetsWithNetProfit();
  const byDate = new Map();
  for (const s of sheets) {
    byDate.set(s.sheet_date, (byDate.get(s.sheet_date) || 0) + s.net_profit);
  }
  const dates = [...byDate.keys()].sort();
  const values = dates.map((d) => byDate.get(d));

  const WINDOW = 7;
  const daily = dates.map((date, i) => {
    const windowVals = values.slice(Math.max(0, i - WINDOW + 1), i + 1);
    const moving_avg = windowVals.reduce((a, b) => a + b, 0) / windowVals.length;
    return { date, net_profit: values[i], moving_avg };
  });

  let slope = 0, projected_next = null, direction = 'flat';
  const n = values.length;
  if (n >= 2) {
    const xs = values.map((_, i) => i);
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((acc, x, i) => acc + x * values[i], 0);
    const sumXX = xs.reduce((acc, x) => acc + x * x, 0);
    const denom = n * sumXX - sumX * sumX;
    slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;
    projected_next = slope * n + intercept;
    direction = slope > 1 ? 'up' : slope < -1 ? 'down' : 'flat';
  }

  res.json({ daily, slope, projected_next, direction, days_tracked: n });
});
