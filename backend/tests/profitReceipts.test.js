import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin, signInAsApprovedUser } from './helpers/testServer.js';

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
//
// Three months spanning the recoup boundary:
//   Jan net 12,000 -> wholly recouped,               owed 12,000  (running 12,000)
//   Feb net 20,000 -> 18,000 finishes the 30k,       owed 18,800  (running 30,800)
//   Mar net 10,000 -> fully past the recoup,         owed  4,000  (running 34,800)
let ctx, adminCookie, userCookie;
before(async () => {
  ctx = await startTestServer();
  adminCookie = await signInAsAdmin(ctx.baseUrl);
  userCookie = await signInAsApprovedUser(ctx.baseUrl, adminCookie);
  for (const [date, amount] of [['2026-01-15', 12000], ['2026-02-15', 20000], ['2026-03-15', 10000]]) {
    const form = new FormData();
    form.append('file', new Blob([buildSheetXlsx(amount, 0)]), 'sheet.xlsx');
    form.append('sheet_date', date);
    await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: adminCookie }, body: form });
  }
});
after(async () => { await ctx.stop(); });

const getSplit = async () =>
  (await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: adminCookie } })).json();

const addReceipt = (body) =>
  fetch(`${ctx.baseUrl}/api/profit-split/receipts`, {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const monthRow = (rows, m) => rows.find((r) => r.month === m);

describe('the account — one running balance', () => {
  test('with nothing received, the balance is everything earned to date', async () => {
    const { rows, account } = await getSplit();
    assert.equal(account.owed_total, 34800, '12,000 + 18,800 + 4,000');
    assert.equal(account.received_total, 0);
    assert.equal(account.balance, 34800);
    assert.equal(account.paid_through, null);
    assert.equal(monthRow(rows, '2026-03').owed_running, 34800);
  });

  test('each month adds its own entitlement to the running total', async () => {
    const { rows } = await getSplit();
    assert.equal(monthRow(rows, '2026-01').owed_running, 12000);
    assert.equal(monthRow(rows, '2026-02').owed_running, 30800);
    assert.equal(monthRow(rows, '2026-03').owed_running, 34800);
  });

  test('a payment draws the balance down without being tied to a month', async () => {
    const res = await addReceipt({ received_on: '2026-02-03', amount: 5000, note: 'first instalment' });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.month, undefined, 'receipts belong to the account, not to a month');

    const { account } = await getSplit();
    assert.equal(account.received_total, 5000);
    assert.equal(account.balance, 29800);
  });

  // The worked example from the spec: 23,000 cash + 1,000 taken as expenses settles 24,000.
  test('an expense credit draws the balance down just as cash does', async () => {
    await addReceipt({ received_on: '2026-03-05', amount: 23000, expense_credit: 1000 });
    const { account } = await getSplit();
    assert.equal(account.received_total, 29000, '5,000 + 23,000 cash + 1,000 expenses');
    assert.equal(account.balance, 5800);
  });
});

describe('the account — coverage falls out of the balance, oldest first', () => {
  test('money fills the oldest months first', async () => {
    const { rows, account } = await getSplit();
    // 29,000 received against 12,000 + 18,800 + 4,000 owed.
    assert.equal(monthRow(rows, '2026-01').coverage, 'covered');
    assert.equal(monthRow(rows, '2026-01').applied, 12000);
    assert.equal(monthRow(rows, '2026-02').coverage, 'partial');
    assert.equal(monthRow(rows, '2026-02').applied, 17000, '29,000 − 12,000 reaches into February');
    assert.equal(monthRow(rows, '2026-03').coverage, 'open');
    assert.equal(monthRow(rows, '2026-03').applied, 0);
    assert.equal(account.paid_through, '2026-01');
  });

  test('a month that earned nothing shows no coverage rather than "covered"', async () => {
    const { rows } = await getSplit();
    const flat = rows.find((r) => r.net_profit === 0);
    assert.ok(flat, 'expected at least one month with no profit');
    assert.equal(flat.owed, undefined);
    assert.equal(flat.amount_40, 0);
    assert.equal(flat.coverage, 'none');
  });

  test('clearing the balance covers every month', async () => {
    await addReceipt({ received_on: '2026-04-02', amount: 5800 });
    const { rows, account } = await getSplit();
    assert.equal(account.balance, 0);
    assert.equal(account.paid_through, '2026-03');
    for (const m of ['2026-01', '2026-02', '2026-03']) {
      assert.equal(monthRow(rows, m).coverage, 'covered', `${m} should be covered`);
    }
  });

  test('paying past the balance shows as negative, not clamped to zero', async () => {
    const created = await (await addReceipt({ received_on: '2026-04-03', amount: 200 })).json();
    const { account } = await getSplit();
    assert.equal(account.balance, -200, 'overpaid by 200');

    await fetch(`${ctx.baseUrl}/api/profit-split/receipts/${created.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } });
  });
});

describe('settlement must never move the split (regression)', () => {
  // Asserted as absolute values rather than a before/after diff: by this point the balance is
  // already cleared, so a diff would compare two equally-wrong numbers and pass. These figures
  // follow from the three months' profit alone.
  const EXPECTED = [
    // month, net, label, recoup slice, owed to the 40% side, owed to the 60% side
    ['2026-01', 12000, 'recoup', 12000, 12000, 0],
    ['2026-02', 20000, 'recoup', 18000, 18800, 1200], // 18,000 finishes the recoup; 2,000 splits
    ['2026-03', 10000, '40/60', 0, 4000, 6000],
  ];
  const snapshot = (rows) => EXPECTED.map(([m]) => {
    const r = monthRow(rows, m);
    return [r.month, r.net_profit, r.split_label, r.recoup_amount, r.amount_40, r.amount_60];
  });

  test('entitlement follows profit earned alone, whatever has been received', async () => {
    assert.deepEqual(snapshot((await getSplit()).rows), EXPECTED);
  });

  test('a further large payment still moves nothing', async () => {
    const created = await (await addReceipt({ received_on: '2026-04-20', amount: 99999 })).json();
    assert.deepEqual(snapshot((await getSplit()).rows), EXPECTED,
      'entitlement is derived from profit earned, never from cash received');
    await fetch(`${ctx.baseUrl}/api/profit-split/receipts/${created.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } });
  });

  test('the 30k recoup still completes on earned profit, not on cash received', async () => {
    const { account } = await getSplit();
    assert.equal(account.recoup.target, 30000);
    assert.equal(account.recoup.earned, 30000);
    assert.equal(account.recoup.complete, true, 'Jan+Feb earned the full 30k regardless of what was collected');
  });

  test('the recoup fills before anything else, since it is the oldest debt', async () => {
    const { account } = await getSplit();
    // 34,800 received in total, so the whole 30k recoup has landed.
    assert.equal(account.received_total, 34800);
    assert.equal(account.recoup.received, 30000);
    assert.equal(account.recoup.remaining, 0);
  });
});

describe('the ledger', () => {
  test('lists every receipt, newest first', async () => {
    const ledger = await (await fetch(`${ctx.baseUrl}/api/profit-split/receipts`, { headers: { Cookie: adminCookie } })).json();
    assert.equal(ledger.length, 3);
    const dates = ledger.map((r) => r.received_on);
    assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
  });

  test('removing a receipt puts the balance back up', async () => {
    const created = await (await addReceipt({ received_on: '2026-05-01', amount: 1500 })).json();
    assert.equal((await getSplit()).account.balance, -1500);

    const del = await fetch(`${ctx.baseUrl}/api/profit-split/receipts/${created.id}`, {
      method: 'DELETE', headers: { Cookie: adminCookie },
    });
    assert.equal(del.status, 200);
    assert.equal((await getSplit()).account.balance, 0);
  });

  test('deleting a receipt that does not exist is a 404, not a silent success', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/receipts/999999`, {
      method: 'DELETE', headers: { Cookie: adminCookie },
    });
    assert.equal(res.status, 404);
  });
});

describe('receipt input validation', () => {
  const cases = [
    ['a missing date', { amount: 100 }],
    ['a malformed date', { received_on: '03/05/2026', amount: 100 }],
    ['no money at all', { received_on: '2026-03-05', amount: 0, expense_credit: 0 }],
    ['a negative amount', { received_on: '2026-03-05', amount: -100 }],
    ['a non-numeric amount', { received_on: '2026-03-05', amount: 'abc' }],
  ];
  for (const [label, body] of cases) {
    test(`rejects ${label}`, async () => {
      assert.equal((await addReceipt(body)).status, 400);
    });
  }
});

describe('receipts — access control', () => {
  test('a non-admin cannot read the ledger', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/receipts`, { headers: { Cookie: userCookie } });
    assert.equal(res.status, 403);
  });

  test('a non-admin cannot record a receipt', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/receipts`, {
      method: 'POST',
      headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ received_on: '2026-02-03', amount: 100 }),
    });
    assert.equal(res.status, 403);
  });

  test('a non-admin cannot delete a receipt', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/receipts/1`, {
      method: 'DELETE', headers: { Cookie: userCookie },
    });
    assert.equal(res.status, 403);
  });
});

describe('receipts — audit trail', () => {
  test('adding and deleting a receipt both leave a trail', async () => {
    const created = await (await addReceipt({ received_on: '2026-05-11', amount: 77 })).json();
    await fetch(`${ctx.baseUrl}/api/profit-split/receipts/${created.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } });

    const log = await (await fetch(`${ctx.baseUrl}/api/audit?limit=50`, { headers: { Cookie: adminCookie } })).json();
    const actions = log.map((e) => e.action);
    assert.ok(actions.includes('receipt-added'), 'expected a receipt-added entry');
    assert.ok(actions.includes('receipt-deleted'), 'expected a receipt-deleted entry');
    assert.ok(log.find((e) => e.action === 'receipt-added').actor_email, 'the trail records who did it');
  });
});
