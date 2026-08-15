import { Router } from 'express';
import { db } from '../db.js';
import { adminGate } from '../auth.js';
import { logAudit } from './audit.js';

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

/**
 * Sub-cent slack when deciding whether a month is settled. Owed amounts are floats
 * (40% of a split base), so a month paid to the exact dollar can land a fraction of a
 * cent short and would otherwise read "Partial" forever.
 */
const SETTLED_EPSILON = 0.005;

const round2 = (n) => Math.round(n * 100) / 100;

/** Cash plus expense credit — both settle the debt, so they're summed everywhere. */
const receiptTotal = (r) => (r.amount || 0) + (r.expense_credit || 0);

/**
 * How far a payment pool covers one month's entitlement.
 *
 * 'none' is kept distinct from 'covered' so a month that earned nothing doesn't display as
 * an achievement — it had nothing to cover in the first place.
 */
export function coverageOf(owed, applied) {
  if (owed <= SETTLED_EPSILON) return 'none';
  if (applied <= SETTLED_EPSILON) return 'open';
  if (applied + SETTLED_EPSILON >= owed) return 'covered';
  return 'partial';
}

/** Every receipt, newest first. Receipts belong to the account, not to any one month. */
export function listReceipts() {
  return db.prepare('SELECT * FROM profit_receipts ORDER BY received_on DESC, id DESC').all();
}

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
  const receiptRows = db.prepare('SELECT amount, expense_credit FROM profit_receipts').all();
  const receivedTotal = receiptRows.reduce((sum, r) => sum + receiptTotal(r), 0);

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
  let owedRunning = 0;
  // One pool of money drawn down oldest-first. Payments arrive as lump sums that don't line
  // up with month boundaries, so the account carries the balance and each month's coverage
  // falls out of how far the pool reaches.
  let pool = receivedTotal;
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

    // Settlement is layered on top of the split, never fed back into it: `owed` is read from
    // the already-computed entitlement so recording a receipt can't move any month's split.
    const owed = round2(recoupAmount + splitBase * SPLIT_A);
    owedRunning = round2(owedRunning + owed);

    const applied = round2(Math.min(pool, owed));
    pool = round2(Math.max(0, pool - owed));

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
      owed_running: owedRunning,
      applied,
      coverage: coverageOf(owed, applied),
      paid: Boolean(paidRow?.paid),
      paid_at: paidRow?.paid_at || null,
      paid_by: paidRow?.paid_by || null,
      notes: paidRow?.notes || '',
    };
  });

  // Captured before the reverse so they read oldest-first.
  const owedTotal = owedRunning;
  const paidThrough = [...rows].reverse().find((r) => r.coverage === 'covered')?.month || null;

  rows.sort((a, b) => (a.month < b.month ? 1 : -1));
  rows.owedTotal = owedTotal;
  rows.receivedTotal = receivedTotal;
  rows.paidThrough = paidThrough;
  return rows;
}

/**
 * The account: everything earned to date on one side, everything received on the other.
 *
 * `earned` and `received` are tracked apart on purpose — earned drives when the 40/60 starts,
 * received is what has actually landed. A gap between them is the normal state of affairs,
 * not an error.
 */
export function buildAccountSummary(rows) {
  const owedTotal = round2(rows.owedTotal || 0);
  const receivedTotal = round2(rows.receivedTotal || 0);
  const earned = rows.length ? Math.max(...rows.map((r) => r.recovered_to_date)) : 0;

  return {
    owed_total: owedTotal,
    received_total: receivedTotal,
    balance: round2(owedTotal - receivedTotal),
    paid_through: rows.paidThrough,
    recoup: {
      target: RECOUP_TARGET,
      earned: round2(earned),
      // Money settles the oldest debt first, and the recoup is the oldest debt there is,
      // so the pool fills it before anything else.
      received: round2(Math.min(receivedTotal, RECOUP_TARGET)),
      remaining: round2(Math.max(0, RECOUP_TARGET - Math.min(receivedTotal, RECOUP_TARGET))),
      complete: earned >= RECOUP_TARGET,
    },
  };
}

/** GET /api/profit-split — one row per month since tracking began, most recent first, plus
 * the account summary. The summary ships with the rows rather than being derived in the
 * browser so the allocation rules live in exactly one place. */
profitSplitRouter.get('/', adminGate, (req, res) => {
  const rows = buildProfitSplitRows();
  res.json({ rows: [...rows], account: buildAccountSummary(rows) });
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A receipt amount: a non-negative, finite number. Rejects NaN and strings like "abc". */
function parseAmount(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}

function readReceiptBody(body) {
  const amount = parseAmount(body?.amount);
  const expenseCredit = parseAmount(body?.expense_credit);
  if (amount === null || expenseCredit === null) return { error: 'Amounts must be non-negative numbers' };
  if (amount + expenseCredit <= 0) return { error: 'Enter a cash amount, an expense amount, or both' };

  const receivedOn = String(body?.received_on || '');
  if (!DATE_RE.test(receivedOn)) return { error: 'Received date must be YYYY-MM-DD' };

  return { amount, expenseCredit, receivedOn, note: body?.note ? String(body.note).slice(0, 500) : null };
}

/** GET /api/profit-split/receipts — the whole ledger, newest first. */
profitSplitRouter.get('/receipts', adminGate, (req, res) => res.json(listReceipts()));

/** POST /api/profit-split/receipts — record a payment against the running balance. */
profitSplitRouter.post('/receipts', adminGate, (req, res) => {
  const parsed = readReceiptBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const info = db.prepare(`
    INSERT INTO profit_receipts (received_on, amount, expense_credit, note, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(parsed.receivedOn, parsed.amount, parsed.expenseCredit, parsed.note, req.user?.email ?? null);

  const total = parsed.amount + parsed.expenseCredit;
  logAudit(req, { action: 'receipt-added', detail: `Received $${total.toFixed(2)} on ${parsed.receivedOn}` });

  return res.status(201).json(db.prepare('SELECT * FROM profit_receipts WHERE id = ?').get(info.lastInsertRowid));
});

/** DELETE /api/profit-split/receipts/:id — remove a receipt; the balance re-derives. */
profitSplitRouter.delete('/receipts/:id', adminGate, (req, res) => {
  const row = db.prepare('SELECT * FROM profit_receipts WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Receipt not found' });

  db.prepare('DELETE FROM profit_receipts WHERE id = ?').run(row.id);
  logAudit(req, {
    action: 'receipt-deleted',
    detail: `Removed $${receiptTotal(row).toFixed(2)} received ${row.received_on}`,
  });
  return res.json({ ok: true, id: row.id });
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
