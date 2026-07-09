import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { config } from '../config.js';
import { extractFromXlsx } from '../extract/xlsxExtract.js';
import { extractFromImage, mediaTypeForExt } from '../extract/claudeExtract.js';
import { validateSheet, computeMeterProfit } from '../extract/validate.js';
import { adminGate } from '../auth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export const sheetsRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Server-local today, YYYY-MM-DD — sheets are always dated by upload day, not a date parsed from the file. */
function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function saveUploadedFile(file, sheetDate) {
  const ext = path.extname(file.originalname).toLowerCase() || '.bin';
  const name = `${sheetDate || 'undated'}-${Date.now()}${ext}`;
  const rel = path.join('uploads', name);
  fs.writeFileSync(path.join(config.dataDir, rel), file.buffer);
  return rel;
}

function persistSheet({ extracted, sheetDate, source, filePath, warnings }) {
  // Always computed by the app, not trusted from the sheet's own printed
  // "Profit (Loss)" box — that figure is whatever the paper's author
  // calculated by hand and isn't a consistent formula sheet to sheet.
  const meterProfit = computeMeterProfit(extracted);
  const cashProfit = extracted.bank?.cash_profit ?? null;
  const overShort =
    cashProfit != null ? cashProfit - meterProfit : extracted.bank?.over_short ?? null;

  const insertSheet = db.prepare(`
    INSERT INTO sheets (sheet_date, source, file_path, total_in, total_out, match_amount,
      loan_rtn, start_bank, end_bank, meter_profit, cash_profit, over_short, status, validation_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', ?)
  `);
  const result = insertSheet.run(
    sheetDate,
    source,
    filePath,
    extracted.totals?.total_in ?? 0,
    extracted.totals?.total_out ?? 0,
    extracted.settlement?.match_amount ?? 0,
    extracted.settlement?.loan_rtn ?? 0,
    extracted.bank?.start_bank ?? null,
    extracted.bank?.end_bank ?? null,
    meterProfit,
    cashProfit,
    overShort,
    JSON.stringify(warnings)
  );
  const sheetId = result.lastInsertRowid;

  const insReading = db.prepare(`
    INSERT INTO machine_readings (sheet_id, machine_number, prev_in, curr_in, daily_in, prev_out, curr_out, daily_out)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const machineRows = Array.isArray(extracted.machines) ? extracted.machines : Object.values(extracted.machines || {});
  for (const m of machineRows) {
    insReading.run(
      sheetId, Number(m.machine_number) || 0,
      Number(m.prev_in) || 0, Number(m.curr_in) || 0, Number(m.daily_in) || 0,
      Number(m.prev_out) || 0, Number(m.curr_out) || 0, Number(m.daily_out) || 0
    );
  }

  const insExpense = db.prepare('INSERT INTO expenses (sheet_id, category, amount, note) VALUES (?, ?, ?, ?)');
  for (const e of extracted.expenses || []) {
    if (Number(e.amount)) insExpense.run(sheetId, String(e.category || 'misc').toLowerCase(), Number(e.amount), e.note ?? null);
  }
  return sheetId;
}

// POST /api/sheets/upload  (multipart: file, sheet_date? — defaults to today)
sheetsRouter.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    const isXlsx = ['.xlsx', '.xlsm', '.xls'].includes(ext);
    const mediaType = mediaTypeForExt(ext);
    if (!isXlsx && !mediaType) {
      return res.status(400).json({ error: `Unsupported file type "${ext}". Upload .xlsx or a photo (.jpg/.png/.webp).` });
    }

    const extracted = isXlsx
      ? extractFromXlsx(req.file.buffer)
      : await extractFromImage(req.file.buffer, mediaType);

    // Defaults to today (the upload day) but can be overridden — e.g. backfilling a previous day.
    // Never read from the file itself.
    const providedDate = req.body.sheet_date;
    const sheetDate = providedDate && DATE_RE.test(providedDate) ? providedDate : todayISO();

    const { warnings } = validateSheet({ sheetDate, machines: extracted.machines, totals: extracted.totals });

    // Multiple sheets per date are allowed (e.g. separate shifts) — just flag it,
    // don't block the upload.
    const existing = db.prepare('SELECT id FROM sheets WHERE sheet_date = ? ORDER BY id').all(sheetDate);
    if (existing.length) {
      warnings.push(
        `${existing.length} other sheet${existing.length === 1 ? '' : 's'} already exist${existing.length === 1 ? 's' : ''} for ${sheetDate} (#${existing.map((s) => s.id).join(', #')})`
      );
    }

    const filePath = saveUploadedFile(req.file, sheetDate);
    const sheetId = persistSheet({
      extracted, sheetDate, source: isXlsx ? 'xlsx' : 'image', filePath, warnings,
    });

    res.json({ sheetId, warnings });
  } catch (err) {
    console.error('[upload]', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// GET /api/sheets
sheetsRouter.get('/', (req, res) => {
  const sheets = db.prepare(`
    SELECT s.id, s.sheet_date, s.source, s.total_in, s.total_out, s.match_amount,
           s.meter_profit, s.cash_profit, s.over_short, s.status, s.validation_json, s.created_at,
           (s.file_path IS NOT NULL) AS has_file,
           COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.sheet_id = s.id), 0) AS expenses
    FROM sheets s ORDER BY s.sheet_date DESC, s.id DESC
  `).all();
  res.json(sheets.map((s) => ({
    ...s,
    has_file: Boolean(s.has_file),
    warnings: JSON.parse(s.validation_json || '[]').length,
    net_profit: s.meter_profit - s.expenses,
  })));
});

// GET /api/sheets/:id/file — download the originally uploaded image/pdf/xlsx
sheetsRouter.get('/:id/file', (req, res) => {
  const sheet = db.prepare('SELECT sheet_date, file_path FROM sheets WHERE id = ?').get(Number(req.params.id));
  if (!sheet?.file_path) return res.status(404).json({ error: 'No file on record for this sheet' });
  const abs = path.join(config.dataDir, sheet.file_path);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing from storage' });
  res.download(abs, `sheet-${sheet.sheet_date}${path.extname(sheet.file_path)}`);
});

// GET /api/sheets/:id
sheetsRouter.get('/:id', (req, res) => {
  const sheet = db.prepare('SELECT * FROM sheets WHERE id = ?').get(Number(req.params.id));
  if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
  const machines = db.prepare('SELECT * FROM machine_readings WHERE sheet_id = ? ORDER BY machine_number').all(sheet.id);
  const expenses = db.prepare('SELECT * FROM expenses WHERE sheet_id = ?').all(sheet.id);
  res.json({ ...sheet, warnings: JSON.parse(sheet.validation_json || '[]'), machines, expenses });
});

// PATCH /api/sheets/:id  — corrections from the Review screen (admin-only once auth is on)
sheetsRouter.patch('/:id', adminGate, (req, res) => {
  const id = Number(req.params.id);
  const sheet = db.prepare('SELECT * FROM sheets WHERE id = ?').get(id);
  if (!sheet) return res.status(404).json({ error: 'Sheet not found' });

  const { machines, expenses, ...fields } = req.body || {};

  const allowed = ['total_in', 'total_out', 'match_amount', 'loan_rtn', 'start_bank',
    'end_bank', 'cash_profit', 'notes', 'sheet_date'];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      if (key === 'sheet_date' && !DATE_RE.test(String(fields[key]))) {
        return res.status(400).json({ error: 'sheet_date must be YYYY-MM-DD' });
      }
      db.prepare(`UPDATE sheets SET ${key} = ? WHERE id = ?`).run(fields[key], id);
    }
  }

  if (Array.isArray(machines)) {
    const up = db.prepare(`
      INSERT INTO machine_readings (sheet_id, machine_number, prev_in, curr_in, daily_in, prev_out, curr_out, daily_out)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sheet_id, machine_number) DO UPDATE SET
        prev_in=excluded.prev_in, curr_in=excluded.curr_in, daily_in=excluded.daily_in,
        prev_out=excluded.prev_out, curr_out=excluded.curr_out, daily_out=excluded.daily_out
    `);
    for (const m of machines) {
      up.run(id, Number(m.machine_number) || 0,
        Number(m.prev_in) || 0, Number(m.curr_in) || 0, Number(m.daily_in) || 0,
        Number(m.prev_out) || 0, Number(m.curr_out) || 0, Number(m.daily_out) || 0);
    }
  }

  if (Array.isArray(expenses)) {
    db.prepare('DELETE FROM expenses WHERE sheet_id = ?').run(id);
    const ins = db.prepare('INSERT INTO expenses (sheet_id, category, amount, note) VALUES (?, ?, ?, ?)');
    for (const e of expenses) {
      if (Number(e.amount)) ins.run(id, String(e.category || 'misc').toLowerCase(), Number(e.amount), e.note ?? null);
    }
  }

  // Recompute derived fields + re-validate
  const updated = db.prepare('SELECT * FROM sheets WHERE id = ?').get(id);
  const rows = db.prepare('SELECT * FROM machine_readings WHERE sheet_id = ?').all(id);
  const meterProfit = computeMeterProfit({
    totals: { total_in: updated.total_in, total_out: updated.total_out },
    settlement: { match_amount: updated.match_amount, loan_rtn: updated.loan_rtn },
  });
  // If cash_profit isn't set, leave over_short as whatever it already was (e.g. a value
  // extracted from the sheet's own printed Short/Over box) rather than wiping it to null.
  const overShort = updated.cash_profit != null ? updated.cash_profit - meterProfit : updated.over_short;
  const { warnings } = validateSheet({
    sheetDate: updated.sheet_date, machines: rows,
    totals: { total_in: updated.total_in, total_out: updated.total_out },
    excludeSheetId: id,
  });
  db.prepare('UPDATE sheets SET meter_profit = ?, over_short = ?, validation_json = ? WHERE id = ?')
    .run(meterProfit, overShort, JSON.stringify(warnings), id);

  res.json({ ok: true, meter_profit: meterProfit, over_short: overShort, warnings });
});

// POST /api/sheets/:id/verify (admin-only once auth is on)
sheetsRouter.post('/:id/verify', adminGate, (req, res) => {
  const result = db.prepare("UPDATE sheets SET status = 'verified' WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Sheet not found' });
  res.json({ ok: true });
});

// DELETE /api/sheets/:id (admin-only once auth is on)
sheetsRouter.delete('/:id', adminGate, (req, res) => {
  const result = db.prepare('DELETE FROM sheets WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Sheet not found' });
  res.json({ ok: true });
});
