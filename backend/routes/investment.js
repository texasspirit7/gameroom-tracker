import { Router } from 'express';
import { adminGate } from '../auth.js';
import { locationOf } from '../locations.js';
import { logAudit } from './audit.js';
import { releasedTotal } from '../investmentTotals.js';
import { buildProfitSplitRows } from './profitSplit.js';

export const investmentRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Seeds the quoted budget once, the first time this location's database is opened.
 *
 * Idempotent on row count rather than on content: once the lines exist they belong to the
 * app, and re-seeding would undo any correction made in the UI.
 */
export function seedInvestmentBudget(db, loc) {
  if (!loc?.investment) return 0;
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM investment_budget').get();
  if (n > 0) return 0;
  const insert = db.prepare(
    'INSERT INTO investment_budget (line_no, item, qty, price_each, amount) VALUES (?, ?, ?, ?, ?)'
  );
  for (const b of loc.investment.budget) insert.run(b.line, b.item, b.qty, b.each, b.amount);
  return loc.investment.budget.length;
}

/**
 * The budget with what has actually been spent against each line, plus the disbursements
 * themselves and the headline figures.
 *
 * `recovered` is not computed here: it is the 50% share already accruing on the profit split,
 * passed in, so the two pages can never disagree about it.
 */
export function buildInvestment(db, loc, recovered = 0) {
  if (!loc?.investment) return null;

  const spentByLine = new Map(
    db.prepare(`
      SELECT budget_id, COALESCE(SUM(amount), 0) AS spent
      FROM investment_disbursements WHERE budget_id IS NOT NULL GROUP BY budget_id
    `).all().map((r) => [r.budget_id, r.spent]),
  );

  const budget = db.prepare('SELECT * FROM investment_budget ORDER BY line_no').all().map((b) => {
    const released = round2(spentByLine.get(b.id) || 0);
    return { ...b, released, variance: round2(released - b.amount) };
  });

  const disbursements = db.prepare(`
    SELECT d.*, b.item AS budget_item, b.line_no AS budget_line
    FROM investment_disbursements d
    LEFT JOIN investment_budget b ON b.id = d.budget_id
    ORDER BY d.released_on DESC, d.id DESC
  `).all();

  const released = releasedTotal(db);
  const quoted = round2(budget.reduce((s, b) => s + b.amount, 0));
  // Anything released without naming a line still counts toward the total — it just can't be
  // shown against a budget row.
  const unassigned = round2(released - budget.reduce((s, b) => s + b.released, 0));

  return {
    budget,
    disbursements,
    summary: {
      quoted,
      released,
      unassigned,
      remaining_to_release: round2(Math.max(0, quoted - released)),
      recovered: round2(recovered),
      // Recovery is measured against what was actually released, not the quote: you get back
      // what you put in, not what you planned to.
      outstanding: round2(Math.max(0, released - recovered)),
      recovered_pct: released > 0 ? Math.min(100, round2((recovered / released) * 100)) : 0,
      fully_recovered: released > 0 && recovered >= released,
    },
  };
}

function readBody(body, existing = null) {
  const releasedOn = body?.released_on === undefined ? existing?.released_on : String(body.released_on);
  if (!releasedOn || !DATE_RE.test(releasedOn)) return { error: 'Released date must be YYYY-MM-DD' };

  const raw = body?.amount === undefined ? existing?.amount : body.amount;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be a positive number' };

  const budgetId = body?.budget_id === undefined
    ? existing?.budget_id ?? null
    : (body.budget_id === null || body.budget_id === '' ? null : Number(body.budget_id));

  const note = body?.note === undefined ? existing?.note ?? null : String(body.note).slice(0, 500) || null;
  return { releasedOn, amount: round2(amount), budgetId, note };
}

const money = (n) => `$${Number(n).toLocaleString()}`;

/** GET /api/investment — budget, disbursements and the headline figures. */
investmentRouter.get('/', adminGate, (req, res) => {
  const loc = locationOf(req.location);
  if (!loc?.investment) return res.status(404).json({ error: 'No setup investment is tracked for this location.' });
  // Recovery is the 50% share already accruing on the split, so the two pages cannot disagree.
  const rows = buildProfitSplitRows(req.db, loc);
  return res.json(buildInvestment(req.db, loc, rows.owedTotal || 0));
});

/**
 * POST /api/investment/budget  { item, qty?, price_each?, amount? }
 *
 * For costs that turn up after the estimate was drawn. The line number is assigned rather than
 * supplied, so added items simply continue the list.
 *
 * Amount is derived from quantity × price when both are given — a line that disagrees with its
 * own arithmetic is worse than one with no detail at all.
 */
investmentRouter.post('/budget', adminGate, (req, res) => {
  const loc = locationOf(req.location);
  if (!loc?.investment) return res.status(404).json({ error: 'No setup investment is tracked for this location.' });

  const item = String(req.body?.item || '').trim();
  if (!item) return res.status(400).json({ error: 'Describe what the item is' });

  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const qty = num(req.body?.qty);
  const each = num(req.body?.price_each);
  if ([qty, each].some((v) => v !== null && (!Number.isFinite(v) || v < 0))) {
    return res.status(400).json({ error: 'Quantity and price must be non-negative numbers' });
  }

  const derived = qty !== null && each !== null ? qty * each : num(req.body?.amount);
  if (!Number.isFinite(derived) || derived <= 0) {
    return res.status(400).json({ error: 'Enter an amount, or a quantity and price to work it out from' });
  }
  const amount = round2(derived);

  const { next } = req.db.prepare('SELECT COALESCE(MAX(line_no), 0) + 1 AS next FROM investment_budget').get();
  const info = req.db.prepare(
    'INSERT INTO investment_budget (line_no, item, qty, price_each, amount) VALUES (?, ?, ?, ?, ?)'
  ).run(next, item, qty, each, amount);

  logAudit(req, { action: 'investment-budget-added', detail: `${item} — ${money(amount)}` });
  res.status(201).json(req.db.prepare('SELECT * FROM investment_budget WHERE id = ?').get(info.lastInsertRowid));
});

/**
 * DELETE /api/investment/budget/:id — for a line added by mistake.
 *
 * Refused once money has been released against it: removing it would quietly detach the
 * disbursements from what they were for, and the released total would no longer add up to
 * anything the budget explains.
 */
investmentRouter.delete('/budget/:id', adminGate, (req, res) => {
  const id = Number(req.params.id);
  const line = req.db.prepare('SELECT * FROM investment_budget WHERE id = ?').get(id);
  if (!line) return res.status(404).json({ error: 'Budget line not found' });

  const { n } = req.db.prepare('SELECT COUNT(*) AS n FROM investment_disbursements WHERE budget_id = ?').get(id);
  if (n > 0) {
    return res.status(409).json({
      error: `${n} disbursement${n === 1 ? '' : 's'} already booked against this line — reassign or remove ${n === 1 ? 'it' : 'them'} first.`,
    });
  }

  req.db.prepare('DELETE FROM investment_budget WHERE id = ?').run(id);
  logAudit(req, { action: 'investment-budget-removed', detail: `${line.item} — ${money(line.amount)}` });
  res.json({ ok: true, id });
});

/** POST /api/investment/disbursements — record money released. */
investmentRouter.post('/disbursements', adminGate, (req, res) => {
  const loc = locationOf(req.location);
  if (!loc?.investment) return res.status(404).json({ error: 'No setup investment is tracked for this location.' });

  const parsed = readBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const info = req.db.prepare(`
    INSERT INTO investment_disbursements (released_on, amount, budget_id, note, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(parsed.releasedOn, parsed.amount, parsed.budgetId, parsed.note, req.user?.email ?? null);

  logAudit(req, {
    action: 'investment-released',
    detail: `${money(parsed.amount)} released on ${parsed.releasedOn}`,
  });
  res.status(201).json(req.db.prepare('SELECT * FROM investment_disbursements WHERE id = ?').get(info.lastInsertRowid));
});

/** PATCH /api/investment/disbursements/:id */
investmentRouter.patch('/disbursements/:id', adminGate, (req, res) => {
  const id = Number(req.params.id);
  const existing = req.db.prepare('SELECT * FROM investment_disbursements WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Disbursement not found' });

  const parsed = readBody(req.body, existing);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  // Both sides recorded: a changed amount only means something against what it was.
  const changes = [];
  if (parsed.amount !== existing.amount) changes.push(`${money(existing.amount)} → ${money(parsed.amount)}`);
  if (parsed.releasedOn !== existing.released_on) changes.push(`date ${existing.released_on} → ${parsed.releasedOn}`);
  if ((parsed.budgetId ?? null) !== (existing.budget_id ?? null)) changes.push('reassigned to a different budget line');
  if (!changes.length) return res.json(existing);

  req.db.prepare(`
    UPDATE investment_disbursements
    SET released_on = ?, amount = ?, budget_id = ?, note = ?, updated_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(parsed.releasedOn, parsed.amount, parsed.budgetId, parsed.note, req.user?.email ?? null, id);

  logAudit(req, { action: 'investment-edited', detail: changes.join('; ') });
  res.json(req.db.prepare('SELECT * FROM investment_disbursements WHERE id = ?').get(id));
});

/** DELETE /api/investment/disbursements/:id */
investmentRouter.delete('/disbursements/:id', adminGate, (req, res) => {
  const id = Number(req.params.id);
  // Read before the delete — afterwards there is nothing left to describe.
  const existing = req.db.prepare('SELECT * FROM investment_disbursements WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Disbursement not found' });

  req.db.prepare('DELETE FROM investment_disbursements WHERE id = ?').run(id);
  logAudit(req, {
    action: 'investment-deleted',
    detail: `${money(existing.amount)} released ${existing.released_on}`,
  });
  res.json({ ok: true, id });
});
