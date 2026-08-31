import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

/**
 * A sheet whose machine totals give `totalIn − totalOut`, with the Bank box's printed
 * "Profit (Loss)" and "Short/Over" written exactly as `printedProfit` / `printedShort` —
 * strings so parenthesised accounting negatives can be exercised as they appear on paper.
 */
function buildSheetXlsx({ totalIn, totalOut, printedProfit, printedShort }) {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, totalIn, totalIn, 0, totalOut, totalOut, '50%'],
    ['Total', '', '', totalIn, '', '', totalOut, '50%'],
    [],
    ['Total Out', '$', totalOut, 'Total In', '$', totalIn, 'Bank'],
    ['Profit (Loss)', printedProfit],
    ['Short/Over', printedShort],
  ];
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(rows), 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same db singleton.
let ctx, cookie;
before(async () => {
  ctx = await startTestServer();
  cookie = await signInAsAdmin(ctx.baseUrl);
});
after(async () => { await ctx.stop(); });

const upload = async (sheetDate, spec) => {
  const form = new FormData();
  form.append('file', new Blob([buildSheetXlsx(spec)]), 'sheet.xlsx');
  form.append('sheet_date', sheetDate);
  const res = await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  return { status: res.status, body: await res.json() };
};

const sheet = async (id) =>
  (await fetch(`${ctx.baseUrl}/api/sheets/${id}`, { headers: { Cookie: cookie } })).json();

describe('accounting parentheses mean a loss', () => {
  test('a parenthesised Short/Over is stored negative, not positive', async () => {
    const { status, body } = await upload('2026-05-04', {
      totalIn: 1000, totalOut: 400, printedProfit: '600', printedShort: '(148)',
    });
    assert.equal(status, 200);
    const s = await sheet(body.sheetId);
    assert.equal(s.over_short, -148, '(148) on paper is a shortfall of 148');
  });

  test('an unparenthesised Short/Over stays positive', async () => {
    const { body } = await upload('2026-05-05', {
      totalIn: 1000, totalOut: 400, printedProfit: '600', printedShort: '148',
    });
    const s = await sheet(body.sheetId);
    assert.equal(s.over_short, 148);
  });

  test('a bare "-" is zero, not a minus sign', async () => {
    const { body } = await upload('2026-05-06', {
      totalIn: 1000, totalOut: 400, printedProfit: '600', printedShort: '-',
    });
    const s = await sheet(body.sheetId);
    assert.equal(s.over_short, 0);
  });
});

describe('the printed Profit (Loss) box is cross-checked against the machines', () => {
  test('warns when the printed box disagrees in sign with the machine totals', async () => {
    // Machines say +600; the paper says it was a loss. One of them was misread.
    const { body } = await upload('2026-05-11', {
      totalIn: 1000, totalOut: 400, printedProfit: '(600)', printedShort: '0',
    });
    const warning = body.warnings.find((w) => w.includes('Profit (Loss) box'));
    assert.ok(warning, `expected a sign-mismatch warning, got: ${JSON.stringify(body.warnings)}`);
    assert.match(warning, /-\$600/, 'quotes the printed figure as a loss');
    assert.match(warning, /\$600/, 'and what the machines came to');
    assert.match(warning, /parentheses is a loss/i, 'explains the convention');
  });

  test('stays quiet when the two agree', async () => {
    const { body } = await upload('2026-05-12', {
      totalIn: 1000, totalOut: 400, printedProfit: '600', printedShort: '0',
    });
    assert.equal(body.warnings.filter((w) => w.includes('Profit (Loss) box')).length, 0);
  });

  test('stays quiet when the printed box is absent', async () => {
    const { body } = await upload('2026-05-13', {
      totalIn: 1000, totalOut: 400, printedProfit: '', printedShort: '0',
    });
    assert.equal(body.warnings.filter((w) => w.includes('Profit (Loss) box')).length, 0);
  });

  test('the stored figure still comes from the machines, not the printed box', async () => {
    const { body } = await upload('2026-05-14', {
      totalIn: 1000, totalOut: 400, printedProfit: '(600)', printedShort: '0',
    });
    const s = await sheet(body.sheetId);
    assert.equal(s.meter_profit, 600, 'computed, with the printed box only raising a warning');
  });
});
