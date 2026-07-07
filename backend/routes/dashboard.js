import { Router } from 'express';
import { db } from '../db.js';

export const dashboardRouter = Router();
export const machinesRouter = Router();

const holdPct = (dIn, dOut) => (dIn > 0 ? Math.round(((dIn - dOut) / dIn) * 100) : null);

// GET /api/dashboard?from&to
dashboardRouter.get('/', (req, res) => {
  const from = req.query.from || '0000-01-01';
  const to = req.query.to || '9999-12-31';

  const trend = db.prepare(`
    SELECT id, sheet_date, total_in, total_out, meter_profit, cash_profit, over_short, status
    FROM sheets WHERE sheet_date BETWEEN ? AND ? ORDER BY sheet_date
  `).all(from, to);

  const totals = trend.reduce(
    (acc, s) => ({
      total_in: acc.total_in + (s.total_in || 0),
      total_out: acc.total_out + (s.total_out || 0),
      meter_profit: acc.meter_profit + (s.meter_profit || 0),
      cash_profit: acc.cash_profit + (s.cash_profit || 0),
      over_short: acc.over_short + (s.over_short || 0),
    }),
    { total_in: 0, total_out: 0, meter_profit: 0, cash_profit: 0, over_short: 0 }
  );

  const expenseRows = db.prepare(`
    SELECT e.category, SUM(e.amount) AS amount
    FROM expenses e JOIN sheets s ON s.id = e.sheet_id
    WHERE s.sheet_date BETWEEN ? AND ?
    GROUP BY e.category ORDER BY amount DESC
  `).all(from, to);

  const matchTotal = db.prepare(`
    SELECT COALESCE(SUM(match_amount),0) AS m FROM sheets WHERE sheet_date BETWEEN ? AND ?
  `).get(from, to).m;

  // Alerts from the latest sheet: extreme negative hold, big payouts, dead machines
  const latest = trend[trend.length - 1];
  const alerts = [];
  if (latest) {
    const readings = db.prepare(
      'SELECT * FROM machine_readings WHERE sheet_id = ? ORDER BY machine_number'
    ).all(latest.id);
    for (const r of readings) {
      const h = holdPct(r.daily_in, r.daily_out);
      if (r.daily_out > 0 && r.daily_out >= 1000 && r.daily_out > r.daily_in * 2) {
        alerts.push({
          machine: r.machine_number, date: latest.sheet_date, level: 'high',
          message: `Machine ${r.machine_number} paid out $${r.daily_out.toLocaleString()} against $${r.daily_in.toLocaleString()} in`,
        });
      } else if (h != null && h < -100) {
        alerts.push({
          machine: r.machine_number, date: latest.sheet_date, level: 'medium',
          message: `Machine ${r.machine_number} hold is ${h}% (in $${r.daily_in.toLocaleString()}, out $${r.daily_out.toLocaleString()})`,
        });
      }
    }
    if (latest.over_short != null && latest.over_short <= -100) {
      alerts.unshift({
        machine: null, date: latest.sheet_date, level: 'high',
        message: `Cash short $${Math.abs(latest.over_short).toLocaleString()} on ${latest.sheet_date}`,
      });
    }
  }

  // Dead machines: zero daily_in across every sheet in range
  const dead = db.prepare(`
    SELECT machine_number FROM machine_readings mr JOIN sheets s ON s.id = mr.sheet_id
    WHERE s.sheet_date BETWEEN ? AND ?
    GROUP BY machine_number HAVING SUM(mr.daily_in) = 0 AND COUNT(*) >= 2
    ORDER BY machine_number
  `).all(from, to).map((r) => r.machine_number);

  res.json({
    trend: trend.map((s) => ({ ...s, hold_pct: holdPct(s.total_in, s.total_out) })),
    totals: { ...totals, hold_pct: holdPct(totals.total_in, totals.total_out), match: matchTotal },
    expenses: expenseRows,
    alerts,
    deadMachines: dead,
    sheetCount: trend.length,
    latestDate: latest?.sheet_date ?? null,
  });
});

// GET /api/machines — per-machine aggregates across all sheets
machinesRouter.get('/', (req, res) => {
  const from = req.query.from || '0000-01-01';
  const to = req.query.to || '9999-12-31';

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

  res.json(rows.map((r) => {
    const net = (r.total_in || 0) - (r.total_out || 0);
    const hold = holdPct(r.total_in, r.total_out);
    let flag = null;
    if (r.total_in === 0) flag = 'dead';
    else if (hold != null && hold < -50) flag = 'bleeding';
    else if (hold != null && hold < 0) flag = 'negative';
    return { ...r, net, hold_pct: hold, flag };
  }));
});

// GET /api/machines/:number — daily series for one machine
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
