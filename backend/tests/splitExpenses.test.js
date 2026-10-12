import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin, signInAsApprovedUser, signInAsOwner } from './helpers/testServer.js';

function buildSheetXlsx(totalIn) {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, totalIn, totalIn, 0, 0, 0, '100%'],
    ['Total', '', '', totalIn, '', '', 0, '100%'],
    [],
    ['Total Out', '$', 0, 'Total In', '$', totalIn, 'Bank'],
  ]), 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same handles.
let ctx, admin, user, owner;
before(async () => {
  ctx = await startTestServer();
  admin = await signInAsAdmin(ctx.baseUrl, 'la');
  owner = await signInAsOwner(ctx.baseUrl, 'la');
  user = await signInAsApprovedUser(ctx.baseUrl, admin, 'plain@test.local', 'la');

  // A week of profit so there is a balance for expenses to come off.
  const form = new FormData();
  form.append('file', new Blob([buildSheetXlsx(10000)]), 'sheet.xlsx');
  form.append('sheet_date', '2026-09-02');
  await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: admin }, body: form });
});
after(async () => { await ctx.stop(); });

const account = async () =>
  (await (await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: admin } })).json()).account;

const addExpense = (body) =>
  fetch(`${ctx.baseUrl}/api/profit-split/expenses`, {
    method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const expenses = async () =>
  (await fetch(`${ctx.baseUrl}/api/profit-split/expenses`, { headers: { Cookie: admin } })).json();

describe('expenses come off the balance owed', () => {
  test('the balance starts as owed minus received, with no expenses', async () => {
    const a = await account();
    assert.equal(a.expenses_total, 0);
    assert.equal(a.balance, round(a.owed_total - a.received_total));
    function round(n) { return Math.round(n * 100) / 100; }
  });

  test('recording one reduces the balance without touching what is owed', async () => {
    const before = await account();
    assert.equal((await addExpense({ expense_date: '2026-09-03', amount: 250, note: 'parts' })).status, 201);

    const after = await account();
    assert.equal(after.expenses_total, 250);
    assert.equal(after.owed_total, before.owed_total, 'the entitlement is untouched');
    assert.equal(after.received_total, before.received_total, 'and nothing was received');
    assert.equal(after.balance, Math.round((before.balance - 250) * 100) / 100);
  });

  test('expenses and payments both settle, and are reported together', async () => {
    await fetch(`${ctx.baseUrl}/api/profit-split/receipts`, {
      method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ received_on: '2026-09-04', amount: 100 }),
    });
    const a = await account();
    assert.equal(a.settled_total, round(a.received_total + a.expenses_total));
    assert.equal(a.balance, round(a.owed_total - a.settled_total));
    function round(n) { return Math.round(n * 100) / 100; }
  });

  test('listed newest first', async () => {
    await addExpense({ expense_date: '2026-09-10', amount: 80 });
    await addExpense({ expense_date: '2026-08-20', amount: 40 });
    const dates = (await expenses()).map((e) => e.expense_date);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });
});

describe('editing and removing', () => {
  test('an edit records both amounts and restates the balance', async () => {
    const created = await (await addExpense({ expense_date: '2026-09-11', amount: 500 })).json();
    const before = (await account()).balance;

    const res = await fetch(`${ctx.baseUrl}/api/profit-split/expenses/${created.id}`, {
      method: 'PATCH', headers: { Cookie: admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 300 }),
    });
    assert.equal(res.status, 200);
    assert.equal((await account()).balance, Math.round((before + 200) * 100) / 100, 'balance rises by the difference');

    const log = await (await fetch(`${ctx.baseUrl}/api/audit?limit=50`, { headers: { Cookie: owner } })).json();
    const entry = log.find((e) => e.action === 'split-expense-edited');
    assert.match(entry.detail, /\$500 → \$300/);
    assert.equal(entry.sensitive, true);
  });

  test('a save that changes nothing leaves no entry behind', async () => {
    const created = await (await addExpense({ expense_date: '2026-09-12', amount: 70 })).json();
    const count = async () => (await (await fetch(`${ctx.baseUrl}/api/audit?limit=200`, { headers: { Cookie: owner } })).json())
      .filter((e) => e.action === 'split-expense-edited').length;
    const before = await count();
    await fetch(`${ctx.baseUrl}/api/profit-split/expenses/${created.id}`, {
      method: 'PATCH', headers: { Cookie: admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 70 }),
    });
    assert.equal(await count(), before, 'a no-op save must not pad the trail');
  });

  test('deleting puts the balance back up', async () => {
    const created = await (await addExpense({ expense_date: '2026-09-13', amount: 900 })).json();
    const withIt = (await account()).balance;
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/expenses/${created.id}`, {
      method: 'DELETE', headers: { Cookie: admin },
    });
    assert.equal(res.status, 200);
    assert.equal((await account()).balance, Math.round((withIt + 900) * 100) / 100);
  });

  test('deleting one that is gone is a 404', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/expenses/999999`, {
      method: 'DELETE', headers: { Cookie: admin },
    });
    assert.equal(res.status, 404);
  });
});

describe('validation and access', () => {
  for (const [label, body] of [
    ['a missing date', { amount: 10 }],
    ['a malformed date', { expense_date: '09/03/2026', amount: 10 }],
    ['a zero amount', { expense_date: '2026-09-03', amount: 0 }],
    ['a negative amount', { expense_date: '2026-09-03', amount: -10 }],
    ['a non-numeric amount', { expense_date: '2026-09-03', amount: 'abc' }],
  ]) {
    test(`rejects ${label}`, async () => assert.equal((await addExpense(body)).status, 400));
  }

  test('a non-admin can neither read nor add', async () => {
    assert.equal((await fetch(`${ctx.baseUrl}/api/profit-split/expenses`, { headers: { Cookie: user } })).status, 403);
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/expenses`, {
      method: 'POST', headers: { Cookie: user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expense_date: '2026-09-03', amount: 10 }),
    });
    assert.equal(res.status, 403);
  });

  // These sit after the split; the overhead tables sit before it. Mixing them would count a
  // cost twice, so they must stay independent.
  test('a split expense does not change net profit or what is owed', async () => {
    const before = await account();
    await addExpense({ expense_date: '2026-09-02', amount: 1000 });
    const after = await account();
    assert.equal(after.owed_total, before.owed_total, 'the week\\u2019s 40% is unchanged');
  });
});
