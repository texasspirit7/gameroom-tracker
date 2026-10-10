import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same handles.
let ctx, h;
before(async () => {
  ctx = await startTestServer();
  h = await signInAsAdmin(ctx.baseUrl, 'h');
  // Start from a clean budget so the arithmetic is easy to follow: three lines, 1000 each.
  const existing = await (await fetch(`${ctx.baseUrl}/api/investment`, { headers: { Cookie: h } })).json();
  for (const b of existing.budget) {
    await fetch(`${ctx.baseUrl}/api/investment/budget/${b.id}`, { method: 'DELETE', headers: { Cookie: h } });
  }
  for (const item of ['Alpha', 'Beta', 'Gamma']) {
    await fetch(`${ctx.baseUrl}/api/investment/budget`, {
      method: 'POST', headers: { Cookie: h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ item, amount: 1000 }),
    });
  }
});
after(async () => { await ctx.stop(); });

const get = async () => (await fetch(`${ctx.baseUrl}/api/investment`, { headers: { Cookie: h } })).json();
const release = (body) =>
  fetch(`${ctx.baseUrl}/api/investment/disbursements`, {
    method: 'POST', headers: { Cookie: h, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const line = (budget, item) => budget.find((b) => b.item === item);

describe('money released without naming a line is spread across the budget', () => {
  test('an even spread when every line needs the same', async () => {
    await release({ released_on: '2026-10-01', amount: 300 });
    const { budget, summary } = await get();
    for (const item of ['Alpha', 'Beta', 'Gamma']) {
      assert.equal(line(budget, item).spread, 100, `${item} takes a third`);
      assert.equal(line(budget, item).released, 100);
    }
    assert.equal(summary.unassigned, 300);
    assert.equal(summary.spread, 300, 'all of it found a home');
    assert.equal(summary.surplus, 0);
  });

  test('the parts always sum to the whole, whatever the rounding', async () => {
    // 100 across three equal lines does not divide evenly.
    await release({ released_on: '2026-10-02', amount: 100 });
    const { budget, summary } = await get();
    const total = budget.reduce((s, b) => s + b.spread, 0);
    assert.equal(Math.round(total * 100) / 100, summary.spread);
    assert.equal(summary.spread, 400, 'the earlier 300 plus this 100');
  });
});

describe('a line already paid for directly is not covered twice', () => {
  test('spreading skips what has been assigned and favours what still needs funding', async () => {
    // Alpha is paid in full directly; the remaining need is Beta and Gamma only.
    const before = await get();
    await release({ released_on: '2026-10-03', amount: 1000, budget_id: line(before.budget, 'Alpha').id });

    const { budget } = await get();
    const alpha = line(budget, 'Alpha');
    assert.equal(alpha.assigned, 1000, 'paid directly');
    assert.equal(alpha.spread, 0, 'and so takes no share of the unassigned money');

    // The 400 unassigned now splits between Beta and Gamma, which still need 1000 each.
    assert.equal(line(budget, 'Beta').spread, 200);
    assert.equal(line(budget, 'Gamma').spread, 200);
  });

  test('a line is never shown as funded beyond its own quote by spreading', async () => {
    const { budget } = await get();
    for (const b of budget) {
      if (b.assigned <= b.amount) {
        assert.ok(b.released <= b.amount + 0.01, `${b.item} not over-funded by the spread`);
      }
    }
  });
});

describe('money beyond what the budget needs', () => {
  test('is reported as surplus rather than forced into the lines', async () => {
    // Beta and Gamma need 800 each after the spread so far; release far more than that.
    await release({ released_on: '2026-10-04', amount: 5000 });
    const { budget, summary } = await get();

    assert.equal(line(budget, 'Beta').released, 1000, 'filled to its quote, no further');
    assert.equal(line(budget, 'Gamma').released, 1000);
    assert.ok(summary.surplus > 0, 'the rest is surplus');
    assert.equal(
      Math.round((summary.spread + summary.surplus) * 100) / 100,
      summary.unassigned,
      'spread plus surplus accounts for every unassigned dollar',
    );
  });

  test('the released total is unaffected by how it was split', async () => {
    const { summary } = await get();
    assert.equal(summary.released, round(summary.assigned + summary.unassigned));
    function round(n) { return Math.round(n * 100) / 100; }
  });
});
