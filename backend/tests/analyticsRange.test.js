import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

function buildSheetXlsx(totalIn, totalOut) {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, totalIn, totalIn, 0, totalOut, totalOut, '50%'],
    ['Total', '', '', totalIn, '', '', totalOut, '50%'],
    [],
    ['Total Out', '$', totalOut, 'Total In', '$', totalIn, 'Bank'],
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const upload = async (baseUrl, cookie, sheetDate, totalIn, totalOut) => {
  const form = new FormData();
  form.append('file', new Blob([buildSheetXlsx(totalIn, totalOut)]), 'sheet.xlsx');
  form.append('sheet_date', sheetDate);
  await fetch(`${baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
};

// Two sheets a long way apart so a range can isolate one without touching the other.
//   2026-01-05 (Mon) net 100
//   2026-06-08 (Mon) net 900
let ctx, cookie;
const get = (path) => fetch(`${ctx.baseUrl}${path}`, { headers: { Cookie: cookie } }).then((r) => r.json());

before(async () => {
  ctx = await startTestServer();
  cookie = await signInAsAdmin(ctx.baseUrl);
  await upload(ctx.baseUrl, cookie, '2026-01-05', 100, 0);
  await upload(ctx.baseUrl, cookie, '2026-06-08', 900, 0);
});
after(async () => { await ctx.stop(); });

describe('/api/analytics — date range filtering', () => {
  test('with no range every sheet counts, so All Time needs no special case', async () => {
    const overview = await get('/api/analytics/overview');
    assert.equal(overview.per_day.sheet_count, 2);
    assert.equal(overview.per_day.avg_net_profit, 500); // (100 + 900) / 2
  });

  test('a range narrows the overview to just the sheets inside it', async () => {
    const jan = await get('/api/analytics/overview?from=2026-01-01&to=2026-01-31');
    assert.equal(jan.per_day.sheet_count, 1);
    assert.equal(jan.per_day.avg_net_profit, 100, 'only the January sheet');

    const jun = await get('/api/analytics/overview?from=2026-06-01&to=2026-06-30');
    assert.equal(jun.per_day.sheet_count, 1);
    assert.equal(jun.per_day.avg_net_profit, 900, 'only the June sheet');
  });

  test('the weekday breakdown respects the range', async () => {
    const all = await get('/api/analytics/weekday');
    const allMon = all.find((r) => r.label === 'Monday');
    assert.equal(allMon.sheet_count, 2, 'both sheets fall on a Monday');

    const jan = await get('/api/analytics/weekday?from=2026-01-01&to=2026-01-31');
    const janMon = jan.find((r) => r.label === 'Monday');
    assert.equal(janMon.sheet_count, 1);
    assert.equal(janMon.avg_net_profit, 100);
  });

  test('a drill-down uses the same window as the summary it came from', async () => {
    // Monday = 1. Unscoped sees both sheets; scoped to January sees only that one.
    const all = await get('/api/analytics/weekday/1/machines');
    assert.equal(all[0].reading_count, 2);

    const jan = await get('/api/analytics/weekday/1/machines?from=2026-01-01&to=2026-01-31');
    assert.equal(jan[0].reading_count, 1, 'drill-down must not silently widen back to all time');
  });

  test('weekend-split, day-of-month, pay-period and trend all narrow too', async () => {
    const q = '?from=2026-01-01&to=2026-01-31';

    const split = await get(`/api/analytics/weekend-split${q}`);
    assert.equal(split.find((r) => r.key === 'weekday').sheet_count, 1);
    assert.equal(split.find((r) => r.key === 'weekend').sheet_count, 0);

    const dom = await get(`/api/analytics/day-of-month${q}`);
    assert.deepEqual(dom.map((r) => r.key), ['5'], 'only the 5th has a sheet in January');

    const pay = await get(`/api/analytics/pay-period${q}`);
    assert.equal(pay.find((r) => r.key === 'early').sheet_count, 1);
    assert.equal(pay.find((r) => r.key === 'mid').sheet_count, 0);

    const trend = await get(`/api/analytics/trend${q}`);
    assert.equal(trend.days_tracked, 1);
  });

  test('the leaderboard stays all-time on purpose — it asks which machines are worth keeping', async () => {
    const scoped = await get('/api/analytics/leaderboard?from=2026-01-01&to=2026-01-31');
    assert.equal(scoped[0].total_in, 1000, 'both sheets, regardless of the range');
    assert.equal(scoped[0].reading_count, 2);
  });
});
