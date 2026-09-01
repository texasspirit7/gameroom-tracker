import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signInAsAdmin, signInAsApprovedUser, signInAsOwner } from './helpers/testServer.js';

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same db singleton.
//
// How receipts feed the weekly split is covered in profitSplitWeekly.test.js; this file is
// about the ledger itself — validation, access, deletion and the audit trail.
let ctx, adminCookie, userCookie, ownerCookie;
before(async () => {
  ctx = await startTestServer();
  ownerCookie = await signInAsOwner(ctx.baseUrl);
  adminCookie = await signInAsAdmin(ctx.baseUrl);
  userCookie = await signInAsApprovedUser(ctx.baseUrl, adminCookie);
});
after(async () => { await ctx.stop(); });

const addReceipt = (body) =>
  fetch(`${ctx.baseUrl}/api/profit-split/receipts`, {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const ledger = async () =>
  (await fetch(`${ctx.baseUrl}/api/profit-split/receipts`, { headers: { Cookie: adminCookie } })).json();

const account = async () =>
  (await (await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: adminCookie } })).json()).account;

describe('the ledger', () => {
  test('a receipt records cash, expenses and a note', async () => {
    const res = await addReceipt({ received_on: '2026-09-07', amount: 1000, expense_credit: 200, note: 'Zelle + gas' });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.amount, 1000);
    assert.equal(created.expense_credit, 200);
    assert.equal(created.note, 'Zelle + gas');
  });

  test('cash and expenses both draw the balance down', async () => {
    const before = (await account()).received_total;
    await addReceipt({ received_on: '2026-09-08', amount: 100, expense_credit: 50 });
    assert.equal((await account()).received_total, before + 150);
  });

  test('lists every receipt, newest first', async () => {
    const rows = await ledger();
    const dates = rows.map((r) => r.received_on);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  test('removing a receipt puts the balance back up', async () => {
    const created = await (await addReceipt({ received_on: '2026-09-09', amount: 500 })).json();
    const withIt = (await account()).received_total;

    const del = await fetch(`${ctx.baseUrl}/api/profit-split/receipts/${created.id}`, {
      method: 'DELETE', headers: { Cookie: adminCookie },
    });
    assert.equal(del.status, 200);
    assert.equal((await account()).received_total, withIt - 500);
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
    ['a malformed date', { received_on: '09/07/2026', amount: 100 }],
    ['no money at all', { received_on: '2026-09-07', amount: 0, expense_credit: 0 }],
    ['a negative amount', { received_on: '2026-09-07', amount: -100 }],
    ['a non-numeric amount', { received_on: '2026-09-07', amount: 'abc' }],
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
      body: JSON.stringify({ received_on: '2026-09-07', amount: 100 }),
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
    const created = await (await addReceipt({ received_on: '2026-09-11', amount: 77 })).json();
    await fetch(`${ctx.baseUrl}/api/profit-split/receipts/${created.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } });

    const log = await (await fetch(`${ctx.baseUrl}/api/audit?limit=50`, { headers: { Cookie: ownerCookie } })).json();
    const actions = log.map((e) => e.action);
    assert.ok(actions.includes('receipt-added'), 'expected a receipt-added entry');
    assert.ok(actions.includes('receipt-deleted'), 'expected a receipt-deleted entry');
    assert.ok(log.find((e) => e.action === 'receipt-added').actor_email, 'the trail records who did it');
  });
});
