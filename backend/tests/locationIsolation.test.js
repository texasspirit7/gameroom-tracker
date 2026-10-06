import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin, signInAsOwner, signInAsApprovedUser } from './helpers/testServer.js';

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
let ctx, la, h, laOwner, hOwner;
before(async () => {
  ctx = await startTestServer();
  // The same email signing in to each location creates a separate account in each database.
  la = await signInAsAdmin(ctx.baseUrl, 'la');
  h = await signInAsAdmin(ctx.baseUrl, 'h');
  // The trail is owner-only, and the owner is a separate account in each database.
  laOwner = await signInAsOwner(ctx.baseUrl, 'la');
  hOwner = await signInAsOwner(ctx.baseUrl, 'h');
});
after(async () => { await ctx.stop(); });

const upload = async (cookie, sheetDate, amount) => {
  const form = new FormData();
  form.append('file', new Blob([buildSheetXlsx(amount)]), 'sheet.xlsx');
  form.append('sheet_date', sheetDate);
  const res = await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  assert.equal(res.status, 200, `upload for ${sheetDate} should succeed`);
};

const sheets = async (cookie) =>
  (await fetch(`${ctx.baseUrl}/api/sheets`, { headers: { Cookie: cookie } })).json();

// This is the guarantee the whole design rests on: one location's figures must never be
// reachable from the other's session, whatever the query.
describe('a location cannot see another location’s data', () => {
  test('sheets uploaded to La are invisible in H', async () => {
    await upload(la, '2026-09-07', 5000);
    assert.equal((await sheets(la)).length, 1);
    assert.equal((await sheets(h)).length, 0, 'H must not see La’s sheet');
  });

  test('and sheets uploaded to H are invisible in La', async () => {
    await upload(h, '2026-09-08', 900);
    assert.equal((await sheets(h)).length, 1);
    assert.equal((await sheets(la)).length, 1, 'La still sees only its own');
    assert.equal((await sheets(la))[0].sheet_date, '2026-09-07');
  });

  test('dashboard totals are per location', async () => {
    const totals = async (c) => (await (await fetch(`${ctx.baseUrl}/api/dashboard?from=2026-09-01&to=2026-09-30`, { headers: { Cookie: c } })).json()).totals;
    assert.equal((await totals(la)).total_in, 5000);
    assert.equal((await totals(h)).total_in, 900);
  });

  test('the same day can hold a sheet in each location', async () => {
    // One-sheet-per-day is enforced within a location, not across them.
    await upload(la, '2026-09-20', 100);
    await upload(h, '2026-09-20', 200);
    assert.ok((await sheets(la)).some((s) => s.sheet_date === '2026-09-20'));
    assert.ok((await sheets(h)).some((s) => s.sheet_date === '2026-09-20'));
  });

  test('expenses, receipts and notes are per location too', async () => {
    await fetch(`${ctx.baseUrl}/api/expenses`, {
      method: 'POST', headers: { Cookie: la, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expense_date: '2026-09-07', category: 'rent', amount: 400 }),
    });
    await fetch(`${ctx.baseUrl}/api/profit-split/notes`, {
      method: 'POST', headers: { Cookie: la, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_date: '2026-09-07', body: 'La only' }),
    });
    const hExpenses = await (await fetch(`${ctx.baseUrl}/api/expenses`, { headers: { Cookie: h } })).json();
    const hNotes = await (await fetch(`${ctx.baseUrl}/api/profit-split/notes`, { headers: { Cookie: h } })).json();
    assert.equal(hExpenses.expenses.length, 0, 'H sees no La expenses');
    assert.equal(hNotes.length, 0, 'H sees no La notes');
  });

  test('the activity trail does not cross over', async () => {
    const trail = async (c) => (await (await fetch(`${ctx.baseUrl}/api/audit?limit=200`, { headers: { Cookie: c } })).json());
    const laDetails = (await trail(laOwner)).map((e) => e.detail).join(' ');
    const hDetails = (await trail(hOwner)).map((e) => e.detail).join(' ');
    assert.match(laDetails, /La only/, 'La records its own note');
    assert.doesNotMatch(hDetails, /La only/, 'H’s trail has no sign of it');
  });
});

describe('accounts belong to a location', () => {
  test('signing in to each location creates a separate account', async () => {
    const roster = async (c) => (await (await fetch(`${ctx.baseUrl}/api/admin/users`, { headers: { Cookie: c } })).json());
    // An account created only in La must not appear in H's roster at all.
    await fetch(`${ctx.baseUrl}/api/admin/users`, {
      method: 'POST', headers: { Cookie: la, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'laonly@test.local', name: 'La Only' }),
    });
    const laEmails = (await roster(la)).map((u) => u.email);
    const hEmails = (await roster(h)).map((u) => u.email);
    assert.ok(laEmails.includes('laonly@test.local'), 'the account exists in La');
    assert.equal(hEmails.includes('laonly@test.local'), false, 'and nowhere in H');
  });

  test('a session cannot be pointed at another location', async () => {
    // The location is signed into the JWT, so there is no request parameter to tamper with.
    const res = await fetch(`${ctx.baseUrl}/api/sheets?location=h`, { headers: { Cookie: la } });
    const rows = await res.json();
    assert.equal(rows.every((s) => s.sheet_date !== '2026-09-08'), true, 'no H sheet leaks through a query param');
  });

  // The whole point of identifying first: an address with no access is offered nothing.
  test('an address with no access is offered no locations at all', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/auth/local`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nobody', email: 'nobody@test.local' }),
    });
    assert.equal(res.status, 200, 'identifying succeeds — it just yields nothing to enter');
    const body = await res.json();
    assert.deepEqual(body.locations, [], 'no doors shown');
  });

  test('and naming a location anyway is refused', async () => {
    const idRes = await fetch(`${ctx.baseUrl}/api/auth/local`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nobody', email: 'nobody@test.local' }),
    });
    const idCookie = idRes.headers.get('set-cookie').split(';')[0];
    const res = await fetch(`${ctx.baseUrl}/api/auth/enter`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: idCookie },
      body: JSON.stringify({ location: 'h' }),
    });
    assert.equal(res.status, 403, 'hiding the button is not the only thing stopping them');
  });

  test('an unknown location is refused', async () => {
    const idRes = await fetch(`${ctx.baseUrl}/api/auth/local`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin', email: 'admin@test.local' }),
    });
    const idCookie = idRes.headers.get('set-cookie').split(';')[0];
    const res = await fetch(`${ctx.baseUrl}/api/auth/enter`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: idCookie },
      body: JSON.stringify({ location: 'xyz' }),
    });
    assert.equal(res.status, 400);
  });
});

describe('each location keeps its own split terms', () => {
  test('La splits 40/60 and carries its closed-out history', async () => {
    const { rows, account } = await (await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: la } })).json();
    assert.equal(account.split_a, 0.4);
    assert.equal(account.split_b, 0.6);
    assert.equal(account.target, 80000);
    assert.ok(rows.some((r) => r.closed), 'La has a closed period');
  });

  test('H splits 50/50, with no close-out and no target', async () => {
    const { rows, account } = await (await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: h } })).json();
    assert.equal(account.split_a, 0.5);
    assert.equal(account.split_b, 0.5);
    assert.equal(account.target, 175000, 'H has its own target');
    assert.equal(account.close_out_date, null);
    assert.equal(rows.some((r) => r.closed), false, 'H has no closed period');
  });

  test('H’s weekly figures use the 50/50 terms', async () => {
    const { rows } = await (await fetch(`${ctx.baseUrl}/api/profit-split`, { headers: { Cookie: h } })).json();
    const week = rows.find((r) => r.net_profit > 0);
    assert.ok(week, 'expected a week with profit');
    assert.equal(week.amount_40, week.net_profit * 0.5, 'our half');
    assert.equal(week.amount_60, week.net_profit * 0.5, 'their half');
  });
});

describe('granting access', () => {
  const addTo = (cookie, email) =>
    fetch(`${ctx.baseUrl}/api/admin/users`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: 'Newcomer' }),
    });

  test('an added account can sign in, and is offered only that location', async () => {
    assert.equal((await addTo(h, 'newcomer@test.local')).status, 201);

    const idRes = await fetch(`${ctx.baseUrl}/api/auth/local`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Newcomer', email: 'newcomer@test.local' }),
    });
    const { locations } = await idRes.json();
    assert.deepEqual(locations.map((l) => l.key), ['h'], 'granted H, so H only');
  });

  test('the grant does not reach the other location', async () => {
    const laEmails = (await (await fetch(`${ctx.baseUrl}/api/admin/users`, { headers: { Cookie: la } })).json())
      .map((u) => u.email);
    assert.equal(laEmails.includes('newcomer@test.local'), false);
  });

  test('adding the same account twice is refused rather than duplicated', async () => {
    assert.equal((await addTo(h, 'newcomer@test.local')).status, 409);
  });

  test('a malformed address is rejected', async () => {
    assert.equal((await addTo(h, 'not-an-email')).status, 400);
  });

  test('a non-admin cannot grant access', async () => {
    const userCookie = await signInAsApprovedUser(ctx.baseUrl, la, 'plain@test.local', 'la');
    const res = await fetch(`${ctx.baseUrl}/api/admin/users`, {
      method: 'POST', headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'sneak@test.local' }),
    });
    assert.equal(res.status, 403);
  });
});
