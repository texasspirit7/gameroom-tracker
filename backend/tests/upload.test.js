import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

function buildSheetXlsx(machineRows, printedDate) {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    ...machineRows,
    ['Total', '', '', 300, '', '', 110, '63%'],
    [],
    ['Total Out', '$', 110, 'Total In', '$', 300, 'Bank'],
    ...(printedDate ? [['Referral', '', '', printedDate]] : []),
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function uploadXlsx(baseUrl, cookie, buffer, sheetDate) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'sheet.xlsx');
  if (sheetDate) form.append('sheet_date', sheetDate);
  return fetch(`${baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
}

// One shared server for the whole file — Node caches ES modules per process,
// so a second startTestServer() call here would silently reuse (and, after
// an earlier block's teardown, find *closed*) the same db.js singleton rather
// than getting a fresh one. Tests below use distinct dates to stay isolated.
let ctx, cookie;
before(async () => {
  ctx = await startTestServer();
  cookie = await signInAsAdmin(ctx.baseUrl);
});
after(async () => { await ctx.stop(); });

describe('POST /api/sheets/upload', () => {
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

  // One sheet per day is a hard rule: a second upload for a day silently doubled that day's
  // totals everywhere they feed, including the profit split.
  test('a second sheet for the same date is refused with a 409', async () => {
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%']]);
    const first = await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-01-03');
    assert.equal(first.status, 200);

    const second = await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-01-03');
    assert.equal(second.status, 409);

    const body = await second.json();
    const firstId = (await first.json()).sheetId;
    assert.match(body.error, /already exists for 2026-01-03/);
    assert.match(body.error, new RegExp(`#${firstId}\\b`), 'names the sheet standing in the way');
    assert.match(body.error, /delete that sheet first/i, 'says how to proceed');
  });

  // Deliberately relies on the sheet's own printed date rather than an explicit one: the
  // explicit-date guard returns before the file is ever written, so only this path can prove
  // the post-extraction check also runs before saveUploadedFile.
  test('a refused upload leaves nothing behind — no extra sheet, no orphan file', async () => {
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%']], '01/09/2026');
    assert.equal((await uploadXlsx(ctx.baseUrl, cookie, buf)).status, 200);

    const uploadsDir = path.join(ctx.dataDir, 'uploads');
    const filesBefore = fs.readdirSync(uploadsDir).length;

    const res = await uploadXlsx(ctx.baseUrl, cookie, buf);
    assert.equal(res.status, 409);

    const rows = await (await fetch(`${ctx.baseUrl}/api/sheets`, { headers: { Cookie: cookie } })).json();
    assert.equal(rows.filter((r) => r.sheet_date === '2026-01-09').length, 1, 'still exactly one sheet that day');
    assert.equal(fs.readdirSync(uploadsDir).length, filesBefore, 'the rejected file was not written');
  });

  test('deleting the existing sheet frees the day up again', async () => {
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%']]);
    const first = await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-01-10');
    const firstId = (await first.json()).sheetId;

    assert.equal((await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-01-10')).status, 409);

    await fetch(`${ctx.baseUrl}/api/sheets/${firstId}`, { method: 'DELETE', headers: { Cookie: cookie } });

    const retry = await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-01-10');
    assert.equal(retry.status, 200, 'the replacement uploads once the day is clear');
  });

  test('other dates are unaffected', async () => {
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%']]);
    await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-01-11');
    assert.equal((await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-01-12')).status, 200);
  });

  // Editing a date is the other way a day could end up with two sheets — the upload guard
  // alone would leave that door open.
  test('a sheet cannot be edited onto a date that already has one', async () => {
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%']]);
    const taken = (await (await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-02-01')).json()).sheetId;
    const mover = (await (await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-02-02')).json()).sheetId;

    const res = await fetch(`${ctx.baseUrl}/api/sheets/${mover}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_date: '2026-02-01' }),
    });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, new RegExp(`#${taken}\\b`));

    const after = await (await fetch(`${ctx.baseUrl}/api/sheets/${mover}`, { headers: { Cookie: cookie } })).json();
    assert.equal(after.sheet_date, '2026-02-02', 'the date was left alone');
  });

  test('a sheet can still be re-dated to a free day', async () => {
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%']]);
    const id = (await (await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-02-05')).json()).sheetId;

    const res = await fetch(`${ctx.baseUrl}/api/sheets/${id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_date: '2026-02-06' }),
    });
    assert.equal(res.status, 200);

    const after = await (await fetch(`${ctx.baseUrl}/api/sheets/${id}`, { headers: { Cookie: cookie } })).json();
    assert.equal(after.sheet_date, '2026-02-06');
  });

  test('saving a sheet without changing its date is not blocked by itself', async () => {
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%']]);
    const id = (await (await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-02-09')).json()).sheetId;

    const res = await fetch(`${ctx.baseUrl}/api/sheets/${id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_date: '2026-02-09', total_in: 123 }),
    });
    assert.equal(res.status, 200, 'a sheet must not collide with its own date');

    const after = await (await fetch(`${ctx.baseUrl}/api/sheets/${id}`, { headers: { Cookie: cookie } })).json();
    assert.equal(after.total_in, 123);
  });

  // The explicit-date guard runs before extraction, so these cover the second guard: the one
  // that fires after the date has been read off the sheet or inferred.
  test('a date read off the sheet itself is checked too, and says so', async () => {
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%']], '03/14/2026');
    assert.equal((await uploadXlsx(ctx.baseUrl, cookie, buf)).status, 200);

    const res = await uploadXlsx(ctx.baseUrl, cookie, buf);
    assert.equal(res.status, 409);
    const { error } = await res.json();
    assert.match(error, /already exists for 2026-03-14/);
    assert.match(error, /read off the sheet itself/, 'explains where the date came from');
  });

  test('rejects unsupported file types with a clear 400', async () => {
    const form = new FormData();
    form.append('file', new Blob(['not a real file']), 'notes.txt');
    form.append('sheet_date', '2026-01-04');
    const res = await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/sheets/upload — auto-detected sheet_date priority', () => {
  test('no sheet_date in the form uses the date auto-extracted from the sheet', async () => {
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%']], '03/15/2026');
    const res = await uploadXlsx(ctx.baseUrl, cookie, buf, null);
    assert.equal(res.status, 200);
    const { sheetId } = await res.json();
    const sheet = await (await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, { headers: { Cookie: cookie } })).json();
    assert.equal(sheet.sheet_date, '2026-03-15');
  });

  test('an explicit sheet_date in the form overrides the date printed on the sheet', async () => {
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%']], '03/15/2026');
    const res = await uploadXlsx(ctx.baseUrl, cookie, buf, '2026-04-01');
    assert.equal(res.status, 200);
    const { sheetId } = await res.json();
    const sheet = await (await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, { headers: { Cookie: cookie } })).json();
    assert.equal(sheet.sheet_date, '2026-04-01');
  });

  test('no sheet_date and no printed date defaults to the day after the last sheet on record, with a warning', async () => {
    // The previous test in this block left 2026-04-01 as the last sheet uploaded.
    const buf = buildSheetXlsx([[1, 0, 100, 100, 0, 50, 50, '50%']]);
    const res = await uploadXlsx(ctx.baseUrl, cookie, buf, null);
    assert.equal(res.status, 200);
    const { sheetId, warnings } = await res.json();
    assert.ok(warnings.some((w) => w.includes('No date found on this sheet')), 'expected a guessed-date warning');
    const sheet = await (await fetch(`${ctx.baseUrl}/api/sheets/${sheetId}`, { headers: { Cookie: cookie } })).json();
    assert.equal(sheet.sheet_date, '2026-04-02');
  });
});
