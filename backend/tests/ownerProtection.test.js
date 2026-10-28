import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signInAsAdmin, signInAsOwner } from './helpers/testServer.js';

// The test server sets OWNER_EMAIL=owner@test.local and ADMIN_EMAILS to include it, so the
// owner here stands in for texasspirit7@gmail.com in production.
const OWNER = 'owner@test.local';

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same handles.
let ctx, admin, owner;
before(async () => {
  ctx = await startTestServer();
  admin = await signInAsAdmin(ctx.baseUrl, 'la');
  owner = await signInAsOwner(ctx.baseUrl, 'la');
  // The seeded admin must be an admin to attempt any of this.
  await fetch(`${ctx.baseUrl}/api/admin/users`, { headers: { Cookie: admin } });
});
after(async () => { await ctx.stop(); });

const roster = async (cookie = admin) =>
  (await fetch(`${ctx.baseUrl}/api/admin/users`, { headers: { Cookie: cookie } })).json();

const ownerRow = async () => (await roster()).find((u) => u.email === OWNER);

describe('the owner account cannot be disabled by anyone', () => {
  test('another admin cannot delete it', async () => {
    const row = await ownerRow();
    const res = await fetch(`${ctx.baseUrl}/api/admin/users/${row.id}`, {
      method: 'DELETE', headers: { Cookie: admin },
    });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /owner account is protected/);
    assert.ok((await ownerRow()), 'still there');
  });

  // Protecting only deletion would be false assurance: a blocked account is locked out just
  // as completely.
  test('another admin cannot block it', async () => {
    const row = await ownerRow();
    const res = await fetch(`${ctx.baseUrl}/api/admin/users/${row.id}/block`, {
      method: 'POST', headers: { Cookie: admin },
    });
    assert.equal(res.status, 403);
    assert.equal((await ownerRow()).status, 'approved', 'still able to sign in');
  });

  test('another admin cannot demote it', async () => {
    const row = await ownerRow();
    const res = await fetch(`${ctx.baseUrl}/api/admin/users/${row.id}/role`, {
      method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    assert.equal(res.status, 403);
    assert.equal((await ownerRow()).role, 'admin', 'still an admin');
  });

  test('nor can the owner do it to themselves', async () => {
    const row = await ownerRow();
    for (const [method, path] of [['DELETE', ''], ['POST', '/block']]) {
      const res = await fetch(`${ctx.baseUrl}/api/admin/users/${row.id}${path}`, {
        method, headers: { Cookie: owner },
      });
      assert.ok(res.status === 403 || res.status === 400, `${method} ${path} refused`);
    }
    assert.equal((await ownerRow()).status, 'approved');
  });

  test('the protection holds in every location', async () => {
    const hAdmin = await signInAsAdmin(ctx.baseUrl, 'h');
    await signInAsOwner(ctx.baseUrl, 'h');
    const hRows = await roster(hAdmin);
    const hOwner = hRows.find((u) => u.email === OWNER);
    assert.ok(hOwner, 'the owner has an account in Helsinki too');
    const res = await fetch(`${ctx.baseUrl}/api/admin/users/${hOwner.id}`, {
      method: 'DELETE', headers: { Cookie: hAdmin },
    });
    assert.equal(res.status, 403);
  });
});

describe('everyone else is still manageable', () => {
  test('an ordinary account can be deleted as before', async () => {
    const created = await (await fetch(`${ctx.baseUrl}/api/admin/users`, {
      method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ordinary@test.local', name: 'Ordinary' }),
    })).json();
    const res = await fetch(`${ctx.baseUrl}/api/admin/users/${created.id}`, {
      method: 'DELETE', headers: { Cookie: admin },
    });
    assert.equal(res.status, 200);
  });

  test('and promoting the owner is still allowed — only demotion is barred', async () => {
    const row = await ownerRow();
    const res = await fetch(`${ctx.baseUrl}/api/admin/users/${row.id}/role`, {
      method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(res.status, 200);
  });
});
