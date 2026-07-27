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

async function upload(baseUrl, cookie, sheetDate) {
  const form = new FormData();
  form.append('file', new Blob([buildSheetXlsx()]), 'sheet.xlsx');
  form.append('sheet_date', sheetDate);
  await fetch(`${baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
}

const coverage = (baseUrl, cookie) =>
  fetch(`${baseUrl}/api/sheets/coverage`, { headers: { Cookie: cookie } }).then((r) => r.json());

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same db singleton.
let ctx, cookie;
before(async () => {
  ctx = await startTestServer();
  cookie = await signInAsAdmin(ctx.baseUrl);
});
after(async () => { await ctx.stop(); });

describe('GET /api/sheets/coverage — days with no sheet', () => {
  test('a single sheet reports no gaps (nothing to span)', async () => {
    await upload(ctx.baseUrl, cookie, '2026-03-10');
    const data = await coverage(ctx.baseUrl, cookie);
    assert.equal(data.missing_total, 0);
    assert.deepEqual(data.months, []);
  });

  test('finds the interior days between two sheets, and ignores everything outside that span', async () => {
    await upload(ctx.baseUrl, cookie, '2026-03-14'); // leaves 11, 12, 13 missing
    const data = await coverage(ctx.baseUrl, cookie);
    assert.equal(data.from, '2026-03-10');
    assert.equal(data.to, '2026-03-14');
    assert.equal(data.missing_total, 3);
    const march = data.months.find((m) => m.month === '2026-03');
    assert.deepEqual(march.missing, ['2026-03-11', '2026-03-12', '2026-03-13']);
  });

  test('consecutive days add no gaps', async () => {
    await upload(ctx.baseUrl, cookie, '2026-03-15');
    const data = await coverage(ctx.baseUrl, cookie);
    assert.equal(data.missing_total, 3, 'still just the original 11-13 gap');
  });

  test('two sheets on one date (separate shifts) do not count that day twice or create a gap', async () => {
    await upload(ctx.baseUrl, cookie, '2026-03-15');
    const data = await coverage(ctx.baseUrl, cookie);
    assert.equal(data.missing_total, 3);
    assert.ok(!data.months.some((m) => m.missing.includes('2026-03-15')));
  });

  test('a gap straddling a month boundary is caught and split across both months', async () => {
    await upload(ctx.baseUrl, cookie, '2026-03-30');
    await upload(ctx.baseUrl, cookie, '2026-04-02'); // Mar 31 and Apr 1 missing
    const data = await coverage(ctx.baseUrl, cookie);

    const march = data.months.find((m) => m.month === '2026-03');
    const april = data.months.find((m) => m.month === '2026-04');
    assert.ok(march.missing.includes('2026-03-31'), 'Mar 31 is a gap');
    assert.deepEqual(april.missing, ['2026-04-01'], 'Apr 1 is a gap, bucketed under April');
  });

  test('months come back most recent first', async () => {
    const data = await coverage(ctx.baseUrl, cookie);
    const keys = data.months.map((m) => m.month);
    assert.deepEqual(keys, [...keys].sort().reverse());
  });
});
