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
  const res = await fetch(`${baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  return res.json();
}

describe('/api/audit — who did what to a sheet, and when', () => {
  let ctx, cookie;
  before(async () => {
    ctx = await startTestServer();
    cookie = await signInAsAdmin(ctx.baseUrl);
  });
  after(async () => { await ctx.stop(); });

  test('uploading a sheet logs a "created" entry with the actor and sheet date', async () => {
    const { sheetId } = await upload(ctx.baseUrl, cookie, '2026-11-01');
    const log = await (await fetch(`${ctx.baseUrl}/api/audit`, { headers: { Cookie: cookie } })).json();
    const entry = log.find((e) => e.sheet_id === sheetId && e.action === 'created');
    assert.ok(entry, 'expected a created entry for the new sheet');
    assert.equal(entry.sheet_date, '2026-11-01');
    assert.equal(entry.actor_email, 'admin@test.local');
  });

  test('editing a sheet logs an "edited" entry naming what changed', async () => {
    const { sheetId } = await upload(ctx.baseUrl, cookie, '2026-11-02');
    await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cash_profit: -20 }),
    });
    const log = await (await fetch(`${ctx.baseUrl}/api/audit`, { headers: { Cookie: cookie } })).json();
    const entry = log.find((e) => e.sheet_id === sheetId && e.action === 'edited');
    assert.ok(entry, 'expected an edited entry');
    assert.match(entry.detail, /cash_profit/);
  });

  test('verifying a sheet logs a "verified" entry', async () => {
    const { sheetId } = await upload(ctx.baseUrl, cookie, '2026-11-03');
    await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}/verify`, { method: 'POST', headers: { Cookie: cookie } });
    const log = await (await fetch(`${ctx.baseUrl}/api/audit`, { headers: { Cookie: cookie } })).json();
    const entry = log.find((e) => e.sheet_id === sheetId && e.action === 'verified');
    assert.ok(entry, 'expected a verified entry');
  });

  test('deleting a sheet logs a "deleted" entry that survives the sheet itself being gone', async () => {
    const { sheetId } = await upload(ctx.baseUrl, cookie, '2026-11-04');
    await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, { method: 'DELETE', headers: { Cookie: cookie } });

    const sheetRes = await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, { headers: { Cookie: cookie } });
    assert.equal(sheetRes.status, 404, 'the sheet itself should be gone');

    const log = await (await fetch(`${ctx.baseUrl}/api/audit`, { headers: { Cookie: cookie } })).json();
    const entry = log.find((e) => e.sheet_id === sheetId && e.action === 'deleted');
    assert.ok(entry, 'expected a deleted entry to remain even though the sheet row is gone');
    assert.equal(entry.sheet_date, '2026-11-04');
  });

  test('limit query param caps how many entries come back', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/audit?limit=2`, { headers: { Cookie: cookie } });
    const log = await res.json();
    assert.equal(log.length, 2);
  });
});
