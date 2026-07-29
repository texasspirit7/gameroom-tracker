import { Router } from 'express';
import { db } from '../db.js';
import { adminGate } from '../auth.js';

export const profitSplitRouter = Router();

const MONTH_RE = /^\d{4}-\d{2}$/;
const SPLIT_A = 0.4; // 40% — the recouping side
const SPLIT_B = 0.6; // 60%

/**
 * Money the 40% side takes in full before the split starts. Every month's net profit goes
 * entirely to them — however many months that takes — until this much has been received;
 * only what's left over that month, and every month after, is split 40/60.
 */
const RECOUP_TARGET = 30000;

function monthsBetween(start, end) {
  const months = [];
  let [y, m] = start.split('-').map(Number);
  const [endY, endM] = end.split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

/** One row per month since tracking began, most recent first — shared by the
 * GET route and the CSV export so both compute net profit/split the same way. */
export function buildProfitSplitRows() {
  const meterByMonth = db.prepare(`
    SELECT strftime('%Y-%m', sheet_date) AS month, COALESCE(SUM(meter_profit), 0) AS mp
    FROM sheets GROUP BY month
  `).all();
  const sheetExpByMonth = db.prepare(`
    SELECT strftime('%Y-%m', s.sheet_date) AS month, COALESCE(SUM(e.amount), 0) AS exp
    FROM expenses e JOIN sheets s ON s.id = e.sheet_id GROUP BY month
  `).all();
  const otherExpByMonth = db.prepare(`
    SELECT strftime('%Y-%m', expense_date) AS month, COALESCE(SUM(amount), 0) AS exp
    FROM other_expenses GROUP BY month
  `).all();
  const paidRows = db.prepare('SELECT month, paid, paid_at, paid_by, notes FROM profit_splits').all();

  const netByMonth = new Map();
  for (const r of meterByMonth) netByMonth.set(r.month, (netByMonth.get(r.month) || 0) + r.mp);
  for (const r of sheetExpByMonth) netByMonth.set(r.month, (netByMonth.get(r.month) || 0) - r.exp);
  for (const r of otherExpByMonth) netByMonth.set(r.month, (netByMonth.get(r.month) || 0) - r.exp);

  const paidByMonth = new Map(paidRows.map((r) => [r.month, r]));

  const months = [...netByMonth.keys()];
  if (months.length === 0) return [];

  const thisMonth = new Date().toISOString().slice(0, 7);
  const start = months.sort()[0];
  const end = thisMonth > start ? thisMonth : start;

  // Walked oldest-first because the recoup carries forward: what a month splits depends on how
  // much has already been recovered before it. Reversed at the end for display.
  let recovered = 0;
  const rows = monthsBetween(start, end).map((month) => {
    const net = netByMonth.get(month) || 0;
    const outstanding = Math.max(0, RECOUP_TARGET - recovered);

    // While money is still owed, the whole month sits with the 40% side — a losing month
    // included, so `recovered` stays an honest tally of what has actually been received
    // rather than only counting the good months.
    const recoupAmount = outstanding > 0 ? Math.min(net, outstanding) : 0;
    recovered = Math.max(0, recovered + recoupAmount);

    // Whatever the recoup didn't claim is what the 40/60 applies to.
    const splitBase = net - recoupAmount;
    const paidRow = paidByMonth.get(month);

    return {
      month,
      net_profit: net,
      split_label: outstanding > 0 ? 'recoup' : '40/60',
      recoup_amount: recoupAmount,
      split_base: splitBase,
      recovered_to_date: recovered,
      recoup_target: RECOUP_TARGET,
      recoup_remaining: Math.max(0, RECOUP_TARGET - recovered),
      amount_40: recoupAmount + splitBase * SPLIT_A,
      amount_60: splitBase * SPLIT_B,
      paid: Boolean(paidRow?.paid),
      paid_at: paidRow?.paid_at || null,
      paid_by: paidRow?.paid_by || null,
      notes: paidRow?.notes || '',
    };
  });

  rows.sort((a, b) => (a.month < b.month ? 1 : -1));
  return rows;
}

/** GET /api/profit-split — one row per month since tracking began, most recent first. */
profitSplitRouter.get('/', adminGate, (req, res) => {
  res.json(buildProfitSplitRows());
});

/** PATCH /api/profit-split/:month  { paid?: boolean, notes?: string } — either field independently. */
profitSplitRouter.patch('/:month', adminGate, (req, res) => {
  const { month } = req.params;
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'Invalid month' });

  const hasPaid = req.body?.paid !== undefined;
  const hasNotes = req.body?.notes !== undefined;
  if (!hasPaid && !hasNotes) return res.status(400).json({ error: 'Nothing to update' });

  const existing = db.prepare('SELECT paid, paid_at, paid_by, notes FROM profit_splits WHERE month = ?').get(month);
  const paid = hasPaid ? Boolean(req.body.paid) : Boolean(existing?.paid);
  const paidBy = hasPaid ? (req.user?.email || null) : (existing?.paid_by || null);
  const paidAt = hasPaid ? (paid ? new Date().toISOString() : null) : (existing?.paid_at || null);
  const notes = hasNotes ? String(req.body.notes).slice(0, 2000) : (existing?.notes || null);

  db.prepare(`
    INSERT INTO profit_splits (month, paid, paid_at, paid_by, notes) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(month) DO UPDATE SET paid = excluded.paid, paid_at = excluded.paid_at, paid_by = excluded.paid_by, notes = excluded.notes
  `).run(month, paid ? 1 : 0, paidAt, paidBy, notes);

  res.json({ ok: true, month, paid, paid_at: paidAt, paid_by: paidBy, notes: notes || '' });
});
