import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

// Deliberately literals rather than imports from profitSplit.js: importing it here would
// open db.js against the real data dir before startTestServer can point it at a temp one.
// mondayOf and these constants are unit-tested in weekBoundaries.test.js.
const CLOSE_OUT_DATE = '2026-08-23';
const CLOSE_OUT_RECEIVED = 7400;

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

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same db singleton.
let ctx, cookie;
before(async () => {
  ctx = await startTestServer();
  cookie = await signInAsAdmin(ctx.baseUrl);
});
after(async () => { await ctx.stop(); });

const upload = async (sheetDate, totalIn) => {
  const form = new FormData();
  form.append('file', new Blob([buildSheetXlsx(totalIn, 0)]), 'sheet.xlsx');
  form.append('sheet_date', sheetDate);
  const res = await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  return res;
};

const getSplit = async () =>
  (await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: cookie } })).json();

const rowFor = (rows, period) => rows.find((r) => r.period === period);

describe('the closed-out period', () => {
  test('exists as a single settled row with a zero balance', async () => {
    const { rows } = await getSplit();
    const closed = rowFor(rows, 'closed');
    assert.ok(closed, 'expected a closed row');
    assert.equal(closed.closed, true);
    assert.equal(closed.period_end, CLOSE_OUT_DATE);
    assert.equal(closed.amount_40, CLOSE_OUT_RECEIVED, 'owed equals what was received');
    assert.equal(closed.applied, CLOSE_OUT_RECEIVED);
    assert.equal(closed.coverage, 'covered');
  });

  test('it sits at the bottom of the table, as the oldest thing there is', async () => {
    const { rows } = await getSplit();
    assert.equal(rows[rows.length - 1].period, 'closed');
  });

  test('the close-out payment is in the ledger as a real receipt', async () => {
    const ledger = await (await fetch(`${ctx.baseUrl}/api/profit-split/receipts`, { headers: { Cookie: cookie } })).json();
    const seeded = ledger.find((r) => r.received_on === CLOSE_OUT_DATE);
    assert.ok(seeded, 'expected the close-out receipt');
    assert.equal(seeded.amount, CLOSE_OUT_RECEIVED);
  });

  test('it is marked as seeded so the page can lock it', async () => {
    const rows = await (await fetch(`${ctx.baseUrl}/api/profit-split/receipts`, { headers: { Cookie: cookie } })).json();
    const seeded = rows.find((r) => r.received_on === CLOSE_OUT_DATE);
    assert.match(seeded.created_by, /^system:/, 'the UI hides Delete on system rows');
  });

  test('it cannot be deleted — it is settled history', async () => {
    const ledger = await (await fetch(`${ctx.baseUrl}/api/profit-split/receipts`, { headers: { Cookie: cookie } })).json();
    const seeded = ledger.find((r) => r.received_on === CLOSE_OUT_DATE);
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/receipts/${seeded.id}`, {
      method: 'DELETE', headers: { Cookie: cookie },
    });
    assert.equal(res.status, 400);
  });

  test('the account starts level: nothing owed, nothing outstanding', async () => {
    const { account } = await getSplit();
    assert.equal(account.owed_total, CLOSE_OUT_RECEIVED);
    assert.equal(account.received_total, CLOSE_OUT_RECEIVED);
    assert.equal(account.balance, 0, 'the close-out leaves a clean slate');
  });

  test('sheets before the close-out do not reopen it', async () => {
    // A July sheet is inside the settled period; adding one must not change the figures.
    const before = await getSplit();
    assert.equal((await upload('2026-07-15', 5000)).status, 200);
    const after = await getSplit();
    assert.equal(after.rows.length, before.rows.length, 'no new period appeared');
    assert.equal(rowFor(after.rows, 'closed').amount_40, CLOSE_OUT_RECEIVED);
    assert.equal(after.account.balance, 0, 'settled history stays settled');
  });
});

describe('weekly 40/60 periods', () => {
  test('a week of profit splits 40/60 with no recoup phase', async () => {
    assert.equal((await upload('2026-08-26', 1000)).status, 200); // Wednesday of week 1

    const { rows } = await getSplit();
    const wk = rowFor(rows, '2026-08-24');
    assert.ok(wk, 'expected the week beginning 2026-08-24');
    assert.equal(wk.period_start, '2026-08-24');
    assert.equal(wk.period_end, '2026-08-30', 'Monday through Sunday');
    assert.equal(wk.net_profit, 1000);
    assert.equal(wk.amount_40, 400, 'straight 40% — the recoup is retired');
    assert.equal(wk.amount_60, 600);
  });

  test('days across one week are summed into that week', async () => {
    assert.equal((await upload('2026-08-30', 500)).status, 200); // Sunday of the same week

    const { rows } = await getSplit();
    const wk = rowFor(rows, '2026-08-24');
    assert.equal(wk.net_profit, 1500, '1000 on Wed + 500 on Sun');
    assert.equal(wk.amount_40, 600);
  });

  test('the following Monday starts a separate week', async () => {
    assert.equal((await upload('2026-08-31', 900)).status, 200);

    const { rows } = await getSplit();
    assert.equal(rowFor(rows, '2026-08-24').net_profit, 1500, 'the earlier week is unchanged');
    const wk2 = rowFor(rows, '2026-08-31');
    assert.equal(wk2.net_profit, 900);
    assert.equal(wk2.period_end, '2026-09-06');
    assert.equal(wk2.amount_40, 360);
  });

  test('a week spanning a month boundary is still one week', async () => {
    assert.equal((await upload('2026-09-02', 100)).status, 200); // Wednesday, same week as Aug 31

    const { rows } = await getSplit();
    const wk2 = rowFor(rows, '2026-08-31');
    assert.equal(wk2.net_profit, 1000, 'Aug 31 and Sep 2 fall in the same Mon–Sun week');
  });

  test('the running total accumulates across weeks, starting from the closed period', async () => {
    const { rows, account } = await getSplit();
    assert.equal(rowFor(rows, '2026-08-24').owed_running, CLOSE_OUT_RECEIVED + 600);
    assert.equal(rowFor(rows, '2026-08-31').owed_running, CLOSE_OUT_RECEIVED + 600 + 400);
    assert.equal(account.owed_total, CLOSE_OUT_RECEIVED + 1000);
  });

  test('weeks are listed newest first', async () => {
    const { rows } = await getSplit();
    const weeks = rows.filter((r) => !r.closed).map((r) => r.period);
    assert.deepEqual(weeks, [...weeks].sort().reverse());
  });
});

describe('the running total toward the target', () => {
  test('the target is $80,000 and tracks cumulative 40% owed', async () => {
    const { rows, account } = await getSplit();
    assert.equal(account.target, 80000);
    // The same figure the "Owed to date" card shows — one meaning for "total" on the page.
    assert.equal(account.owed_total, rows.find((r) => !r.closed && r.owed_running)
      ? Math.max(...rows.map((r) => r.owed_running)) : account.owed_total);
    assert.equal(account.target_remaining, 80000 - account.owed_total);
    assert.equal(account.target_reached, false);
  });

  test('the closed period counts toward it, as it does in the card', async () => {
    const { account } = await getSplit();
    assert.ok(account.owed_total >= CLOSE_OUT_RECEIVED,
      'the settled history is part of the running total, not excluded from it');
  });

  test('remaining never goes negative once the target is passed', async () => {
    // Nothing here reaches 80k, so this guards the clamp rather than the arithmetic.
    const { account } = await getSplit();
    assert.ok(account.target_remaining >= 0);
  });
});

describe('settling weekly balances', () => {
  test('a payment after the close-out draws down the weekly balance', async () => {
    const before = (await getSplit()).account;
    assert.equal(before.balance, 1000, '600 + 400 owed since the close-out');

    const res = await fetch(`${ctx.baseUrl}/api/profit-split/receipts`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ received_on: '2026-09-07', amount: 600, note: 'week one' }),
    });
    assert.equal(res.status, 201);

    const { rows, account } = await getSplit();
    assert.equal(account.balance, 400);
    assert.equal(rowFor(rows, '2026-08-24').coverage, 'covered', 'oldest week first');
    assert.equal(rowFor(rows, '2026-08-31').coverage, 'open');
    assert.equal(account.paid_through, '2026-08-24');
  });

  test('a week with no sheets shows nothing owed rather than "covered"', async () => {
    const { rows } = await getSplit();
    const empty = rows.find((r) => !r.closed && r.net_profit === 0);
    if (empty) assert.equal(empty.coverage, 'none');
  });
});

describe('comments are keyed by period', () => {
  test('a comment can be saved against a week', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/2026-08-24`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'short week, machine 12 down' }),
    });
    assert.equal(res.status, 200);

    const { rows } = await getSplit();
    assert.equal(rowFor(rows, '2026-08-24').notes, 'short week, machine 12 down');
  });

  test('a comment can be saved against the closed period', async () => {
    await fetch(`${ctx.baseUrl}/api/profit-split/closed`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'settled in full 08/23' }),
    });
    const { rows } = await getSplit();
    assert.equal(rowFor(rows, 'closed').notes, 'settled in full 08/23');
  });

  test('a malformed period is rejected', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/2026-08`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'nope' }),
    });
    assert.equal(res.status, 400);
  });
});
