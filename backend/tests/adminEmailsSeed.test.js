import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

// The test server sets ADMIN_EMAILS='admin@test.local'.
const SEEDED = 'admin@test.local';

const signIn = (baseUrl, name, email) =>
  fetch(`${baseUrl}/api/auth/local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email }),
  });

// Fields are read individually rather than deep-compared: node:sqlite returns null-prototype
// rows, which strict deepEqual rejects even when every value matches.
const roleOf = (ctx, email) => {
  const r = ctx.db.prepare('SELECT role, status FROM users WHERE email = ?').get(email);
  return { role: r?.role, status: r?.status };
};

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same db singleton.
let ctx, seededCookie;
before(async () => {
  ctx = await startTestServer();
  seededCookie = await signInAsAdmin(ctx.baseUrl);
});
after(async () => { await ctx.stop(); });

describe('ADMIN_EMAILS seeds access but must not overrule the admin UI', () => {
  test('a listed address is created as an approved admin on first sign-in', () => {
    assert.deepEqual(roleOf(ctx, SEEDED), { role: 'admin', status: 'approved' });
  });

  test('regression: a demotion made in the UI survives the demoted admin signing in again', async () => {
    // A second admin is needed to do the demoting — you can't demote your own account.
    const otherRes = await signIn(ctx.baseUrl, 'Second Admin', 'second@test.local');
    const otherCookie = otherRes.headers.get('set-cookie').split(';')[0];
    const { user: other } = await otherRes.json();

    await fetch(`${ctx.baseUrl}/api/admin/users/${other.id}/approve`, { method: 'POST', headers: { Cookie: seededCookie } });
    await fetch(`${ctx.baseUrl}/api/admin/users/${other.id}/role`, {
      method: 'POST',
      headers: { Cookie: seededCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });

    // Second admin demotes the ADMIN_EMAILS-listed account.
    const seededId = ctx.db.prepare('SELECT id FROM users WHERE email = ?').get(SEEDED).id;
    const demote = await fetch(`${ctx.baseUrl}/api/admin/users/${seededId}/role`, {
      method: 'POST',
      headers: { Cookie: otherCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    assert.equal(demote.status, 200);
    assert.equal(roleOf(ctx, SEEDED).role, 'user', 'demotion is recorded');

    // Signing in again previously re-promoted them straight back to admin.
    await signIn(ctx.baseUrl, 'Test Admin', SEEDED);
    assert.equal(roleOf(ctx, SEEDED).role, 'user', 'ADMIN_EMAILS must not undo the demotion');
  });

  test('break-glass: with no approved admin left, a listed address is restored on sign-in', async () => {
    ctx.db.exec("UPDATE users SET role = 'user'");
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n, 0);

    await signIn(ctx.baseUrl, 'Test Admin', SEEDED);
    assert.deepEqual(roleOf(ctx, SEEDED), { role: 'admin', status: 'approved' }, 'recovery path still works');
  });

  test('an unlisted address is never promoted by signing in, even with no admins left', async () => {
    ctx.db.exec("UPDATE users SET role = 'user'");
    await signIn(ctx.baseUrl, 'Second Admin', 'second@test.local');
    assert.equal(roleOf(ctx, 'second@test.local').role, 'user');
  });
});
