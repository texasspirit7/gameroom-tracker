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
