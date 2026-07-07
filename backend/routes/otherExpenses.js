import { Router } from 'express';
import { db } from '../db.js';
import { adminGate } from '../auth.js';

export const otherExpensesRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/other-expenses?from&to
otherExpensesRouter.get('/', (req, res) => {
  const from = DATE_RE.test(req.query.from) ? req.query.from : '0001-01-01';
  const to = DATE_RE.test(req.query.to) ? req.query.to : '9999-12-31';
  const rows = db.prepare(
    'SELECT * FROM other_expenses WHERE expense_date BETWEEN ? AND ? ORDER BY expense_date DESC, id DESC'
  ).all(from, to);
  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
  res.json({ expenses: rows, total });
});

// POST /api/other-expenses — everyone who's signed in and approved can log an entry
otherExpensesRouter.post('/', (req, res) => {
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

// PATCH /api/other-expenses/:id (admin-only once auth is on)
otherExpensesRouter.patch('/:id', adminGate, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM other_expenses WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Expense not found' });

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

// DELETE /api/other-expenses/:id (admin-only once auth is on)
otherExpensesRouter.delete('/:id', adminGate, (req, res) => {
  const result = db.prepare('DELETE FROM other_expenses WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Expense not found' });
  res.json({ ok: true });
});
