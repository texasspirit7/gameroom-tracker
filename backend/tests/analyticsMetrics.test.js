import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin, signInAsApprovedUser } from './helpers/testServer.js';

function buildSheetXlsx({ totalIn, totalOut, match = 0, expense = 0 }) {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, totalIn, totalIn, 0, totalOut, totalOut, '50%'],
    ['Total', '', '', totalIn, '', '', totalOut, '50%'],
    [],
    ['Total Out', '$', totalOut, 'Total In', '$', totalIn, 'Bank'],
    ...(match ? [['Match', '', match]] : []),
    ...(expense ? [['Cleaning', '', expense]] : []),
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function uploadXlsx(baseUrl, cookie, sheetDate, values) {
  const form = new FormData();
  form.append('file', new Blob([buildSheetXlsx(values)]), 'sheet.xlsx');
  form.append('sheet_date', sheetDate);
  const res = await fetch(`${baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  return res.json();
}

// A clean reference week: Mon 07-06 .. Sun 07-12, entirely within one calendar week and month —
// makes the expected per-week/per-month averages simple to hand-verify (see comments below).
describe('/api/analytics — match, expenses, and weekday/weekend split', () => {
  let ctx, adminCookie, userCookie;
  before(async () => {
    ctx = await startTestServer();
    adminCookie = await signInAsAdmin(ctx.baseUrl);
    userCookie = await signInAsApprovedUser(ctx.baseUrl, adminCookie);

    await uploadXlsx(ctx.baseUrl, adminCookie, '2026-07-06', { totalIn: 200, totalOut: 50, expense: 20 });   // Mon — weekday, meter_profit 150, net_profit 130
    await uploadXlsx(ctx.baseUrl, adminCookie, '2026-07-09', { totalIn: 100, totalOut: 50, match: 20 });     // Thu — weekday, meter_profit 30, net_profit 30
    await uploadXlsx(ctx.baseUrl, adminCookie, '2026-07-10', { totalIn: 300, totalOut: 100, match: 50, expense: 30 }); // Fri — weekend, meter_profit 150, net_profit 120
    await uploadXlsx(ctx.baseUrl, adminCookie, '2026-07-11', { totalIn: 400, totalOut: 150 });                // Sat — weekend, meter_profit 250, net_profit 250
    await uploadXlsx(ctx.baseUrl, adminCookie, '2026-07-12', { totalIn: 100, totalOut: 100 });                // Sun — weekend, meter_profit 0, net_profit 0
  });
  after(async () => { await ctx.stop(); });

  test('non-admin gets 403 on the new endpoints', async () => {
    for (const path of ['/api/analytics/weekend-split', '/api/analytics/overview']) {
      const res = await fetch(`${ctx.baseUrl}${path}`, { headers: { Cookie: userCookie } });
      assert.equal(res.status, 403, `${path} should be admin-gated`);
    }
  });

  test('by-week summary carries avg_match and avg_expenses alongside the existing fields', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/week`, { headers: { Cookie: adminCookie } });
    const rows = await res.json();
    const week = rows.find((r) => r.sheet_count === 5);
    assert.ok(week, 'expected all 5 sheets in one calendar week');
    assert.equal(week.avg_match, 14); // (0+20+50+0+0)/5
    assert.equal(week.avg_expenses, 10); // (20+0+30+0+0)/5
  });

  test('weekend-split buckets Fri/Sat/Sun as weekend and Mon–Thu as weekday', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/weekend-split`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const rows = await res.json();

    const weekday = rows.find((r) => r.key === 'weekday');
    assert.equal(weekday.sheet_count, 2); // Mon, Thu
    assert.equal(weekday.avg_total_in, 150); // (200+100)/2
    assert.equal(weekday.avg_match, 10); // (0+20)/2
    assert.equal(weekday.avg_expenses, 10); // (20+0)/2

    const weekend = rows.find((r) => r.key === 'weekend');
    assert.equal(weekend.sheet_count, 3); // Fri, Sat, Sun
    assert.ok(Math.abs(weekend.avg_total_in - 800 / 3) < 0.01); // (300+400+100)/3
    assert.ok(Math.abs(weekend.avg_match - 50 / 3) < 0.01); // (50+0+0)/3
    assert.ok(Math.abs(weekend.avg_expenses - 10) < 0.01); // (30+0+0)/3
  });

  test('weekend-split drill-down returns machine averages scoped to that bucket only', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/weekend-split/weekday/machines`, { headers: { Cookie: adminCookie } });
    const machines = await res.json();
    assert.equal(machines.length, 1);
    assert.equal(machines[0].reading_count, 2); // Mon + Thu only, not the 3 weekend sheets
  });

  test('weekend-split drill-down rejects an unknown key', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/weekend-split/someday/machines`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 400);
  });

  test('overview: per-day average is the plain mean across all 5 sheets', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/overview`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.per_day.avg_total_in, 220); // 1100/5
    assert.equal(data.per_day.avg_match, 14); // 70/5
    assert.equal(data.per_day.avg_expenses, 10); // 50/5
  });

  test('overview: per-week and per-month average over distinct periods, not per sheet', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/overview`, { headers: { Cookie: adminCookie } });
    const data = await res.json();

    // All 5 sheets fall in the same single calendar week and the same single month, so the
    // "per period" average equals the raw sum, not the per-sheet average (220 above).
    assert.equal(data.per_week.period_count, 1);
    assert.equal(data.per_week.avg_total_in, 1100);
    assert.equal(data.per_week.avg_expenses, 50);

    assert.equal(data.per_month.period_count, 1);
    assert.equal(data.per_month.avg_total_in, 1100);
    assert.equal(data.per_month.avg_meter_profit, 580);
  });
});
