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
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('/api/profit-split — admin-only page', () => {
  let ctx, adminCookie, userCookie;
  before(async () => {
    ctx = await startTestServer();
    adminCookie = await signInAsAdmin(ctx.baseUrl);
    userCookie = await signInAsApprovedUser(ctx.baseUrl, adminCookie);

    const form = new FormData();
    form.append('file', new Blob([buildSheetXlsx()]), 'sheet.xlsx');
    form.append('sheet_date', '2026-04-01');
    await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: adminCookie }, body: form });
  });
  after(async () => { await ctx.stop(); });

  test('a non-admin approved user gets 403', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: userCookie } });
    assert.equal(res.status, 403);
  });

  test('admin gets 200 with one row for the month, net profit and 40/60 split amounts', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const rows = await res.json();
    const row = rows.find((r) => r.month === '2026-04');
    assert.ok(row, 'expected a row for 2026-04');
    assert.equal(row.net_profit, 50); // (100+0)-(50+0)
    assert.equal(row.amount_40, 20);
    assert.equal(row.amount_60, 30);
    assert.equal(row.paid, false);
  });

  test('non-admin cannot toggle paid status', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/2026-04`, {
      method: 'PATCH', headers: { Cookie: userCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ paid: true }),
    });
    assert.equal(res.status, 403);
  });

  test('admin can mark a month paid, and it persists', async () => {
    await fetch(`${ctx.baseUrl}/api/profit-split/2026-04`, {
      method: 'PATCH', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ paid: true }),
    });
    const rows = await (await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: adminCookie } })).json();
    const row = rows.find((r) => r.month === '2026-04');
    assert.equal(row.paid, true);
    assert.ok(row.paid_at);
    assert.equal(row.paid_by, 'admin@test.local');
  });
});
