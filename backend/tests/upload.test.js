import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

function buildSheetXlsx(machineRows) {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    ...machineRows,
    ['Total', '', '', 300, '', '', 110, '63%'],
    [],
    ['Total Out', '$', 110, 'Total In', '$', 300, 'Bank'],
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function uploadXlsx(baseUrl, cookie, buffer, sheetDate) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'sheet.xlsx');
  form.append('sheet_date', sheetDate);
  return fetch(`${baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
}

describe('POST /api/sheets/upload', () => {
  let ctx, cookie;
  before(async () => {
    ctx = await startTestServer();
    cookie = await signInAsAdmin(ctx.baseUrl);
  });
  after(async () => { await ctx.stop(); });

  test('golden path: normal sheet uploads successfully with correct meter profit', async () => {
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%'], [2, 0, 200, 200, 0, 60, 60, '70%']]);
    const res = await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-01-01');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.sheetId);

    const sheetRes = await fetch(`${ctx.baseUrl}/api/sheets/${body.sheetId}`, { headers: { Cookie: cookie } });
    const sheet = await sheetRes.json();
    assert.equal(sheet.meter_profit, 190); // (300 + 0) - (110 + 0)
    assert.equal(sheet.machines.length, 2);
  });

  test('regression: duplicate machine_number in the source sheet does not crash the upload (UNIQUE constraint)', async () => {
    const buf = buildSheetXlsx([[5, 0, 100, 100, 0, 50, 50, '50%'], [5, 0, 200, 200, 0, 60, 60, '70%']]);
    const res = await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-01-02');
    assert.equal(res.status, 200, 'must not 500 on a duplicate machine number');
    const body = await res.json();
    assert.ok(body.sheetId);

    const sheetRes = await fetch(`${ctx.baseUrl}/api/sheets/${body.sheetId}`, { headers: { Cookie: cookie } });
    const sheet = await sheetRes.json();
    assert.equal(sheet.machines.length, 1, 'duplicate machine_number rows collapse to one (last wins)');
    assert.equal(sheet.machines[0].daily_in, 200, 'the later reading for that machine wins');
  });

  test('multiple sheets on the same date are both allowed (separate shifts)', async () => {
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%']]);
    const first = await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-01-03');
    const second = await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-01-03');
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    assert.notEqual(firstBody.sheetId, secondBody.sheetId);
  });

  test('rejects unsupported file types with a clear 400', async () => {
    const form = new FormData();
    form.append('file', new Blob(['not a real file']), 'notes.txt');
    form.append('sheet_date', '2026-01-04');
    const res = await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
    assert.equal(res.status, 400);
  });
});
