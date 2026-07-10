import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

function buildSheetWithBank({ overShort }) {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, 100, 100, 0, 50, 50, '50%'],
    ['Total', '', '', 100, '', '', 50, '50%'],
    [],
    ['Total Out', '$', 50, 'Total In', '$', 100, 'Bank'],
    ['', '', '', '', '', '', 'Short/Over', overShort],
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function uploadXlsx(baseUrl, cookie, buffer, sheetDate) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), 'sheet.xlsx');
  form.append('sheet_date', sheetDate);
  const res = await fetch(`${baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  return res.json();
}

// One shared server for the whole file — Node caches ES modules per process,
// so a second startTestServer() call here would silently reuse (and, after
// the first block's teardown, find *closed*) the same db.js singleton rather
// than getting a fresh one. Tests below use distinct sheet_dates to stay isolated.
let ctx, cookie;
before(async () => {
  ctx = await startTestServer();
  cookie = await signInAsAdmin(ctx.baseUrl);
});
after(async () => { await ctx.stop(); });

describe('PATCH /api/sheets/:id (regression: over_short must not be wiped when cash_profit is unset)', () => {
  test('a no-op save (no cash_profit change) preserves the sheet-extracted over_short', async () => {
    const buf = buildSheetWithBank({ overShort: -86 });
    const { sheetId } = await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-02-01');

    const before_ = await (await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, { headers: { Cookie: cookie } })).json();
    assert.equal(before_.over_short, -86);

    // Edit an unrelated field, cash_profit stays unset
    await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'unrelated edit' }),
    });

    const after_ = await (await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, { headers: { Cookie: cookie } })).json();
    assert.equal(after_.over_short, -86, 'over_short must survive a save that does not touch cash_profit');
  });

  test('setting cash_profit recomputes over_short as cash_profit - meter_profit', async () => {
    const buf = buildSheetWithBank({ overShort: -86 });
    const { sheetId } = await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-02-02');

    await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cash_profit: 100 }),
    });

    const sheet = await (await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, { headers: { Cookie: cookie } })).json();
    assert.equal(sheet.meter_profit, 50); // (100+0) - (50+0)
    assert.equal(sheet.over_short, 50);   // 100 - 50
  });
});

describe('GET /api/sheets — list shape (Day/Match/Expenses/Net Profit columns)', () => {
  test('each row includes match_amount, expenses, and net_profit', async () => {
    const buf = buildSheetWithBank({ overShort: 0 });
    await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-03-01');

    const list = await (await fetch(`${ctx.baseUrl}/api/sheets`, { headers: { Cookie: cookie } })).json();
    const row = list.find((r) => r.sheet_date === '2026-03-01');
    assert.ok(row, 'expected the freshly uploaded 2026-03-01 sheet to be in the list');
    assert.ok('match_amount' in row);
    assert.ok('expenses' in row);
    assert.equal(row.net_profit, row.meter_profit - row.expenses);
    assert.ok('has_file' in row);
  });
});
