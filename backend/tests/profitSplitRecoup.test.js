import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

/** A sheet whose meter profit is exactly totalIn − totalOut (no match, no loan, no expenses). */
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

// Three months that walk the whole lifecycle of the 30k recoup: one entirely inside it, one
// that crosses the line partway through, and one after it is fully repaid.
//   Jan  net 12,000 -> all recouped                       (recovered 12,000)
//   Feb  net 20,000 -> 18,000 finishes the recoup, 2,000 splits (recovered 30,000)
//   Mar  net 10,000 -> nothing left to recoup, all splits
let ctx, cookie, rows;
before(async () => {
  ctx = await startTestServer();
  cookie = await signInAsAdmin(ctx.baseUrl);
  await upload(ctx.baseUrl, cookie, '2026-01-15', 12000, 0);
  await upload(ctx.baseUrl, cookie, '2026-02-15', 20000, 0);
  await upload(ctx.baseUrl, cookie, '2026-03-15', 10000, 0);
  rows = await (await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: cookie } })).json();
});
after(async () => { await ctx.stop(); });

const month = (m) => rows.find((r) => r.month === m);

describe('profit split — the first 30k is recouped in full by the 40% side', () => {
  test('a month wholly inside the recoup pays everything to the 40% side', () => {
    const jan = month('2026-01');
    assert.equal(jan.net_profit, 12000);
    assert.equal(jan.split_label, 'recoup');
    assert.equal(jan.recoup_amount, 12000);
    assert.equal(jan.split_base, 0);
    assert.equal(jan.amount_40, 12000);
    assert.equal(jan.amount_60, 0);
    assert.equal(jan.recovered_to_date, 12000);
    assert.equal(jan.recoup_remaining, 18000);
  });

  test('the month that crosses the line is split at the boundary, not all-or-nothing', () => {
    const feb = month('2026-02');
    assert.equal(feb.net_profit, 20000);
    assert.equal(feb.recoup_amount, 18000, 'only what was still owed');
    assert.equal(feb.split_base, 2000, 'the remainder reaches the 40/60');
    assert.equal(feb.amount_40, 18800, '18,000 recouped + 40% of 2,000');
    assert.equal(feb.amount_60, 1200, '60% of 2,000');
    assert.equal(feb.recovered_to_date, 30000);
    assert.equal(feb.recoup_remaining, 0);
  });

  test('once repaid, later months split 40/60 with nothing held back', () => {
    const mar = month('2026-03');
    assert.equal(mar.net_profit, 10000);
    assert.equal(mar.split_label, '40/60');
    assert.equal(mar.recoup_amount, 0);
    assert.equal(mar.split_base, 10000);
    assert.equal(mar.amount_40, 4000);
    assert.equal(mar.amount_60, 6000);
  });

  test('every month pays out exactly its net profit — the split never invents or loses money', () => {
    for (const r of rows) {
      assert.ok(
        Math.abs(r.amount_40 + r.amount_60 - r.net_profit) < 0.000001,
        `${r.month}: ${r.amount_40} + ${r.amount_60} != ${r.net_profit}`
      );
    }
  });

  test('the recoup total never exceeds the target across the whole history', () => {
    for (const r of rows) assert.ok(r.recovered_to_date <= r.recoup_target);
    assert.equal(month('2026-03').recovered_to_date, 30000);
  });
});
