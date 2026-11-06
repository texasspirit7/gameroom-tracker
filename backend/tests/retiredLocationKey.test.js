import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

// One shared server for the file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same handles.
let ctx, admin;
before(async () => {
  ctx = await startTestServer();
  admin = await signInAsAdmin(ctx.baseUrl, 'la');
});
after(async () => { await ctx.stop(); });

/** A session cookie signed with the server's own secret, naming a location that no longer exists. */
const retiredSessionCookie = () =>
  `grt_session=${jwt.sign({ uid: 1, email: 'admin@test.local', loc: 'p' }, 'test-only-secret')}`;

/**
 * Renaming a location key retires the old one while sessions are still carrying it. That has
 * to end as a clean sign-out rather than a 500: getDb() throws on an unknown key, so the
 * check in requireAuth is the only thing standing between a retired key and a broken app.
 */
describe('a session naming a retired location', () => {
  test('is turned away rather than crashing', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/sheets`, { headers: { Cookie: retiredSessionCookie() } });
    assert.equal(res.status, 401, 'not 500 — the database for that key cannot be opened');
    assert.match((await res.json()).error, /unknown location/i);
  });

  test('has its cookie cleared, so the next request is a clean sign-in', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/auth/me`, { headers: { Cookie: retiredSessionCookie() } });
    assert.equal(res.status, 401);
    assert.match(res.headers.get('set-cookie') ?? '', /grt_session=;/, 'the stale cookie is expired');
  });

  test('every other session is unaffected', async () => {
    assert.equal((await fetch(`${ctx.baseUrl}/api/sheets`, { headers: { Cookie: admin } })).status, 200);
  });
});
