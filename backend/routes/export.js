import { Router } from 'express';
import { db } from '../db.js';
import { adminGate } from '../auth.js';
import { buildProfitSplitRows } from './profitSplit.js';

export const exportRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function resolveRange(req) {
  const { from, to } = req.query;
  if (from && to && DATE_RE.test(from) && DATE_RE.test(to) && from <= to) return { from, to };
  return { from: '0001-01-01', to: '9999-12-31' };
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvEscape(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvEscape(row[c.key])).join(','));
  return lines.join('\r\n') + '\r\n';
}

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// GET /api/export/sheets.csv?from=&to=
exportRouter.get('/sheets.csv', (req, res) => {
  const { from, to } = resolveRange(req);
  const rows = db.prepare(`
    SELECT s.id, s.sheet_date, s.source, s.total_in, s.total_out, s.match_amount, s.loan_rtn,
           s.start_bank, s.end_bank, s.meter_profit, s.cash_profit, s.over_short, s.status,
           COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.sheet_id = s.id), 0) AS expenses
    FROM sheets s WHERE s.sheet_date BETWEEN ? AND ? ORDER BY s.sheet_date, s.id
  `).all(from, to).map((r) => ({ ...r, net_profit: r.meter_profit - r.expenses }));

  const csv = toCsv([
    { key: 'sheet_date', label: 'Date' },
    { key: 'id', label: 'Sheet ID' },
    { key: 'source', label: 'Source' },
    { key: 'total_in', label: 'Total In' },
    { key: 'total_out', label: 'Total Out' },
    { key: 'match_amount', label: 'Match' },
    { key: 'loan_rtn', label: 'Loan RTN' },
    { key: 'start_bank', label: 'Start Bank' },
    { key: 'end_bank', label: 'End Bank' },
    { key: 'meter_profit', label: 'Meter Profit' },
    { key: 'cash_profit', label: 'Cash Profit' },
    { key: 'over_short', label: 'Over/Short' },
    { key: 'expenses', label: 'Expenses' },
    { key: 'net_profit', label: 'Net Profit' },
    { key: 'status', label: 'Status' },
  ], rows);
  sendCsv(res, `sheets-${from}-to-${to}.csv`, csv);
});

// GET /api/export/expenses.csv?from=&to= — sheet-linked + manually-logged expenses, combined
exportRouter.get('/expenses.csv', (req, res) => {
  const { from, to } = resolveRange(req);
  const sheetExpenses = db.prepare(`
    SELECT s.sheet_date AS date, ('Sheet #' || s.id) AS source, e.category, e.amount, e.note
    FROM expenses e JOIN sheets s ON s.id = e.sheet_id
    WHERE s.sheet_date BETWEEN ? AND ?
  `).all(from, to);
  const otherExpenses = db.prepare(`
    SELECT expense_date AS date, 'Manual' AS source, category, amount, note
    FROM other_expenses WHERE expense_date BETWEEN ? AND ?
  `).all(from, to);
  const rows = [...sheetExpenses, ...otherExpenses].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const csv = toCsv([
    { key: 'date', label: 'Date' },
    { key: 'source', label: 'Source' },
    { key: 'category', label: 'Category' },
    { key: 'amount', label: 'Amount' },
    { key: 'note', label: 'Note' },
  ], rows);
  sendCsv(res, `expenses-${from}-to-${to}.csv`, csv);
});

// GET /api/export/profit-split.csv — admin-only, matches GET /api/profit-split gating
exportRouter.get('/profit-split.csv', adminGate, (req, res) => {
  const rows = buildProfitSplitRows();
  const csv = toCsv([
    { key: 'month', label: 'Month' },
    { key: 'split_label', label: 'Split' },
    { key: 'net_profit', label: 'Net Profit' },
    { key: 'amount_40', label: '40% Amount' },
    { key: 'amount_60', label: '60% Amount' },
    { key: 'paid', label: 'Paid' },
    { key: 'paid_at', label: 'Paid At' },
    { key: 'paid_by', label: 'Paid By' },
    { key: 'notes', label: 'Notes' },
  ], rows);
  sendCsv(res, 'profit-split.csv', csv);
});
