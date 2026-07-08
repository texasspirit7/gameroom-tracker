import { Router } from 'express';
import { db } from '../db.js';
import { adminGate } from '../auth.js';

export const expensesRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/expenses?from&to — combined view: sheet-derived expenses (pay, food,
// cleaning, etc. from uploaded sheets) + manually logged ones (rent, electricity, etc.)
expensesRouter.get('/', (req, res) => {
  const from = DATE_RE.test(req.query.from) ? req.query.from : '0001-01-01';
  const to = DATE_RE.test(req.query.to) ? req.query.to : '9999-12-31';

  const sheetRows = db.prepare(`
    SELECT e.id, s.sheet_date AS date, e.category, e.amount, e.note, e.sheet_id
    FROM expenses e JOIN sheets s ON s.id = e.sheet_id
    WHERE s.sheet_date BETWEEN ? AND ?
  `).all(from, to).map((r) => ({ ...r, source: 'sheet', created_by: null }));

  const otherRows = db.prepare(`
    SELECT id, expense_date AS date, category, amount, note, created_by
    FROM other_expenses WHERE expense_date BETWEEN ? AND ?
  `).all(from, to).map((r) => ({ ...r, source: 'other', sheet_id: null }));

  const expenses = [...sheetRows, ...otherRows].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const total = expenses.reduce((s, r) => s + (r.amount || 0), 0);
  res.json({ expenses, total });
});

// POST /api/expenses — everyone who's signed in and approved can log a manual entry.
// Always creates an 'other' expense — sheet-derived ones only come from sheet uploads.
expensesRouter.post('/', (req, res) => {
  const { expense_date, category, amount, note } = req.body || {};
  if (!DATE_RE.test(expense_date)) return res.status(400).json({ error: 'expense_date must be YYYY-MM-DD' });
  if (!category || !String(category).trim()) return res.status(400).json({ error: 'category is required' });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be a positive number' });

  const createdBy = req.user?.email || null;
  const result = db.prepare(
    'INSERT INTO other_expenses (expense_date, category, amount, note, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(expense_date, String(category).trim(), amt, note || null, createdBy);
  res.json({ id: result.lastInsertRowid });
});

// PATCH /api/expenses/:id (admin-only once auth is on) — only manually logged entries
// are editable here; a sheet's own expenses are edited via that sheet's detail page.
expensesRouter.patch('/:id', adminGate, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM other_expenses WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Expense not found (only manually logged entries can be edited here)' });

  const { expense_date, category, amount, note } = req.body || {};
  const next = {
    expense_date: expense_date && DATE_RE.test(expense_date) ? expense_date : existing.expense_date,
    category: category && String(category).trim() ? String(category).trim() : existing.category,
    amount: Number.isFinite(Number(amount)) && Number(amount) > 0 ? Number(amount) : existing.amount,
    note: note !== undefined ? note : existing.note,
  };
  db.prepare('UPDATE other_expenses SET expense_date = ?, category = ?, amount = ?, note = ? WHERE id = ?')
    .run(next.expense_date, next.category, next.amount, next.note, id);
  res.json({ ok: true });
});

// DELETE /api/expenses/:id (admin-only once auth is on) — only manually logged entries
expensesRouter.delete('/:id', adminGate, (req, res) => {
  const result = db.prepare('DELETE FROM other_expenses WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Expense not found (only manually logged entries can be deleted here)' });
  res.json({ ok: true });
});
