import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signInAsAdmin } from './helpers/testServer.js';

// One shared server for the file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same handles.
let ctx, admin;
before(async () => {
  ctx = await startTestServer();
  admin = await signInAsAdmin(ctx.baseUrl, 'la');
});
after(async () => { await ctx.stop(); });

const config = async () => (await fetch(`${ctx.baseUrl}/api/auth/config`)).json();
const me = async () =>
  (await (await fetch(`${ctx.baseUrl}/api/auth/me`, { headers: { Cookie: admin } })).json()).user;

/**
 * The names are served from two places that are easy to change independently, so both are
 * pinned here. The location *keys* stay 'la' and 'h' whatever the names are: they're baked
 * into live session cookies and into the SQLite filenames on disk.
 */
describe('location display names', () => {
  test('the config route names every location', async () => {
    const cfg = await config();
    assert.deepEqual(cfg.locationNames, { la: 'London', h: 'Helsinki' });
  });

  test('a session carries the name of each location it can reach', async () => {
    const user = await me();
    assert.deepEqual(
      user.locations.map((l) => [l.key, l.name]).sort(),
      [['h', 'Helsinki'], ['la', 'London']],
    );
  });

  // The sign-in screen is shown to anyone who loads the site, so it deliberately says less
  // than the inside of the app does.
  test('the sign-in labels do not give the names away', async () => {
    const user = await me();
    for (const { label } of user.locations) {
      assert.ok(!/london|helsinki/i.test(label), `sign-in label leaks a name: ${label}`);
    }
  });
});
