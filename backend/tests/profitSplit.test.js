import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signInAsAdmin, signInAsApprovedUser } from './helpers/testServer.js';

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() call here would silently reuse (and, after an earlier block's teardown,
// find *closed*) the same db.js singleton.
//
// Split arithmetic lives in profitSplitWeekly.test.js; this file is about who may reach it.
let ctx, adminCookie, userCookie;
before(async () => {
  ctx = await startTestServer();
  adminCookie = await signInAsAdmin(ctx.baseUrl);
  userCookie = await signInAsApprovedUser(ctx.baseUrl, adminCookie);
});
after(async () => { await ctx.stop(); });

describe('/api/profit-split — admin-only page', () => {
  test('an admin gets the rows and the account summary', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.rows), 'rows is an array');
    assert.ok(body.account, 'account summary is present');
    assert.equal(body.account.split_a, 0.4);
    assert.equal(body.account.split_b, 0.6);
  });

  test('a non-admin approved user gets 403', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: userCookie } });
    assert.equal(res.status, 403);
  });

  test('a non-admin cannot save a comment', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/2026-08-24`, {
      method: 'PATCH', headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'hi' }),
    });
    assert.equal(res.status, 403);
  });

  test('a PATCH with nothing to change is rejected', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/2026-08-24`, {
      method: 'PATCH', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});
