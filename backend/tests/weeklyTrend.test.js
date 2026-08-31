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
  test('returns a fixed twelve-week window, oldest first', async () => {
    const { weeklyTrend } = await dashboard();
    assert.equal(weeklyTrend.length, 12);
    const periods = weeklyTrend.map((w) => w.period);
    assert.deepEqual(periods, [...periods].sort(), 'oldest first');
    assert.equal(periods[periods.length - 1], iso(THIS_MONDAY), 'ends with the current week');
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

  test('weeks with no sheets are present as zero, not omitted', async () => {
    const { weeklyTrend } = await dashboard();
    const empty = weeklyTrend.filter((w) => w.net_profit === 0 && w.expenses === 0);
    assert.ok(empty.length >= 9, 'the quiet weeks still appear so the gap is visible');
  });

  test('carries only what the chart plots — net profit and expenses', async () => {
    const { weeklyTrend } = await dashboard();
    assert.deepEqual(Object.keys(weeklyTrend[0]).sort(), ['expenses', 'label', 'net_profit', 'period']);
  });

  // The default range is a single week; a range-driven weekly chart would be one point.
  test('ignores the page range, unlike the day buckets', async () => {
    const narrow = await (await fetch(
      `${ctx.baseUrl}/api/dashboard?from=${iso(THIS_MONDAY)}&to=${iso(THIS_MONDAY)}`,
      { headers: { Cookie: cookie } },
    )).json();
    assert.equal(narrow.weeklyTrend.length, 12, 'still twelve weeks');
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
