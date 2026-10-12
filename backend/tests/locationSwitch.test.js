import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin, signIn } from './helpers/testServer.js';

function buildSheetXlsx(totalIn) {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, totalIn, totalIn, 0, 0, 0, '100%'],
    ['Total', '', '', totalIn, '', '', 0, '100%'],
    [],
    ['Total Out', '$', 0, 'Total In', '$', totalIn, 'Bank'],
  ]), 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same handles.
let ctx, la, onlyLa;
before(async () => {
  ctx = await startTestServer();
  la = await signInAsAdmin(ctx.baseUrl, 'la');

  // A sheet in La only, so a switch is visible in the data rather than just the label.
  const form = new FormData();
  form.append('file', new Blob([buildSheetXlsx(4000)]), 'sheet.xlsx');
  form.append('sheet_date', '2026-09-15');
  await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: la }, body: form });

  // Someone granted access to La only — the case the switcher must not help.
  await fetch(`${ctx.baseUrl}/api/admin/users`, {
    method: 'POST', headers: { Cookie: la, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'laonly@test.local', name: 'La Only' }),
  });
  onlyLa = await signIn(ctx.baseUrl, { name: 'La Only', email: 'laonly@test.local' }, 'la');
});
after(async () => { await ctx.stop(); });

const me = async (cookie) =>
  (await (await fetch(`${ctx.baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })).json()).user;

const switchTo = (cookie, location) =>
  fetch(`${ctx.baseUrl}/api/auth/switch`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ location }),
  });

describe('an account is told where it may go', () => {
  test('an admin listed in ADMIN_EMAILS can reach both', async () => {
    const user = await me(la);
    assert.deepEqual(user.locations.map((l) => l.key).sort(), ['h', 'la']);
    assert.equal(user.location, 'la', 'and is currently in La');
  });

  test('an account granted one location is told about that one only', async () => {
    const user = await me(onlyLa);
    assert.deepEqual(user.locations.map((l) => l.key), ['la'], 'nothing to switch to');
  });
});

describe('switching without signing out', () => {
  test('moves the session, and the data moves with it', async () => {
    assert.equal((await (await fetch(`${ctx.baseUrl}/api/sheets`, { headers: { Cookie: la } })).json()).length, 1);

    const res = await switchTo(la, 'h');
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie').split(';')[0];

    const user = await me(cookie);
    assert.equal(user.location, 'h');
    assert.equal((await (await fetch(`${ctx.baseUrl}/api/sheets`, { headers: { Cookie: cookie } })).json()).length, 0,
      'Houston has no sheets of its own');
  });

  test('and back again, with La’s data intact', async () => {
    const toH = (await switchTo(la, 'h')).headers.get('set-cookie').split(';')[0];
    const back = (await switchTo(toH, 'la')).headers.get('set-cookie').split(';')[0];
    assert.equal((await me(back)).location, 'la');
    assert.equal((await (await fetch(`${ctx.baseUrl}/api/sheets`, { headers: { Cookie: back } })).json()).length, 1);
  });

  test('switching to where you already are is a no-op, not an error', async () => {
    const res = await switchTo(la, 'la');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.location, 'la');
  });

  // Hiding the option in the sidebar has never been what stops anyone.
  test('an account without access is refused even asking directly', async () => {
    const res = await switchTo(onlyLa, 'h');
    assert.equal(res.status, 403);
    assert.equal((await me(onlyLa)).location, 'la', 'and is left where it was');
  });

  test('an unknown location is refused', async () => {
    assert.equal((await switchTo(la, 'nowhere')).status, 400);
  });

  test('signing out is still required to be nobody', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/auth/switch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: 'h' }),
    });
    assert.equal(res.status, 401, 'no session, no switch');
  });
});
