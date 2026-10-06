import { Router } from 'express';
import { locationOf } from '../locations.js';
import { adminGate } from '../auth.js';
import { logAudit } from './audit.js';

export const profitSplitRouter = Router();

/**
 * The split terms belong to the location, not to the app: La runs 40/60 with a closed-out
 * history, H runs 50/50 from its first sheet. Everything below reads them from there rather
 * than from constants, so adding a location never means editing this file.
 */
export const CLOSED_PERIOD_KEY = 'closed';

/** Marks the seeded close-out receipt so the one-time insert stays idempotent. */
const CLOSE_OUT_ACTOR = 'system:closeout';

/** A period key is either the closed row or a week's Monday. */
const PERIOD_RE = /^(closed|\d{4}-\d{2}-\d{2})$/;

/**
 * Sub-cent slack when deciding whether a period is settled. Owed amounts are floats (40% of
 * a week's net), so a period paid to the exact dollar can land a fraction of a cent short and
 * would otherwise read "Partial" forever.
 */
const SETTLED_EPSILON = 0.005;

const round2 = (n) => Math.round(n * 100) / 100;

/** Cash plus expense credit — both settle the debt, so they're summed everywhere. */
const receiptTotal = (r) => (r.amount || 0) + (r.expense_credit || 0);

const todayISO = () => new Date().toISOString().slice(0, 10);

function addDaysISO(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

/** The Monday of the week containing `iso`, for Monday–Sunday weeks. */
export function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // getUTCDay: 0 = Sunday. Sunday belongs to the week that began six days earlier.
  const back = (dt.getUTCDay() + 6) % 7;
  return addDaysISO(iso, -back);
}

/** Every week Monday from `startMonday` through the week containing `throughDate`. */
function weeksFrom(startMonday, throughDate) {
  const last = mondayOf(throughDate);
  const out = [];
  for (let wk = startMonday; wk <= last; wk = addDaysISO(wk, 7)) out.push(wk);
  return out;
}

/**
 * How far a payment pool covers one period's entitlement.
 *
 * 'none' is kept distinct from 'covered' so a week that earned nothing doesn't display as an
 * achievement — it had nothing to cover in the first place.
 */
export function coverageOf(owed, applied) {
  if (owed <= SETTLED_EPSILON) return 'none';
  if (applied <= SETTLED_EPSILON) return 'open';
  if (applied + SETTLED_EPSILON >= owed) return 'covered';
  return 'partial';
}

/** Every receipt, newest first. Receipts belong to the account, not to any one period. */
export function listReceipts(db) {
  return db.prepare('SELECT * FROM profit_receipts ORDER BY received_on DESC, id DESC').all();
}

/**
 * One-time seed of the close-out payment, so the closed period has a real receipt behind it
 * rather than a number conjured in the UI. Idempotent via created_by.
 */
export function seedCloseOutReceipt(db, loc) {
  // A location with no history to close out gets no seeded receipt — H starts from zero.
  if (!loc?.closeOut) return null;
  const existing = db.prepare('SELECT id FROM profit_receipts WHERE created_by = ?').get(CLOSE_OUT_ACTOR);
  if (existing) return existing.id;
  const info = db.prepare(`
    INSERT INTO profit_receipts (received_on, amount, expense_credit, note, created_by)
    VALUES (?, ?, 0, ?, ?)
  `).run(loc.closeOut.date, loc.closeOut.received,
    `Close-out — everything through ${loc.closeOut.date} settled`, CLOSE_OUT_ACTOR);
  return info.lastInsertRowid;
}

/**
 * One row per Monday–Sunday week since the close-out, most recent first, preceded by the
 * single closed row covering everything before it.
 *
 * Shared by the GET route and the CSV export so both compute the split the same way.
 */
export function buildProfitSplitRows(db, loc) {
  const SPLIT_A = loc.split.a;
  const SPLIT_B = loc.split.b;
  const closeOut = loc.closeOut;
  const WEEK_OF = "date(%COL%, 'weekday 0', '-6 days')";

  // With a close-out, weeks start the Monday after it and everything earlier is settled
  // history. Without one, they start at the first thing on record — there is nothing behind
  // them to settle.
  const closeOutDate = closeOut ? closeOut.date : null;
  const earliest = [
    db.prepare('SELECT MIN(sheet_date) AS d FROM sheets').get().d,
    db.prepare('SELECT MIN(expense_date) AS d FROM other_expenses').get().d,
  ].filter(Boolean).sort()[0];
  if (!closeOut && !earliest) return Object.assign([], { owedTotal: 0, receivedTotal: 0, paidThrough: null });
  const FIRST_WEEK_START = closeOut
    ? closeOut.firstWeek
    : db.prepare("SELECT date(?, 'weekday 0', '-6 days') AS wk").get(earliest).wk;
  const meterByWeek = db.prepare(`
    SELECT ${WEEK_OF.replace('%COL%', 'sheet_date')} AS wk, COALESCE(SUM(meter_profit), 0) AS mp
    FROM sheets WHERE sheet_date >= ? GROUP BY wk
  `).all(FIRST_WEEK_START);
  const sheetExpByWeek = db.prepare(`
    SELECT ${WEEK_OF.replace('%COL%', 's.sheet_date')} AS wk, COALESCE(SUM(e.amount), 0) AS exp
    FROM expenses e JOIN sheets s ON s.id = e.sheet_id WHERE s.sheet_date >= ? GROUP BY wk
  `).all(FIRST_WEEK_START);
  const otherExpByWeek = db.prepare(`
    SELECT ${WEEK_OF.replace('%COL%', 'expense_date')} AS wk, COALESCE(SUM(amount), 0) AS exp
    FROM other_expenses WHERE expense_date >= ? GROUP BY wk
  `).all(FIRST_WEEK_START);

  const netByWeek = new Map();
  for (const r of meterByWeek) netByWeek.set(r.wk, (netByWeek.get(r.wk) || 0) + r.mp);
  for (const r of sheetExpByWeek) netByWeek.set(r.wk, (netByWeek.get(r.wk) || 0) - r.exp);
  for (const r of otherExpByWeek) netByWeek.set(r.wk, (netByWeek.get(r.wk) || 0) - r.exp);

  const receipts = db.prepare('SELECT received_on, amount, expense_credit FROM profit_receipts').all();
  // Receipts on or before the close-out belong to the closed period; only later ones draw
  // down the weekly balance.
  let closedReceived = 0;
  let receivedTotal = 0;
  for (const r of receipts) {
    const v = receiptTotal(r);
    if (closeOutDate && r.received_on <= closeOutDate) closedReceived += v;
    else receivedTotal += v;
  }

  const notesByPeriod = new Map(
    db.prepare('SELECT period, notes FROM profit_splits').all().map((r) => [r.period, r.notes]),
  );

  // The closed period's owed is defined as whatever was received in it, so its balance is
  // zero by construction — the whole point of closing it out rather than recomputing it.
  // A location without one has no such row.
  const rows = closeOut ? [{
    period: CLOSED_PERIOD_KEY,
    closed: true,
    period_start: null,
    period_end: closeOutDate,
    net_profit: null,
    amount_40: round2(closedReceived),
    amount_60: null,
    owed_running: round2(closedReceived),
    applied: round2(closedReceived),
    coverage: 'covered',
    notes: notesByPeriod.get(CLOSED_PERIOD_KEY) || '',
  }] : [];

  // One pool drawn down oldest-first, exactly as before — weeks simply replaced months.
  let pool = receivedTotal;
  let owedRunning = round2(closedReceived);

  // Runs to the current week, or further if anything is dated beyond it. Stopping at today
  // would silently drop a later week's profit instead of showing it.
  const lastDated = [...netByWeek.keys()].sort().pop();
  const through = lastDated && lastDated > todayISO() ? lastDated : todayISO();

  for (const wk of weeksFrom(FIRST_WEEK_START, through)) {
    const net = round2(netByWeek.get(wk) || 0);
    const owed = round2(net * SPLIT_A);
    owedRunning = round2(owedRunning + owed);

    const applied = round2(Math.min(pool, owed));
    pool = round2(Math.max(0, pool - owed));

    rows.push({
      period: wk,
      closed: false,
      period_start: wk,
      period_end: addDaysISO(wk, 6),
      net_profit: net,
      amount_40: owed,
      amount_60: round2(net * SPLIT_B),
      owed_running: owedRunning,
      applied,
      coverage: coverageOf(owed, applied),
      notes: notesByPeriod.get(wk) || '',
    });
  }

  const owedTotal = owedRunning;
  const paidThrough = [...rows].reverse().find((r) => r.coverage === 'covered')?.period || null;

  // Newest first for display; the closed row sits at the bottom as the oldest thing there is.
  rows.sort((a, b) => {
    if (a.closed) return 1;
    if (b.closed) return -1;
    return a.period < b.period ? 1 : -1;
  });

  rows.owedTotal = owedTotal;
  rows.receivedTotal = round2(closedReceived + receivedTotal);
  rows.paidThrough = paidThrough;
  rows.firstWeekStart = FIRST_WEEK_START;
  return rows;
}

/** Everything owed to date on one side, everything received on the other. */
export function buildAccountSummary(rows, loc) {
  const owedTotal = round2(rows.owedTotal || 0);
  const receivedTotal = round2(rows.receivedTotal || 0);
  return {
    owed_total: owedTotal,
    received_total: receivedTotal,
    balance: round2(owedTotal - receivedTotal),
    paid_through: rows.paidThrough,
    // null target means the page simply shows the running total with nothing to measure
    // it against — H has no goal set, La is working toward $80k.
    target: loc.runningTarget ?? null,
    target_remaining: loc.runningTarget ? round2(Math.max(0, loc.runningTarget - owedTotal)) : null,
    target_reached: loc.runningTarget ? owedTotal >= loc.runningTarget : false,
    close_out_date: loc.closeOut?.date ?? null,
    first_week_start: rows.firstWeekStart ?? null,
    split_a: loc.split.a,
    split_b: loc.split.b,
    location: loc.key,
    location_label: loc.label,
  };
}

/** GET /api/profit-split — the closed row plus one row per week, newest first, and the
 * account summary. The summary ships with the rows rather than being derived in the browser
 * so the allocation rules live in exactly one place. */
profitSplitRouter.get('/', adminGate, (req, res) => {
  const loc = locationOf(req.location);
  const rows = buildProfitSplitRows(req.db, loc);
  res.json({ rows: [...rows], account: buildAccountSummary(rows, loc) });
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
profitSplitRouter.get('/receipts', adminGate, (req, res) => res.json(listReceipts(req.db)));

/** POST /api/profit-split/receipts — record a payment against the running balance. */
profitSplitRouter.post('/receipts', adminGate, (req, res) => {
  const parsed = readReceiptBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const info = req.db.prepare(`
    INSERT INTO profit_receipts (received_on, amount, expense_credit, note, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(parsed.receivedOn, parsed.amount, parsed.expenseCredit, parsed.note, req.user?.email ?? null);

  const total = parsed.amount + parsed.expenseCredit;
  logAudit(req, { action: 'receipt-added', detail: `Received $${total.toFixed(2)} on ${parsed.receivedOn}` });

  return res.status(201).json(req.db.prepare('SELECT * FROM profit_receipts WHERE id = ?').get(info.lastInsertRowid));
});

/** DELETE /api/profit-split/receipts/:id — remove a receipt; the balance re-derives. */
profitSplitRouter.delete('/receipts/:id', adminGate, (req, res) => {
  const row = req.db.prepare('SELECT * FROM profit_receipts WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Receipt not found' });
  if (row.created_by === CLOSE_OUT_ACTOR) {
    return res.status(400).json({ error: 'The close-out payment is part of the settled history and cannot be deleted.' });
  }

  req.db.prepare('DELETE FROM profit_receipts WHERE id = ?').run(row.id);
  logAudit(req, {
    action: 'receipt-deleted',
    detail: `Removed $${receiptTotal(row).toFixed(2)} received ${row.received_on}`,
  });
  return res.json({ ok: true, id: row.id });
});

const NOTE_MAX = 2000;

/** Shown in the trail when a note changes — enough to recognise which note, not the essay. */
const snippet = (body) => {
  const flat = String(body).replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
};

function readNoteBody(body, existing = null) {
  const noteDate = body?.note_date === undefined ? existing?.note_date : String(body.note_date);
  if (!noteDate || !DATE_RE.test(noteDate)) return { error: 'Note date must be YYYY-MM-DD' };

  const text = body?.body === undefined ? existing?.body : String(body.body);
  if (!text || !text.trim()) return { error: 'A note needs some text' };

  return { noteDate, body: text.trim().slice(0, NOTE_MAX) };
}

/** GET /api/profit-split/notes — dated notes, newest first. */
profitSplitRouter.get('/notes', adminGate, (req, res) => {
  res.json(req.db.prepare('SELECT * FROM profit_notes ORDER BY note_date DESC, id DESC').all());
});

/** POST /api/profit-split/notes  { note_date, body } */
profitSplitRouter.post('/notes', adminGate, (req, res) => {
  const parsed = readNoteBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const info = req.db.prepare(
    'INSERT INTO profit_notes (note_date, body, created_by) VALUES (?, ?, ?)'
  ).run(parsed.noteDate, parsed.body, req.user?.email ?? null);

  logAudit(req, { action: 'split-note-added', detail: `${parsed.noteDate}: "${snippet(parsed.body)}"` });
  return res.status(201).json(req.db.prepare('SELECT * FROM profit_notes WHERE id = ?').get(info.lastInsertRowid));
});

/** PATCH /api/profit-split/notes/:id  { note_date?, body? } */
profitSplitRouter.patch('/notes/:id', adminGate, (req, res) => {
  const id = Number(req.params.id);
  const existing = req.db.prepare('SELECT * FROM profit_notes WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Note not found' });

  const parsed = readNoteBody(req.body, existing);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  // Both sides recorded: "edited a note" says nothing useful on its own.
  const changes = [];
  if (parsed.noteDate !== existing.note_date) changes.push(`date ${existing.note_date} → ${parsed.noteDate}`);
  if (parsed.body !== existing.body) changes.push(`text "${snippet(existing.body)}" → "${snippet(parsed.body)}"`);
  if (!changes.length) return res.json(existing);

  req.db.prepare(
    "UPDATE profit_notes SET note_date = ?, body = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(parsed.noteDate, parsed.body, req.user?.email ?? null, id);

  logAudit(req, { action: 'split-note-edited', detail: changes.join('; ') });
  return res.json(req.db.prepare('SELECT * FROM profit_notes WHERE id = ?').get(id));
});

/** DELETE /api/profit-split/notes/:id */
profitSplitRouter.delete('/notes/:id', adminGate, (req, res) => {
  const id = Number(req.params.id);
  // Read before the delete — afterwards there is nothing left to describe.
  const existing = req.db.prepare('SELECT * FROM profit_notes WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Note not found' });

  req.db.prepare('DELETE FROM profit_notes WHERE id = ?').run(id);
  logAudit(req, { action: 'split-note-deleted', detail: `${existing.note_date}: "${snippet(existing.body)}"` });
  return res.json({ ok: true, id });
});

/** PATCH /api/profit-split/:period  { notes } — a comment against one week or the closed row. */
profitSplitRouter.patch('/:period', adminGate, (req, res) => {
  const { period } = req.params;
  if (!PERIOD_RE.test(period)) return res.status(400).json({ error: 'Invalid period' });
  if (req.body?.notes === undefined) return res.status(400).json({ error: 'Nothing to update' });

  const notes = String(req.body.notes).slice(0, 2000);
  req.db.prepare(`
    INSERT INTO profit_splits (period, notes) VALUES (?, ?)
    ON CONFLICT(period) DO UPDATE SET notes = excluded.notes
  `).run(period, notes);

  logAudit(req, {
    action: 'split-comment',
    detail: `Comment on ${period === CLOSED_PERIOD_KEY ? 'the closed period' : `week of ${period}`}`,
  });
  res.json({ ok: true, period, notes });
});
