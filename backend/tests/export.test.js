import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin, signInAsApprovedUser } from './helpers/testServer.js';

function buildSheetXlsx() {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, 100, 100, 0, 50, 50, '50%'],
    ['Total', '', '', 100, '', '', 50, '50%'],
    [],
    ['Total Out', '$', 50, 'Total In', '$', 100, 'Bank'],
    ['Cleaning', '', 15],
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Minimal quote-aware CSV row splitter — a plain split(',') breaks on quoted fields
 * that themselves contain commas, which is exactly what this test needs to check. */
function splitCsvRow(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { fields.push(field); field = ''; }
    else field += c;
  }
  fields.push(field);
  return fields;
}

function parseCsv(text) {
  const [header, ...rows] = text.trim().split('\r\n');
  return { header: splitCsvRow(header), rows: rows.map(splitCsvRow) };
}

describe('/api/export — CSV downloads', () => {
  let ctx, adminCookie, userCookie;
  before(async () => {
    ctx = await startTestServer();
    adminCookie = await signInAsAdmin(ctx.baseUrl);
    userCookie = await signInAsApprovedUser(ctx.baseUrl, adminCookie);

    const form = new FormData();
    form.append('file', new Blob([buildSheetXlsx()]), 'sheet.xlsx');
    form.append('sheet_date', '2026-12-01');
    await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: adminCookie }, body: form });

    await fetch(`${ctx.baseUrl}/api/expenses`, {
      method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expense_date: '2026-12-02', category: 'rent, utilities', amount: 300, note: 'has "a quote"' }),
    });
  });
  after(async () => { await ctx.stop(); });

  test('sheets.csv includes a header row and one data row for the uploaded sheet', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/export/sheets.csv?from=2026-12-01&to=2026-12-01`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="sheets-2026-12-01-to-2026-12-01\.csv"/);

    const { header, rows } = parseCsv(await res.text());
    assert.deepEqual(header, [
      'Date', 'Sheet ID', 'Source', 'Total In', 'Total Out', 'Match', 'Loan RTN', 'Start Bank',
      'End Bank', 'Meter Profit', 'Cash Profit', 'Over/Short', 'Expenses', 'Net Profit', 'Status',
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][0], '2026-12-01');
    assert.equal(rows[0][3], '100'); // Total In
    assert.equal(rows[0][12], '15'); // Expenses (Cleaning)
  });

  test('expenses.csv combines sheet-linked and manually-logged expenses, quoting fields with commas/quotes', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/export/expenses.csv?from=2026-12-01&to=2026-12-31`, { headers: { Cookie: adminCookie } });
    const text = await res.text();
    const { rows } = parseCsv(text);
    assert.equal(rows.length, 2);

    assert.match(text, /"rent, utilities"/, 'category with a comma must be wrapped in quotes on the wire');
    assert.match(text, /"has ""a quote"""/, 'internal quotes must be doubled on the wire');

    const manualRow = rows.find((r) => r[1] === 'Manual');
    assert.ok(manualRow, 'expected the manually-logged expense row');
    assert.equal(manualRow[2], 'rent, utilities', 'decodes back to the original category');
    assert.equal(manualRow[4], 'has "a quote"', 'decodes back to the original note');

    const sheetRow = rows.find((r) => r[1] === 'Sheet #1');
    assert.ok(sheetRow, 'expected the sheet-linked expense row');
    assert.equal(sheetRow[2], 'cleaning');
    assert.equal(sheetRow[3], '15');
  });

  test('a non-admin approved user can export sheets/expenses but not profit-split', async () => {
    const sheetsRes = await fetch(`${ctx.baseUrl}/api/export/sheets.csv`, { headers: { Cookie: userCookie } });
    assert.equal(sheetsRes.status, 200);

    const splitRes = await fetch(`${ctx.baseUrl}/api/export/profit-split.csv`, { headers: { Cookie: userCookie } });
    assert.equal(splitRes.status, 403);
  });

  test('profit-split.csv reflects the same net profit/split math as the JSON endpoint', async () => {
    const jsonRows = await (await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: adminCookie } })).json();
    const decRow = jsonRows.find((r) => r.month === '2026-12');
    assert.ok(decRow);

    const csvRes = await fetch(`${ctx.baseUrl}/api/export/profit-split.csv`, { headers: { Cookie: adminCookie } });
    const { header, rows } = parseCsv(await csvRes.text());
    assert.deepEqual(header, ['Month', 'Split', 'Net Profit', '40% Amount', '60% Amount', 'Paid', 'Paid At', 'Paid By', 'Notes']);
    const csvRow = rows.find((r) => r[0] === '2026-12');
    assert.ok(csvRow);
    assert.equal(Number(csvRow[2]), decRow.net_profit);
    assert.equal(Number(csvRow[3]), decRow.amount_40);
  });

  test('no from/to params exports everything on record rather than erroring', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/export/sheets.csv`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const { rows } = parseCsv(await res.text());
    assert.equal(rows.length, 1);
  });
});
