import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from './config.js';

export const db = new DatabaseSync(path.join(config.dataDir, 'gameroom.db'));

db.exec('PRAGMA journal_mode = WAL');

// One-time migration: sheet_date used to be UNIQUE (one sheet per day). Multiple
// sheets per date are now allowed (e.g. separate shifts) — rebuild the table
// without the constraint if it's still present from an earlier version.
const existingSheetsSql = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='sheets'"
).get()?.sql;
if (existingSheetsSql && /sheet_date TEXT NOT NULL UNIQUE/.test(existingSheetsSql)) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`
    CREATE TABLE sheets_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_date TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'image',
      file_path TEXT,
      total_in REAL NOT NULL DEFAULT 0,
      total_out REAL NOT NULL DEFAULT 0,
      match_amount REAL NOT NULL DEFAULT 0,
      loan_rtn REAL NOT NULL DEFAULT 0,
      start_bank REAL,
      end_bank REAL,
      meter_profit REAL,
      cash_profit REAL,
      over_short REAL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'review',
      validation_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO sheets_new SELECT * FROM sheets;
    DROP TABLE sheets;
    ALTER TABLE sheets_new RENAME TO sheets;
  `);
  db.exec('PRAGMA foreign_keys = ON');
}

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    picture TEXT,
    role TEXT NOT NULL DEFAULT 'user',              -- 'admin' | 'user'
    status TEXT NOT NULL DEFAULT 'pending',         -- 'pending' | 'approved' | 'blocked'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at TEXT,
    approved_by TEXT
  );

  CREATE TABLE IF NOT EXISTS sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_date TEXT NOT NULL,                       -- YYYY-MM-DD (single location) — not unique, multiple sheets per date allowed (e.g. separate shifts)
    source TEXT NOT NULL DEFAULT 'image',           -- 'image' | 'xlsx' | 'seed'
    file_path TEXT,
    total_in REAL NOT NULL DEFAULT 0,
    total_out REAL NOT NULL DEFAULT 0,
    match_amount REAL NOT NULL DEFAULT 0,
    loan_rtn REAL NOT NULL DEFAULT 0,
    start_bank REAL,
    end_bank REAL,
    meter_profit REAL,                              -- (in + loan_rtn) - (out + match + expenses)
    cash_profit REAL,                               -- actual counted cash profit
    over_short REAL,                                -- cash_profit - meter_profit
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'review',          -- 'review' | 'verified'
    validation_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS machine_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
    machine_number INTEGER NOT NULL,
    prev_in REAL NOT NULL DEFAULT 0,
    curr_in REAL NOT NULL DEFAULT 0,
    daily_in REAL NOT NULL DEFAULT 0,
    prev_out REAL NOT NULL DEFAULT 0,
    curr_out REAL NOT NULL DEFAULT 0,
    daily_out REAL NOT NULL DEFAULT 0,
    UNIQUE(sheet_id, machine_number)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_id INTEGER NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    note TEXT
  );

  -- Recurring overhead costs (rent, electricity, etc.) — independent of daily sheets
  CREATE TABLE IF NOT EXISTS other_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_date TEXT NOT NULL,                     -- YYYY-MM-DD
    category TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    note TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Tracks whether the monthly 40/60 net-profit split has been paid out
  CREATE TABLE IF NOT EXISTS profit_splits (
    month TEXT PRIMARY KEY,                         -- YYYY-MM
    paid INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    paid_by TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sheets_date ON sheets(sheet_date);
  CREATE INDEX IF NOT EXISTS idx_readings_sheet ON machine_readings(sheet_id);
  CREATE INDEX IF NOT EXISTS idx_readings_machine ON machine_readings(machine_number);
  CREATE INDEX IF NOT EXISTS idx_other_expenses_date ON other_expenses(expense_date);
`);
