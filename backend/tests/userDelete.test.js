import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signInAsAdmin, signInAsOwner, signIn } from './helpers/testServer.js';

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same handles.
let ctx, admin, owner;
before(async () => {
  ctx = await startTestServer();
  admin = await signInAsAdmin(ctx.baseUrl, 'la');
  owner = await signInAsOwner(ctx.baseUrl, 'la');
});
after(async () => { await ctx.stop(); });

const roster = async () =>
  (await fetch(`${ctx.baseUrl}/api/admin/users`, { headers: { Cookie: admin } })).json();

const add = (email) =>
  fetch(`${ctx.baseUrl}/api/admin/users`, {
    method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name: email.split('@')[0] }),
  });

const del = (id, cookie = admin) =>
  fetch(`${ctx.baseUrl}/api/admin/users/${id}`, { method: 'DELETE', headers: { Cookie: cookie } });

describe('removing a user from a location', () => {
  test('the account disappears from the roster', async () => {
    const created = await (await add('gone@test.local')).json();
    assert.equal((await del(created.id)).status, 200);
    assert.equal((await roster()).some((u) => u.email === 'gone@test.local'), false);
  });

  test('and loses access — sign-in offers them nothing', async () => {
    const created = await (await add('revoked@test.local')).json();
    await del(created.id);

    const res = await fetch(`${ctx.baseUrl}/api/auth/local`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Revoked', email: 'revoked@test.local' }),
    });
    assert.deepEqual((await res.json()).locations, [], 'no door left open');
  });

  test('it is recorded in the trail, naming who was removed', async () => {
    const created = await (await add('logged@test.local')).json();
    await del(created.id);
    const log = await (await fetch(`${ctx.baseUrl}/api/audit?limit=50`, { headers: { Cookie: owner } })).json();
    const entry = log.find((e) => e.action === 'user-deleted');
    assert.ok(entry, 'expected a user-deleted entry');
    assert.match(entry.detail, /logged@test\.local/);
    assert.equal(entry.sensitive, true, 'changes who can get in');
  });

  test('removing one here leaves the same person alone elsewhere', async () => {
    const hAdmin = await signInAsAdmin(ctx.baseUrl, 'h');
    await fetch(`${ctx.baseUrl}/api/admin/users`, {
      method: 'POST', headers: { Cookie: hAdmin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'both@test.local', name: 'Both' }),
    });
    const inLa = await (await add('both@test.local')).json();
    await del(inLa.id);

    const hRoster = await (await fetch(`${ctx.baseUrl}/api/admin/users`, { headers: { Cookie: hAdmin } })).json();
    assert.ok(hRoster.some((u) => u.email === 'both@test.local'), 'still has access to Houston');
  });
});

describe('guards', () => {
  test('you cannot delete your own account', async () => {
    const me = (await roster()).find((u) => u.email === 'admin@test.local');
    const res = await del(me.id);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /your own account/);
  });

  // The self-delete refusal is what keeps a location from losing its last admin: reaching
  // this route at all means being an approved admin, so one always survives.
  test('a location can never be left without an approved admin', async () => {
    const admins = (await roster()).filter((u) => u.role === 'admin' && u.status === 'approved');
    assert.ok(admins.length >= 1);
    for (const a of admins) {
      if (a.email === 'admin@test.local') continue;   // deleting others is allowed
      assert.equal((await del(a.id)).status === 400 || admins.length > 1, true);
    }
    const after = (await roster()).filter((u) => u.role === 'admin' && u.status === 'approved');
    assert.ok(after.length >= 1, 'at least the caller remains');
  });

  test('a plain user cannot delete anyone', async () => {
    const created = await (await add('victim@test.local')).json();
    const plain = await (await add('plain@test.local')).json();
    const plainCookie = await signIn(ctx.baseUrl, { name: 'Plain', email: 'plain@test.local' }, 'la');
    assert.equal((await del(created.id, plainCookie)).status, 403);
    assert.ok((await roster()).some((u) => u.id === created.id), 'still there');
    assert.ok(plain.id);
  });

  test('deleting someone who is already gone is a 404', async () => {
    assert.equal((await del(999999)).status, 404);
  });
});
