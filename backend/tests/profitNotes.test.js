import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signInAsAdmin, signInAsApprovedUser, signInAsOwner } from './helpers/testServer.js';

// One shared server for the whole file — Node caches ES modules per process, so a second
// startTestServer() here would reuse (and after teardown, find closed) the same db singleton.
let ctx, adminCookie, userCookie, ownerCookie;
before(async () => {
  ctx = await startTestServer();
  adminCookie = await signInAsAdmin(ctx.baseUrl);
  ownerCookie = await signInAsOwner(ctx.baseUrl);
  userCookie = await signInAsApprovedUser(ctx.baseUrl, adminCookie);
});
after(async () => { await ctx.stop(); });

const notes = async () =>
  (await fetch(`${ctx.baseUrl}/api/profit-split/notes`, { headers: { Cookie: adminCookie } })).json();

const addNote = (body) =>
  fetch(`${ctx.baseUrl}/api/profit-split/notes`, {
    method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const editNote = (id, body) =>
  fetch(`${ctx.baseUrl}/api/profit-split/notes/${id}`, {
    method: 'PATCH', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const trail = async () =>
  (await fetch(`${ctx.baseUrl}/api/audit?limit=200`, { headers: { Cookie: ownerCookie } })).json();

const latest = (log, action) => log.find((e) => e.action === action);

describe('dated profit-split notes', () => {
  test('a note is stored against the date given, not today', async () => {
    const res = await addNote({ note_date: '2026-09-14', body: '  Owner collected in person  ' });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.note_date, '2026-09-14');
    assert.equal(created.body, 'Owner collected in person', 'trimmed');
    assert.equal(created.created_by, 'admin@test.local');
    assert.equal(created.updated_at, null, 'not edited yet');
  });

  test('notes come back newest first by their own date', async () => {
    await addNote({ note_date: '2026-09-20', body: 'Later note' });
    await addNote({ note_date: '2026-09-02', body: 'Earlier note' });
    const dates = (await notes()).map((n) => n.note_date);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  test('editing records who did it and when', async () => {
    const id = (await (await addNote({ note_date: '2026-09-21', body: 'First draft' })).json()).id;
    const res = await editNote(id, { body: 'Second draft' });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.body, 'Second draft');
    assert.equal(updated.updated_by, 'admin@test.local');
    assert.ok(updated.updated_at, 'stamped');
    assert.equal(updated.created_by, 'admin@test.local', 'the author is kept');
  });

  test('the date can be corrected on its own', async () => {
    const id = (await (await addNote({ note_date: '2026-09-22', body: 'Wrong day' })).json()).id;
    const updated = await (await editNote(id, { note_date: '2026-09-23' })).json();
    assert.equal(updated.note_date, '2026-09-23');
    assert.equal(updated.body, 'Wrong day', 'text untouched');
  });

  test('deleting removes it', async () => {
    const id = (await (await addNote({ note_date: '2026-09-24', body: 'Temporary' })).json()).id;
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/notes/${id}`, {
      method: 'DELETE', headers: { Cookie: adminCookie },
    });
    assert.equal(res.status, 200);
    assert.equal((await notes()).some((n) => n.id === id), false);
  });

  test('deleting one that is gone is a 404, not a silent success', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/notes/999999`, {
      method: 'DELETE', headers: { Cookie: adminCookie },
    });
    assert.equal(res.status, 404);
  });
});

describe('every change to a note reaches the activity trail', () => {
  test('adding names the date and quotes the note', async () => {
    await addNote({ note_date: '2026-10-05', body: 'Machine 12 swapped out' });
    const entry = latest(await trail(), 'split-note-added');
    assert.ok(entry, 'expected a split-note-added entry');
    assert.match(entry.detail, /2026-10-05/);
    assert.match(entry.detail, /Machine 12 swapped out/);
    assert.equal(entry.actor_email, 'admin@test.local', 'records who did it');
  });

  // "Edited a note" on its own says nothing — the point is what it used to say.
  test('editing records both the old and new text', async () => {
    const id = (await (await addNote({ note_date: '2026-10-06', body: 'Paid in cash' })).json()).id;
    await editNote(id, { body: 'Paid by Zelle' });

    const entry = latest(await trail(), 'split-note-edited');
    assert.ok(entry, 'expected a split-note-edited entry');
    assert.match(entry.detail, /Paid in cash/, 'the old text');
    assert.match(entry.detail, /Paid by Zelle/, 'and the new');
  });

  test('a date change is recorded as such', async () => {
    const id = (await (await addNote({ note_date: '2026-10-07', body: 'Stocktake' })).json()).id;
    await editNote(id, { note_date: '2026-10-08' });
    assert.match(latest(await trail(), 'split-note-edited').detail, /date 2026-10-07 → 2026-10-08/);
  });

  test('a save that changes nothing leaves no entry behind', async () => {
    const id = (await (await addNote({ note_date: '2026-10-09', body: 'Unchanged' })).json()).id;
    const before = (await trail()).filter((e) => e.action === 'split-note-edited').length;
    const res = await editNote(id, { body: 'Unchanged', note_date: '2026-10-09' });
    assert.equal(res.status, 200);
    const after = (await trail()).filter((e) => e.action === 'split-note-edited').length;
    assert.equal(after, before, 'a no-op save must not pad the trail');
  });

  test('deleting quotes what was removed', async () => {
    const id = (await (await addNote({ note_date: '2026-10-10', body: 'Written in error' })).json()).id;
    await fetch(`${ctx.baseUrl}/api/profit-split/notes/${id}`, { method: 'DELETE', headers: { Cookie: adminCookie } });
    const entry = latest(await trail(), 'split-note-deleted');
    assert.match(entry.detail, /Written in error/);
  });

  test('note changes count as sensitive, like the rest of profit split', async () => {
    const entry = latest(await trail(), 'split-note-added');
    assert.equal(entry.area, 'split');
    assert.equal(entry.sensitive, true);
  });
});

describe('note validation and access', () => {
  const bad = [
    ['a missing date', { body: 'text' }],
    ['a malformed date', { note_date: '10/05/2026', body: 'text' }],
    ['no text at all', { note_date: '2026-10-05', body: '' }],
    ['whitespace only', { note_date: '2026-10-05', body: '   ' }],
  ];
  for (const [label, body] of bad) {
    test(`rejects ${label}`, async () => assert.equal((await addNote(body)).status, 400));
  }

  test('a very long note is capped rather than rejected', async () => {
    const created = await (await addNote({ note_date: '2026-10-11', body: 'x'.repeat(5000) })).json();
    assert.equal(created.body.length, 2000);
  });

  test('a non-admin cannot read notes', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/notes`, { headers: { Cookie: userCookie } });
    assert.equal(res.status, 403);
  });

  test('a non-admin cannot add one', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/notes`, {
      method: 'POST', headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_date: '2026-10-05', body: 'nope' }),
    });
    assert.equal(res.status, 403);
  });

  test('the notes route does not shadow the per-period comment route', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/profit-split/closed`, {
      method: 'PATCH', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'still works' }),
    });
    assert.equal(res.status, 200);
  });
});
