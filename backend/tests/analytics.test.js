import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin, signInAsApprovedUser } from './helpers/testServer.js';

function buildSheetXlsx({ machine1In = 100, machine1Out = 50 } = {}) {
  const wb = xlsx.utils.book_new();
  const totalIn = machine1In;
  const totalOut = machine1Out;
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, machine1In, machine1In, 0, machine1Out, machine1Out, '50%'],
    ['Total', '', '', totalIn, '', '', totalOut, '50%'],
    [],
    ['Total Out', '$', totalOut, 'Total In', '$', totalIn, 'Bank'],
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

describe('/api/analytics — admin-only deeper analytics', () => {
  let ctx, adminCookie, userCookie;
  before(async () => {
    ctx = await startTestServer();
    adminCookie = await signInAsAdmin(ctx.baseUrl);
    userCookie = await signInAsApprovedUser(ctx.baseUrl, adminCookie);

    // Two Mondays (2026-05-04 and 2026-05-11) with different profit, one Tuesday (2026-05-05)
    await uploadXlsx(ctx.baseUrl, adminCookie, '2026-05-04', { machine1In: 200, machine1Out: 50 }); // meter profit 150
    await uploadXlsx(ctx.baseUrl, adminCookie, '2026-05-11', { machine1In: 100, machine1Out: 50 });  // meter profit 50
    await uploadXlsx(ctx.baseUrl, adminCookie, '2026-05-05', { machine1In: 300, machine1Out: 100 }); // meter profit 200, Tuesday
  });
  after(async () => { await ctx.stop(); });

  test('non-admin approved user gets 403 on all three summary endpoints', async () => {
    for (const path of ['/api/analytics/weekday', '/api/analytics/week', '/api/analytics/month']) {
      const res = await fetch(`${ctx.baseUrl}${path}`, { headers: { Cookie: userCookie } });
      assert.equal(res.status, 403, `${path} should be admin-gated`);
    }
  });

  test('by-weekday averages Monday across both Mondays and keeps Tuesday separate', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/weekday`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const rows = await res.json();

    const monday = rows.find((r) => r.label === 'Monday');
    assert.ok(monday, 'expected a Monday bucket');
    assert.equal(monday.sheet_count, 2);
    assert.equal(monday.avg_meter_profit, 100); // (150 + 50) / 2

    const tuesday = rows.find((r) => r.label === 'Tuesday');
    assert.ok(tuesday, 'expected a Tuesday bucket');
    assert.equal(tuesday.sheet_count, 1);
    assert.equal(tuesday.avg_meter_profit, 200);
  });

  test('weekday drill-down returns per-machine averages for that weekday only', async () => {
    // day=1 is Monday
    const res = await fetch(`${ctx.baseUrl}/api/analytics/weekday/1/machines`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const machines = await res.json();
    assert.equal(machines.length, 1);
    assert.equal(machines[0].machine_number, 1);
    assert.equal(machines[0].avg_daily_in, 150); // (200 + 100) / 2
    assert.equal(machines[0].avg_daily_out, 50);
    assert.equal(machines[0].avg_net, 100);
  });

  test('by-week groups the two Mondays into different weeks (they are 7 days apart)', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/week`, { headers: { Cookie: adminCookie } });
    const rows = await res.json();
    const weeksWithData = rows.filter((r) => r.sheet_count > 0);
    assert.equal(weeksWithData.length, 2, 'the two Mondays are 7 days apart, so 2 distinct weeks');
  });

  test('by-month groups all three sheets into the same month (all May 2026)', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/month`, { headers: { Cookie: adminCookie } });
    const rows = await res.json();
    const may = rows.find((r) => r.key === '2026-05');
    assert.ok(may);
    assert.equal(may.sheet_count, 3);
  });

  test('month drill-down returns per-machine averages across all three sheets', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/month/2026-05/machines`, { headers: { Cookie: adminCookie } });
    const machines = await res.json();
    assert.equal(machines.length, 1);
    assert.equal(machines[0].reading_count, 3);
  });

  test('non-admin gets 403 on day-of-month, pay-period, leaderboard, and trend', async () => {
    for (const path of ['/api/analytics/day-of-month', '/api/analytics/pay-period', '/api/analytics/leaderboard', '/api/analytics/trend']) {
      const res = await fetch(`${ctx.baseUrl}${path}`, { headers: { Cookie: userCookie } });
      assert.equal(res.status, 403, `${path} should be admin-gated`);
    }
  });

  test('by-day-of-month keeps each day separate (days 4, 5, 11)', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/day-of-month`, { headers: { Cookie: adminCookie } });
    const rows = await res.json();
    const day4 = rows.find((r) => r.key === '4');
    const day11 = rows.find((r) => r.key === '11');
    assert.equal(day4.avg_meter_profit, 150);
    assert.equal(day11.avg_meter_profit, 50);
  });

  test('by-pay-period rolls days 4 and 5 into "early", day 11 into "mid"', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/pay-period`, { headers: { Cookie: adminCookie } });
    const rows = await res.json();
    const early = rows.find((r) => r.key === 'early');
    const mid = rows.find((r) => r.key === 'mid');
    const late = rows.find((r) => r.key === 'late');
    assert.equal(early.sheet_count, 2);
    assert.equal(early.avg_meter_profit, 175); // (150 + 200) / 2
    assert.equal(mid.sheet_count, 1);
    assert.equal(mid.avg_meter_profit, 50);
    assert.equal(late.sheet_count, 0);
  });

  test('pay-period drill-down returns machines only for sheets in that period', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/pay-period/early/machines`, { headers: { Cookie: adminCookie } });
    const machines = await res.json();
    assert.equal(machines.length, 1);
    assert.equal(machines[0].reading_count, 2); // days 4 and 5 only, not day 11
  });

  test('pay-period rejects an unknown period key', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/pay-period/bogus/machines`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 400);
  });

  test('leaderboard aggregates all-time totals for machine 1 across all three sheets', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/leaderboard`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.equal(rows.length, 1);
    const m1 = rows[0];
    assert.equal(m1.machine_number, 1);
    assert.equal(m1.reading_count, 3);
    assert.equal(m1.total_in, 600);  // 200 + 300 + 100
    assert.equal(m1.total_out, 200); // 50 + 100 + 50
    assert.equal(m1.total_net, 400);
  });

  test('trend computes one point per calendar date, a moving average, and a linear projection', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/analytics/trend`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.days_tracked, 3);
    assert.deepEqual(data.daily.map((d) => d.date), ['2026-05-04', '2026-05-05', '2026-05-11']);
    assert.deepEqual(data.daily.map((d) => d.net_profit), [150, 200, 50]);
    assert.equal(data.daily[0].moving_avg, 150);
    assert.equal(data.daily[1].moving_avg, 175); // (150+200)/2
    assert.ok(Math.abs(data.daily[2].moving_avg - 400 / 3) < 0.01); // (150+200+50)/3
    assert.equal(data.direction, 'down'); // slope -50/day
    assert.ok(Math.abs(data.projected_next - 100 / 3) < 0.01); // ~33.33
  });
});
