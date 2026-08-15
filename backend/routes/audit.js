import { Router } from 'express';
import { db } from '../db.js';

export const auditRouter = Router();

// GET /api/audit?limit=20 — most recent sheet activity first (create/edit/verify/delete)
auditRouter.get('/', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
  const rows = db.prepare(`
    SELECT id, action, sheet_id, sheet_date, actor_email, actor_name, detail, created_at
    FROM audit_log ORDER BY id DESC LIMIT ?
  `).all(limit);
  res.json(rows);
});

/**
 * Append a line to the audit trail.
 *
 * sheet_id / sheet_date are denormalized rather than foreign keys so the trail outlives the
 * row it describes. Both are nullable: entries that aren't about a sheet at all — a profit
 * receipt, say — leave them empty and carry their context in `detail`.
 */
export function logAudit(req, { action, sheetId, sheetDate, detail }) {
  db.prepare(`
    INSERT INTO audit_log (action, sheet_id, sheet_date, actor_email, actor_name, detail)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(action, sheetId ?? null, sheetDate ?? null, req.user?.email ?? null, req.user?.name ?? null, detail ?? null);
}
