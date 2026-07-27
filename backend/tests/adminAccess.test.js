import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signInAsAdmin, signInAsApprovedUser } from './helpers/testServer.js';

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same db singleton.
let ctx, adminCookie, userCookie;
before(async () => {
  ctx = await startTestServer();
  adminCookie = await signInAsAdmin(ctx.baseUrl);
  userCookie = await signInAsApprovedUser(ctx.baseUrl, adminCookie);
});
after(async () => { await ctx.stop(); });

describe('/api/admin/users — the roster is admin-only, reads included', () => {
  test('an approved non-admin cannot read the user list', async () => {
    // Regression: this was readable by any approved user, exposing every account's email,
    // role and approval history to someone who only needs the operational data.
    const res = await fetch(`${ctx.baseUrl}/api/admin/users`, { headers: { Cookie: userCookie } });
    assert.equal(res.status, 403);
  });

  test('an admin can read the user list', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const users = await res.json();
    assert.ok(users.length >= 2, 'admin and the approved user are both on the roster');
    assert.ok(users.every((u) => u.email), 'rows carry the fields the admin page renders');
  });

  test('a signed-out request is refused before it reaches the role check', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/admin/users`);
    assert.equal(res.status, 401);
  });

  test('mutating roles and approval stays admin-only', async () => {
    for (const path of ['/api/admin/users/1/approve', '/api/admin/users/1/block', '/api/admin/users/1/role']) {
      const res = await fetch(`${ctx.baseUrl}${path}`, {
        method: 'POST',
        headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      });
      assert.equal(res.status, 403, `${path} should be admin-gated`);
    }
  });
});
