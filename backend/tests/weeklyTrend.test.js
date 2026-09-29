import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

function buildSheetXlsx(totalIn) {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, totalIn, totalIn, 0, 0, 0, '100%'],
    ['Total', '', '', totalIn, '', '', 0, '100%'],
    [],
    ['Total Out', '$', 0, 'Total In', '$', totalIn, 'Bank'],
  ];
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(rows), 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (base, n) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return d; };
/** Monday of the week containing `d`, matching the app's Mon–Sun weeks. */
const mondayOf = (d) => addDays(d, -((d.getUTCDay() + 6) % 7));

// Dates are derived from the real clock rather than hard-coded: the weekly trend is a rolling
// window on today, so fixed dates would fall out of it as time passes.
const TODAY = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const THIS_MONDAY = mondayOf(TODAY);
const LAST_MONDAY = addDays(THIS_MONDAY, -7);

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same db singleton.
let ctx, cookie;
before(async () => {
  ctx = await startTestServer();
  cookie = await signInAsAdmin(ctx.baseUrl);

  const upload = async (date, amount) => {
    const form = new FormData();
    form.append('file', new Blob([buildSheetXlsx(amount)]), 'sheet.xlsx');
    form.append('sheet_date', date);
    const res = await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
    assert.equal(res.status, 200, `upload for ${date} should succeed`);
  };
  // Two days in this week, one in last week — one sheet per day, per the upload rule.
  await upload(iso(THIS_MONDAY), 1000);
  await upload(iso(addDays(THIS_MONDAY, 1)), 500);
  await upload(iso(LAST_MONDAY), 800);
});
after(async () => { await ctx.stop(); });

const dashboard = async () =>
  (await fetch(`${ctx.baseUrl}/api/dashboard`, { headers: { Cookie: cookie } })).json();

const weekFor = (trend, monday) => trend.find((w) => w.period === iso(monday));

describe('the weekly profit trend', () => {
  test('runs oldest first and ends with the current week', async () => {
    const { weeklyTrend } = await dashboard();
    const periods = weeklyTrend.map((w) => w.period);
    assert.deepEqual(periods, [...periods].sort(), 'oldest first');
    assert.equal(periods[periods.length - 1], iso(THIS_MONDAY), 'ends with the current week');
    assert.ok(weeklyTrend.length <= 12, 'never longer than the twelve-week lookback');
  });

  // Weeks before anything was recorded are empty by definition; a flat run-up into the first
  // sheet reads as a slump rather than as "no data yet".
  test('never starts earlier than the first thing on record', async () => {
    const { weeklyTrend } = await dashboard();
    assert.equal(weeklyTrend[0].period, iso(LAST_MONDAY), 'starts at the earliest sheet\u2019s week');
    assert.equal(weeklyTrend.length, 2, 'last week and this week — not a padded twelve');
  });

  test('every bucket starts on a Monday', async () => {
    const { weeklyTrend } = await dashboard();
    for (const w of weeklyTrend) {
      const d = new Date(`${w.period}T00:00:00Z`);
      assert.equal(d.getUTCDay(), 1, `${w.period} should be a Monday`);
    }
  });

  test('days within one week are summed into it', async () => {
    const { weeklyTrend } = await dashboard();
    assert.equal(weekFor(weeklyTrend, THIS_MONDAY).net_profit, 1500, '1000 + 500 in the same week');
    assert.equal(weekFor(weeklyTrend, LAST_MONDAY).net_profit, 800);
  });

  test('a quiet week between two active ones still appears as zero', async () => {
    // A sheet three weeks back leaves a genuine gap in the middle, which must stay visible.
    const gapWeek = addDays(THIS_MONDAY, -21);
    const form = new FormData();
    form.append('file', new Blob([buildSheetXlsx(300)]), 'sheet.xlsx');
    form.append('sheet_date', iso(gapWeek));
    assert.equal((await fetch(`${ctx.baseUrl}/api/sheets/upload`, {
      method: 'POST', headers: { Cookie: cookie }, body: form,
    })).status, 200);

    const { weeklyTrend } = await dashboard();
    assert.equal(weeklyTrend.length, 4, 'three weeks back through this one');
    assert.equal(weeklyTrend[0].period, iso(gapWeek), 'window now reaches the older sheet');
    const middle = weeklyTrend[1];
    assert.equal(middle.net_profit, 0, 'the empty week in the middle is kept, not closed up');
    assert.equal(middle.expenses, 0);
  });

  test('carries only what the chart plots', async () => {
    const { weeklyTrend } = await dashboard();
    assert.deepEqual(Object.keys(weeklyTrend[0]).sort(),
      ['expenses', 'label', 'net_profit', 'period', 'total_in', 'total_out']);
  });

  test('money in and out are summed per week alongside the profit', async () => {
    const { weeklyTrend } = await dashboard();
    // The fixture uploads sheets with totalOut 0, so in is the whole of the activity.
    const thisWeek = weekFor(weeklyTrend, THIS_MONDAY);
    assert.equal(thisWeek.total_in, 1500, '1000 on Monday + 500 on Tuesday');
    assert.equal(thisWeek.total_out, 0);
    assert.equal(weekFor(weeklyTrend, LAST_MONDAY).total_in, 800);
  });

  test('a week with no sheets reports zero in and out, not undefined', async () => {
    const { weeklyTrend } = await dashboard();
    const empty = weeklyTrend.find((w) => w.total_in === 0 && w.net_profit === 0);
    if (empty) {
      assert.equal(empty.total_out, 0);
      assert.equal(typeof empty.total_in, 'number');
    }
  });

  // The default range is a single week; a range-driven weekly chart would be one point.
  test('ignores the page range, unlike the day buckets', async () => {
    const narrow = await (await fetch(
      `${ctx.baseUrl}/api/dashboard?from=${iso(THIS_MONDAY)}&to=${iso(THIS_MONDAY)}`,
      { headers: { Cookie: cookie } },
    )).json();
    const { weeklyTrend: full } = await dashboard();
    assert.equal(narrow.weeklyTrend.length, full.length, 'the weekly window is unchanged by the range');
    assert.equal(narrow.buckets.length, 1, 'while the range-driven buckets narrow to the one day');
  });

  test('expenses are counted against the week they fall in', async () => {
    await fetch(`${ctx.baseUrl}/api/expenses`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expense_date: iso(addDays(THIS_MONDAY, 2)), category: 'rent', amount: 200 }),
    });
    const { weeklyTrend } = await dashboard();
    const wk = weekFor(weeklyTrend, THIS_MONDAY);
    assert.equal(wk.expenses, 200);
    assert.equal(wk.net_profit, 1300, 'net profit drops by the expense');
  });
});

describe('a stale record set still renders', () => {
  // A plain rolling window goes blank once the last batch of sheets is older than the
  // lookback — which is exactly when you most want to see when activity stopped.
  test('stale data is still shown rather than the chart going blank', async () => {
    const stale = new Date(addDays(THIS_MONDAY, -7 * 20)); // 20 weeks back, well past the lookback
    const form = new FormData();
    form.append('file', new Blob([buildSheetXlsx(700)]), 'sheet.xlsx');
    form.append('sheet_date', iso(stale));
    assert.equal((await fetch(`${ctx.baseUrl}/api/sheets/upload`, {
      method: 'POST', headers: { Cookie: cookie }, body: form,
    })).status, 200);

    // Everything recent has to go, sheets and manual expenses alike — either would count as
    // activity and keep the window where it is.
    const sheets = await (await fetch(`${ctx.baseUrl}/api/sheets`, { headers: { Cookie: cookie } })).json();
    for (const sh of sheets.filter((r) => r.sheet_date !== iso(stale))) {
      await fetch(`${ctx.baseUrl}/api/sheets/${sh.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    }
    const { expenses } = await (await fetch(`${ctx.baseUrl}/api/expenses`, { headers: { Cookie: cookie } })).json();
    // Only manually logged ones are deletable here; a sheet's own went with the sheet.
    for (const e of expenses.filter((x) => x.source === 'other')) {
      await fetch(`${ctx.baseUrl}/api/expenses/${e.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    }

    const { weeklyTrend } = await dashboard();
    assert.ok(weeklyTrend.length > 12, 'the window stretches to reach the old data');
    assert.equal(weeklyTrend[0].period, iso(mondayOf(stale)), 'it starts at the stale week');
    assert.equal(weeklyTrend[0].net_profit, 700, 'and the figures are there');
    assert.equal(weeklyTrend[weeklyTrend.length - 1].period, iso(THIS_MONDAY), 'still ending at this week');
  });
});
