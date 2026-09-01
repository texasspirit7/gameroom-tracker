import { Router } from 'express';
import { db } from '../db.js';
import { ownerGate } from '../auth.js';

export const auditRouter = Router();

/**
 * Which part of the site an action belongs to, and whether it needs attention.
 *
 * Derived from the action name rather than stored, so adding an action can't leave a row
 * uncategorised in the database — an unmapped action simply falls back to 'other'.
 *
 * 'users' and 'split' are sensitive: one changes who can get in and what they can do, the
 * other moves money. Those are the two worth noticing first.
 */
const AREA_BY_ACTION = {
  'user-approved': 'users',
  'user-blocked': 'users',
  'user-role-changed': 'users',
  'receipt-added': 'split',
  'receipt-deleted': 'split',
  'split-comment': 'split',
  created: 'sheets',
  edited: 'sheets',
  verified: 'sheets',
  deleted: 'sheets',
  'expense-added': 'expenses',
  'expense-edited': 'expenses',
  'expense-deleted': 'expenses',
  'backup-created': 'system',
  // Sign-out isn't recorded: the /auth routes bypass the auth gate, so the request carries no
  // authenticated user and the entry would have no actor.
  'signed-in': 'system',
};

const SENSITIVE_AREAS = new Set(['users', 'split']);

export const areaOf = (action) => AREA_BY_ACTION[action] || 'other';
export const isSensitive = (action) => SENSITIVE_AREAS.has(areaOf(action));

const decorate = (row) => ({ ...row, area: areaOf(row.action), sensitive: isSensitive(row.action) });

/**
 * GET /api/audit?limit=200 — every recorded action, newest first.
 *
 * Owner-only: this is the record of what everyone did, admins included, so it deliberately
 * isn't visible to the people it describes.
 */
auditRouter.get('/', ownerGate, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
  const rows = db.prepare(`
    SELECT id, action, sheet_id, sheet_date, actor_email, actor_name, detail, created_at
    FROM audit_log ORDER BY id DESC LIMIT ?
  `).all(limit);
  res.json(rows.map(decorate));
});

/**
 * Append a line to the audit trail.
 *
 * sheet_id / sheet_date are denormalized rather than foreign keys so the trail outlives the
 * row it describes. Both are nullable: entries that aren't about a sheet at all — a profit
 * receipt or a role change — leave them empty and carry their context in `detail`.
 */
export function logAudit(req, { action, sheetId, sheetDate, detail }) {
  db.prepare(`
    INSERT INTO audit_log (action, sheet_id, sheet_date, actor_email, actor_name, detail)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(action, sheetId ?? null, sheetDate ?? null, req.user?.email ?? null, req.user?.name ?? null, detail ?? null);
}
