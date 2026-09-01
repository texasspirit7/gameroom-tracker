import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

/**
 * A sheet whose machine totals give `totalIn − totalOut`, with the Bank box's printed
 * "Profit (Loss)" and "Short/Over" written exactly as `printedProfit` / `printedShort` —
 * strings so parenthesised accounting negatives can be exercised as they appear on paper.
 */
function buildSheetXlsx({ totalIn, totalOut, printedProfit, printedShort, dailyIn, pay }) {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, totalIn, dailyIn ?? totalIn, 0, totalOut, totalOut, '50%'],
    ['Total', '', '', totalIn, '', '', totalOut, '50%'],
    [],
    ['Total Out', '$', totalOut, 'Total In', '$', totalIn, 'Bank'],
    ['Profit (Loss)', printedProfit],
    ['Short/Over', printedShort],
    ...(pay === undefined ? [] : [['Pay', pay]]),
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

// Parentheses are the sheet's only marker for a negative, so every field read off the paper
// has to honour them — not just the two Bank boxes that prompted the fix.
describe('parentheses are honoured everywhere, not only in the Bank box', () => {
  test('a parenthesised expense is a credit, not a charge', async () => {
    const { body } = await upload('2026-06-01', {
      totalIn: 1000, totalOut: 400, printedProfit: '600', printedShort: '0', pay: '(50)',
    });
    const s = await sheet(body.sheetId);
    const payRow = s.expenses.find((e) => e.category === 'pay');
    assert.ok(payRow, 'expected the pay row to be extracted');
    assert.equal(payRow.amount, -50, '(50) on paper is a credit of 50');
  });

  test('an ordinary expense stays a positive charge', async () => {
    const { body } = await upload('2026-06-02', {
      totalIn: 1000, totalOut: 400, printedProfit: '600', printedShort: '0', pay: '300',
    });
    const s = await sheet(body.sheetId);
    assert.equal(s.expenses.find((e) => e.category === 'pay').amount, 300);
  });

  test('a parenthesised machine reading is negative', async () => {
    const { body } = await upload('2026-06-03', {
      totalIn: 1000, totalOut: 400, printedProfit: '600', printedShort: '0', dailyIn: '(25)',
    });
    const s = await sheet(body.sheetId);
    assert.equal(s.machines[0].daily_in, -25);
  });
});
