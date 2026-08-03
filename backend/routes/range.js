import { db } from '../db.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses & validates from/to query params. Returns { from, to, allTime, label }.
 *
 * With no usable range the bounds fall back to everything on record, so callers can always
 * use `BETWEEN from AND to` without special-casing all-time. Shared by the dashboard,
 * machines and analytics routers so "All Time" means the same span everywhere.
 */
export function resolveRange(req) {
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
