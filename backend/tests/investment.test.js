import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signInAsAdmin, signInAsOwner } from './helpers/testServer.js';

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same handles.
let ctx, h, la, owner;
before(async () => {
  ctx = await startTestServer();
  h = await signInAsAdmin(ctx.baseUrl, 'h');
  la = await signInAsAdmin(ctx.baseUrl, 'la');
  owner = await signInAsOwner(ctx.baseUrl, 'h');
});
after(async () => { await ctx.stop(); });

const get = async (cookie = h) =>
  (await fetch(`${ctx.baseUrl}/api/investment`, { headers: { Cookie: cookie } })).json();

const release = (body, cookie = h) =>
  fetch(`${ctx.baseUrl}/api/investment/disbursements`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const split = async (cookie = h) =>
  (await (await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: cookie } })).json()).account;

describe('the quoted budget', () => {
  test('is seeded from the estimate and totals what was quoted', async () => {
    const { budget, summary } = await get();
    assert.equal(budget.length, 12);
    assert.equal(summary.quoted, 174150, 'matches the estimate total');
    assert.equal(budget.reduce((s, b) => s + b.amount, 0), 174150, 'and the lines add up to it');
  });

  test('carries the line detail where the estimate had it', async () => {
    const { budget } = await get();
    const chairs = budget.find((b) => b.item.startsWith('Chairs'));
    assert.equal(chairs.qty, 40);
    assert.equal(chairs.price_each, 40);
    assert.equal(chairs.amount, 1600);
  });

  test('is not seeded for a location with no setup investment', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/investment`, { headers: { Cookie: la } });
    assert.equal(res.status, 404, 'La Pryor tracks no setup investment');
  });

  test('starts with nothing released', async () => {
    const { summary } = await get();
    assert.equal(summary.released, 0);
    assert.equal(summary.remaining_to_release, 174150);
  });
});

describe('releasing money', () => {
  test('a disbursement counts toward the total and its budget line', async () => {
    const { budget } = await get();
    const chairs = budget.find((b) => b.item.startsWith('Chairs'));

    const res = await release({ released_on: '2026-10-01', amount: 1500, budget_id: chairs.id, note: 'paid supplier' });
    assert.equal(res.status, 201);

    const { budget: after, summary } = await get();
    const line = after.find((b) => b.id === chairs.id);
    assert.equal(line.released, 1500);
    assert.equal(line.variance, -100, 'came in under the quoted 1,600');
    assert.equal(summary.released, 1500);
  });

  test('money released without naming a line still counts, and is reported as unassigned', async () => {
    await release({ released_on: '2026-10-02', amount: 500, note: 'misc' });
    const { summary } = await get();
    assert.equal(summary.released, 2000);
    assert.equal(summary.unassigned, 500);
  });

  test('going over a budget line shows a positive variance', async () => {
    const { budget } = await get();
    const match = budget.find((b) => b.item === 'Match system');   // quoted 1,300
    await release({ released_on: '2026-10-03', amount: 1500, budget_id: match.id });
    const line = (await get()).budget.find((b) => b.id === match.id);
    assert.equal(line.variance, 200, 'over by 200');
  });

  test('a non-positive or malformed amount is refused', async () => {
    for (const body of [
      { released_on: '2026-10-04', amount: 0 },
      { released_on: '2026-10-04', amount: -5 },
      { released_on: '2026-10-04', amount: 'abc' },
      { released_on: '10/04/2026', amount: 100 },
      { amount: 100 },
    ]) {
      assert.equal((await release(body)).status, 400, JSON.stringify(body));
    }
  });

  test('a non-admin cannot release money', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/investment/disbursements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ released_on: '2026-10-05', amount: 100 }),
    });
    assert.equal(res.status, 401);
  });
});

// The whole point of the feature: the recovery target is what actually went out, not the quote.
describe('recovery tracks what was released, not what was quoted', () => {
  test('the profit split target equals the released total', async () => {
    const released = (await get()).summary.released;
    const account = await split();
    assert.equal(account.target, released, 'recover what you put in');
    assert.notEqual(account.target, 174150, 'not the quoted figure');
  });

  test('releasing more raises the target', async () => {
    const before = (await split()).target;
    await release({ released_on: '2026-10-06', amount: 2500 });
    assert.equal((await split()).target, before + 2500);
  });

  test('recovered mirrors what the split says is owed, so the pages cannot disagree', async () => {
    const { summary } = await get();
    const account = await split();
    assert.equal(summary.recovered, account.owed_total);
    assert.equal(summary.outstanding, Math.max(0, summary.released - account.owed_total));
  });

  test('with nothing earned yet, none of it is recovered', async () => {
    const { summary } = await get();
    assert.equal(summary.recovered, 0);
    assert.equal(summary.recovered_pct, 0);
    assert.equal(summary.fully_recovered, false);
    assert.equal(summary.outstanding, summary.released);
  });
});

describe('editing and removing disbursements', () => {
  test('an edit records both the old and new amount', async () => {
    const created = await (await release({ released_on: '2026-10-07', amount: 300 })).json();
    const res = await fetch(`${ctx.baseUrl}/api/investment/disbursements/${created.id}`, {
      method: 'PATCH', headers: { Cookie: h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 450 }),
    });
    assert.equal(res.status, 200);

    const log = await (await fetch(`${ctx.baseUrl}/api/audit?limit=50`, { headers: { Cookie: owner } })).json();
    const entry = log.find((e) => e.action === 'investment-edited');
    assert.ok(entry, 'expected an investment-edited entry');
    assert.match(entry.detail, /\$300 → \$450/);
    assert.equal(entry.sensitive, true, 'capital movements need noticing');
  });

  test('a save that changes nothing leaves no entry behind', async () => {
    const created = await (await release({ released_on: '2026-10-08', amount: 700 })).json();
    const trail = async () => (await (await fetch(`${ctx.baseUrl}/api/audit?limit=100`, { headers: { Cookie: owner } })).json())
      .filter((e) => e.action === 'investment-edited').length;
    const before = await trail();
    await fetch(`${ctx.baseUrl}/api/investment/disbursements/${created.id}`, {
      method: 'PATCH', headers: { Cookie: h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 700 }),
    });
    assert.equal(await trail(), before, 'a no-op save must not pad the trail');
  });

  test('deleting removes it from the total', async () => {
    const created = await (await release({ released_on: '2026-10-09', amount: 900 })).json();
    const withIt = (await get()).summary.released;
    const res = await fetch(`${ctx.baseUrl}/api/investment/disbursements/${created.id}`, {
      method: 'DELETE', headers: { Cookie: h },
    });
    assert.equal(res.status, 200);
    assert.equal((await get()).summary.released, withIt - 900);
  });

  test('deleting one that is gone is a 404', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/investment/disbursements/999999`, {
      method: 'DELETE', headers: { Cookie: h },
    });
    assert.equal(res.status, 404);
  });
});

describe('adding budget lines for late items', () => {
  const addLine = (body) =>
    fetch(`${ctx.baseUrl}/api/investment/budget`, {
      method: 'POST', headers: { Cookie: h, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('a new item continues the numbering and raises the quoted total', async () => {
    const before = (await get()).summary.quoted;
    const res = await addLine({ item: 'Extra bill validator', qty: 2, price_each: 450 });
    assert.equal(res.status, 201);
    const line = await res.json();
    assert.equal(line.line_no, 13, 'continues after the twelve seeded lines');
    assert.equal(line.amount, 900, 'worked out from quantity × price');
    assert.equal((await get()).summary.quoted, before + 900);
  });

  test('an amount can be given directly when there is no unit price', async () => {
    const line = await (await addLine({ item: 'Permit fees', amount: 325 })).json();
    assert.equal(line.amount, 325);
    assert.equal(line.qty, null);
  });

  test('a line with no amount and no way to work one out is refused', async () => {
    assert.equal((await addLine({ item: 'Something' })).status, 400);
    assert.equal((await addLine({ item: '', amount: 100 })).status, 400);
    assert.equal((await addLine({ item: 'Bad', qty: -1, price_each: 10 })).status, 400);
  });

  test('a mistaken line can be removed', async () => {
    const line = await (await addLine({ item: 'Typo', amount: 50 })).json();
    const res = await fetch(`${ctx.baseUrl}/api/investment/budget/${line.id}`, {
      method: 'DELETE', headers: { Cookie: h },
    });
    assert.equal(res.status, 200);
    assert.equal((await get()).budget.some((b) => b.id === line.id), false);
  });

  // Removing it would detach the money from what it was for, and the released total would no
  // longer add up to anything the budget explains.
  test('a line with money against it cannot be removed', async () => {
    const line = await (await addLine({ item: 'Signage', amount: 1200 })).json();
    await release({ released_on: '2026-10-10', amount: 400, budget_id: line.id });

    const res = await fetch(`${ctx.baseUrl}/api/investment/budget/${line.id}`, {
      method: 'DELETE', headers: { Cookie: h },
    });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /reassign or remove/);
    assert.equal((await get()).budget.some((b) => b.id === line.id), true, 'still there');
  });

  test('adding and removing both reach the trail as sensitive', async () => {
    const log = await (await fetch(`${ctx.baseUrl}/api/audit?limit=100`, { headers: { Cookie: owner } })).json();
    const added = log.find((e) => e.action === 'investment-budget-added');
    const removed = log.find((e) => e.action === 'investment-budget-removed');
    assert.ok(added && removed, 'both actions recorded');
    assert.equal(added.area, 'investment');
    assert.equal(added.sensitive, true);
    assert.match(removed.detail, /Typo/);
  });

  test('a non-admin cannot add a budget line', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/investment/budget`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: 'Sneak', amount: 1 }),
    });
    assert.equal(res.status, 401);
  });
});
