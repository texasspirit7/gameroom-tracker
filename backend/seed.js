import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { computeMeterProfit } from './extract/validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-data.json'), 'utf8'));

for (const sheet of data.sheets) {
  const existing = db.prepare('SELECT id FROM sheets WHERE sheet_date = ?').get(sheet.sheet_date);
  if (existing) {
    console.log(`Sheet ${sheet.sheet_date} already exists — skipping`);
    continue;
  }

  const meterProfit = computeMeterProfit(sheet);
  const cashProfit = sheet.bank?.cash_profit ?? null;
  const overShort = cashProfit != null ? cashProfit - meterProfit : null;

  const result = db.prepare(`
    INSERT INTO sheets (sheet_date, source, total_in, total_out, match_amount, loan_rtn,
      start_bank, end_bank, meter_profit, cash_profit, over_short, status, validation_json)
    VALUES (?, 'seed', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', '[]')
  `).run(
    sheet.sheet_date,
    sheet.totals.total_in, sheet.totals.total_out,
    sheet.settlement.match_amount, sheet.settlement.loan_rtn,
    sheet.bank?.start_bank ?? null, sheet.bank?.end_bank ?? null,
    meterProfit, cashProfit, overShort
  );
  const sheetId = result.lastInsertRowid;

  const insReading = db.prepare(`
    INSERT INTO machine_readings (sheet_id, machine_number, prev_in, curr_in, daily_in, prev_out, curr_out, daily_out)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [n, pIn, cIn, dIn, pOut, cOut, dOut] of sheet.machines) {
    insReading.run(sheetId, n, pIn, cIn, dIn, pOut, cOut, dOut);
  }

  const insExpense = db.prepare('INSERT INTO expenses (sheet_id, category, amount) VALUES (?, ?, ?)');
  for (const e of sheet.expenses) insExpense.run(sheetId, e.category, e.amount);

  console.log(`Seeded ${sheet.sheet_date}: meter profit ${meterProfit}, cash ${cashProfit ?? 'n/a'}, over/short ${overShort ?? 'n/a'}`);
}

console.log('Seed complete.');
