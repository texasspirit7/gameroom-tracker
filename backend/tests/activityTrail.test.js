import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signInAsAdmin, signInAsApprovedUser, signInAsOwner } from './helpers/testServer.js';

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same db singleton.
let ctx, ownerCookie, adminCookie, userCookie, userId;
before(async () => {
  ctx = await startTestServer();
  ownerCookie = await signInAsOwner(ctx.baseUrl);
  adminCookie = await signInAsAdmin(ctx.baseUrl);
  userCookie = await signInAsApprovedUser(ctx.baseUrl, adminCookie);
  const roster = await (await fetch(`${ctx.baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } })).json();
  userId = roster.find((u) => u.email === 'user@test.local').id;
});
after(async () => { await ctx.stop(); });

const trail = async (cookie = ownerCookie) =>
  (await fetch(`${ctx.baseUrl}/api/audit?limit=500`, { headers: { Cookie: cookie } })).json();

const entriesFor = (log, action) => log.filter((e) => e.action === action);

describe('the trail is owner-only', () => {
  // Previously this endpoint sat behind requireAuth/requireApproved and nothing else, so any
  // approved account could read the record of what everyone else had done.
  test('an ordinary approved user is refused', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/audit`, { headers: { Cookie: userCookie } });
    assert.equal(res.status, 403);
  });

  test('even an admin who is not the owner is refused', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/audit`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 403);
  });

  test('the owner can read it', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/audit`, { headers: { Cookie: ownerCookie } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(await res.json()));
  });
});

describe('user administration is recorded', () => {
  test('approving a user is logged, naming who was approved', async () => {
    const log = await trail();
    const entry = entriesFor(log, 'user-approved')[0];
    assert.ok(entry, 'expected a user-approved entry');
    assert.match(entry.detail, /user@test\.local/);
    assert.equal(entry.actor_email, 'admin@test.local', 'records who did it');
  });

  test('a role change records both the old and new role', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/admin/users/${userId}/role`, {
      method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(res.status, 200);

    const entry = entriesFor(await trail(), 'user-role-changed')[0];
    assert.ok(entry, 'expected a user-role-changed entry');
    assert.match(entry.detail, /user@test\.local: user → admin/);
  });

  test('blocking a user is logged', async () => {
    await fetch(`${ctx.baseUrl}/api/admin/users/${userId}/block`, {
      method: 'POST', headers: { Cookie: adminCookie },
    });
    const entry = entriesFor(await trail(), 'user-blocked')[0];
    assert.ok(entry, 'expected a user-blocked entry');
    assert.match(entry.detail, /user@test\.local/);
  });
});

describe('money changes are recorded', () => {
  test('a manual expense is logged', async () => {
    await fetch(`${ctx.baseUrl}/api/expenses`, {
      method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expense_date: '2026-09-01', category: 'rent', amount: 500 }),
    });
    const entry = entriesFor(await trail(), 'expense-added')[0];
    assert.ok(entry, 'expected an expense-added entry');
    assert.match(entry.detail, /rent \$500 on 2026-09-01/);
  });

  test('a profit-split comment is logged', async () => {
    await fetch(`${ctx.baseUrl}/api/profit-split/closed`, {
      method: 'PATCH', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'settled' }),
    });
    const entry = entriesFor(await trail(), 'split-comment')[0];
    assert.ok(entry, 'expected a split-comment entry');
    assert.match(entry.detail, /closed period/);
  });

  test('signing in is logged', async () => {
    const entry = entriesFor(await trail(), 'signed-in')[0];
    assert.ok(entry, 'expected a signed-in entry');
    assert.match(entry.detail, /local sign-in/);
  });
});

describe('entries carry an area, and the sensitive ones are flagged', () => {
  const expected = [
    ['user-role-changed', 'users', true],
    ['user-approved', 'users', true],
    ['user-blocked', 'users', true],
    ['split-comment', 'split', true],
    ['expense-added', 'expenses', false],
    ['signed-in', 'system', false],
  ];

  test('each action maps to its area with the right sensitivity', async () => {
    const log = await trail();
    for (const [action, area, sensitive] of expected) {
      const entry = entriesFor(log, action)[0];
      assert.ok(entry, `expected an entry for ${action}`);
      assert.equal(entry.area, area, `${action} area`);
      assert.equal(entry.sensitive, sensitive, `${action} sensitivity`);
    }
  });

  // Users and money are the two that matter; everything else is background noise by design.
  test('only user administration and profit split are sensitive', async () => {
    const log = await trail();
    const areas = [...new Set(log.filter((e) => e.sensitive).map((e) => e.area))].sort();
    assert.deepEqual(areas, ['split', 'users']);
  });

  test('an unmapped action falls back to "other" rather than vanishing', async () => {
    const { logAudit } = await import('../routes/audit.js');
    logAudit({ user: { email: 'someone@test.local' } }, { action: 'brand-new-thing' });
    const entry = entriesFor(await trail(), 'brand-new-thing')[0];
    assert.ok(entry, 'the entry is still returned');
    assert.equal(entry.area, 'other');
    assert.equal(entry.sensitive, false);
  });
});
