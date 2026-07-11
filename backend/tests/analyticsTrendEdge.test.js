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
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('/api/analytics — edge cases needing an isolated (near-empty) dataset', () => {
  let ctx, cookie;
  before(async () => {
    ctx = await startTestServer();
    cookie = await signInAsAdmin(ctx.baseUrl);
  });
  after(async () => { await ctx.stop(); });

  test('trend and leaderboard do not error with zero sheets on record', async () => {
    const trendRes = await fetch(`${ctx.baseUrl}/api/analytics/trend`, { headers: { Cookie: cookie } });
    assert.equal(trendRes.status, 200);
    const trend = await trendRes.json();
    assert.equal(trend.days_tracked, 0);
    assert.equal(trend.projected_next, null);
    assert.deepEqual(trend.daily, []);

    const boardRes = await fetch(`${ctx.baseUrl}/api/analytics/leaderboard`, { headers: { Cookie: cookie } });
    assert.equal(boardRes.status, 200);
    assert.deepEqual(await boardRes.json(), []);
  });

  test('a single sheet does not error, and trend reports no projection', async () => {
    const form = new FormData();
    form.append('file', new Blob([buildSheetXlsx()]), 'sheet.xlsx');
    form.append('sheet_date', '2026-06-01');
    await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });

    const res = await fetch(`${ctx.baseUrl}/api/analytics/trend`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.days_tracked, 1);
    assert.equal(data.projected_next, null);
    assert.equal(data.direction, 'flat');
  });
});
