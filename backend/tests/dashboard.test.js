import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

function buildSheetXlsx(extraRows = []) {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, 100, 100, 0, 50, 50, '50%'],
    ['Total', '', '', 100, '', '', 50, '50%'],
    [],
    ['Total Out', '$', 50, 'Total In', '$', 100, 'Bank'],
    ['Match', '', 20],
    ['Cleaning', '', 15],
    ...extraRows,
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function uploadXlsx(baseUrl, cookie, buf, sheetDate) {
  const form = new FormData();
  form.append('file', new Blob([buf]), 'sheet.xlsx');
  form.append('sheet_date', sheetDate);
  const res = await fetch(`${baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  return res.json();
}

// One shared server for the whole file — see upload.test.js for why a second
// startTestServer() call in the same file must be avoided (stale/closed db.js
// module reuse). Tests below use distinct dates to stay isolated.
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

describe('GET /api/dashboard — per-bucket chart data (regression: Profit trend by day fields)', () => {
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

describe('GET /api/dashboard — alerts (regression: "Cash short" must not trust an unreconciled paper reading)', () => {
  test('an unreconciled Short/Over reading is excluded from the Cash short total, and surfaces as a low-level nudge instead', async () => {
    // total activity = 150 (100 in + 50 out); -40 is plausible, but never manually reconciled (no cash_profit).
    const { sheetId } = await uploadXlsx(ctx.baseUrl, cookie, buildSheetXlsx([['Short/Over', '', -40]]), '2026-09-01');
    assert.ok(sheetId);

    const res = await fetch(`${ctx.baseUrl}/api/dashboard?from=2026-09-01&to=2026-09-01&label=test`, { headers: { Cookie: cookie } });
    const data = await res.json();

    assert.ok(!data.alerts.some((a) => a.message.startsWith('Cash short')), 'unreconciled reading must not produce a Cash short alert');
    const nudge = data.alerts.find((a) => a.level === 'low');
    assert.ok(nudge, 'expected a low-level nudge to reconcile the sheet');
    assert.match(nudge.message, /1 sheet has an unverified Short\/Over reading/);
  });

  test('reconciling via Cash Profit makes the sheet count toward Cash short and clears the nudge', async () => {
    const { sheetId } = await uploadXlsx(ctx.baseUrl, cookie, buildSheetXlsx([['Short/Over', '', -40]]), '2026-09-02');

    // meter_profit for this sheet is 30 (100 - (50+20)); cash_profit = -100 => over_short = -130.
    const patchRes = await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cash_profit: -100 }),
    });
    assert.equal(patchRes.status, 200);

    const res = await fetch(`${ctx.baseUrl}/api/dashboard?from=2026-09-02&to=2026-09-02&label=test`, { headers: { Cookie: cookie } });
    const data = await res.json();

    const cashAlert = data.alerts.find((a) => a.message.startsWith('Cash short'));
    assert.ok(cashAlert, 'expected a Cash short alert once reconciled');
    assert.match(cashAlert.message, /\$130/);
    assert.ok(!data.alerts.some((a) => a.level === 'low'), 'nudge should clear once reconciled');
  });

  test('a physically implausible Short/Over reading is rejected at upload time, not stored as fact', async () => {
    // total activity = 150; -500 can't be real — reject and flag instead of trusting it.
    const { sheetId, warnings } = await uploadXlsx(ctx.baseUrl, cookie, buildSheetXlsx([['Short/Over', '', -500]]), '2026-09-03');
    assert.ok(warnings.some((w) => w.includes('implausible')), 'expected an implausible-reading warning');

    const sheetRes = await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, { headers: { Cookie: cookie } });
    const sheet = await sheetRes.json();
    assert.equal(sheet.over_short, null, 'implausible reading must be nulled out, not stored');
  });
});
