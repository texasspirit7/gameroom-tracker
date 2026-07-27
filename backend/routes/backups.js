import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { adminGate } from '../auth.js';
import { backupDir, listBackups, runBackup } from '../backup.js';

export const backupsRouter = Router();

// Snapshots contain every financial record in the system, so the whole router is admin-only.
backupsRouter.use(adminGate);

// GET /api/backups — snapshots on disk, newest first
backupsRouter.get('/', (req, res) => {
  res.json(listBackups());
});

// POST /api/backups — take a snapshot now, outside the daily schedule
backupsRouter.post('/', (req, res) => {
  try {
    res.json({ ok: true, name: runBackup({ force: true }) });
  } catch (err) {
    console.error('[backup]', err);
    res.status(500).json({ error: 'Backup failed' });
  }
});

// GET /api/backups/:name — download one snapshot
backupsRouter.get('/:name', (req, res) => {
  const { name } = req.params;
  // basename() strips any traversal (../) before it reaches the filesystem; the whitelist
  // then confirms the request names a real snapshot rather than some other file in the dir.
  const safe = path.basename(name);
  if (!listBackups().some((b) => b.name === safe)) {
    return res.status(404).json({ error: 'Backup not found' });
  }
  const abs = path.join(backupDir(), safe);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Backup missing from storage' });
  res.download(abs, safe);
});
