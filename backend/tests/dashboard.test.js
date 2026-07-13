import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

function buildSheetXlsx() {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, 100, 100, 0, 50, 50, '50%'],
    ['Total', '', '', 100, '', '', 50, '50%'],
    [],
    ['Total Out', '$', 50, 'Total In', '$', 100, 'Bank'],
    ['Match', '', 20],
    ['Cleaning', '', 15],
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('GET /api/dashboard — per-bucket chart data (regression: Profit trend by day fields)', () => {
  let ctx, cookie;
  before(async () => {
    ctx = await startTestServer();
    cookie = await signInAsAdmin(ctx.baseUrl);

    const form = new FormData();
    form.append('file', new Blob([buildSheetXlsx()]), 'sheet.xlsx');
    form.append('sheet_date', '2026-08-03');
    await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });

    // A manual "other" expense on a different day, to confirm it buckets separately from sheet expenses
    await fetch(`${ctx.baseUrl}/api/expenses`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expense_date: '2026-08-04', category: 'rent', amount: 200 }),
    });
  });
  after(async () => { await ctx.stop(); });

  test('the sheet day bucket includes total_in, total_out, match, expenses, meter_profit, net_profit', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/dashboard?from=2026-08-01&to=2026-08-10&label=test`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const data = await res.json();

    const day3 = data.buckets.find((b) => b.period === '2026-08-03');
    assert.ok(day3, 'expected a bucket for 2026-08-03');
    assert.equal(day3.total_in, 100);
    assert.equal(day3.total_out, 50);
    assert.equal(day3.match, 20);
    assert.equal(day3.meter_profit, 30); // (100+0) - (50+20)
    assert.equal(day3.expenses, 15); // sheet-linked "cleaning" only, not the other-expense on the 4th
    assert.equal(day3.net_profit, 15); // 30 - 15
  });

  test('a manually-logged expense with no sheet still creates its own bucket', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/dashboard?from=2026-08-01&to=2026-08-10&label=test`, { headers: { Cookie: cookie } });
    const data = await res.json();

    const day4 = data.buckets.find((b) => b.period === '2026-08-04');
    assert.ok(day4, 'expected a bucket for 2026-08-04 from the other_expenses entry alone');
    assert.equal(day4.expenses, 200);
    assert.equal(day4.meter_profit, 0);
    assert.equal(day4.net_profit, -200);
  });

  test('buckets are sorted chronologically', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/dashboard?from=2026-08-01&to=2026-08-10&label=test`, { headers: { Cookie: cookie } });
    const data = await res.json();
    const periods = data.buckets.map((b) => b.period);
    const sorted = [...periods].sort();
    assert.deepEqual(periods, sorted);
  });
});
