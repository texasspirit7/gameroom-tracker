import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import xlsx from 'xlsx';
import { startTestServer, signInAsAdmin, signInAsApprovedUser } from './helpers/testServer.js';

function buildSheetXlsx() {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, 100, 100, 0, 50, 50, '50%'],
    ['Total', '', '', 100, '', '', 50, '50%'],
    [],
    ['Total Out', '$', 50, 'Total In', '$', 100, 'Bank'],
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// backup.js is imported dynamically inside before() — a static import would run before
// startTestServer() sets DATA_DIR, leaving config.js pointing at the real dev database.
let ctx, adminCookie, userCookie, backup;
before(async () => {
  ctx = await startTestServer();
  adminCookie = await signInAsAdmin(ctx.baseUrl);
  userCookie = await signInAsApprovedUser(ctx.baseUrl, adminCookie);
  backup = await import('../backup.js');

  const form = new FormData();
  form.append('file', new Blob([buildSheetXlsx()]), 'sheet.xlsx');
  form.append('sheet_date', '2026-02-01');
  await fetch(`${ctx.baseUrl}/api/sheets/upload`, { method: 'POST', headers: { Cookie: adminCookie }, body: form });
});
after(async () => { await ctx.stop(); });

describe('backup — nightly SQLite snapshots', () => {
  test('a snapshot is a valid database containing the real rows, not an empty file', () => {
    const name = backup.runBackup({ force: true, now: new Date('2026-02-02T03:00:00Z') });
    assert.ok(name, 'expected a snapshot filename');

    const snap = new DatabaseSync(path.join(backup.backupDir(), name));
    try {
      const sheets = snap.prepare('SELECT sheet_date, total_in FROM sheets').all();
      assert.equal(sheets.length, 1, 'the uploaded sheet is present in the snapshot');
      assert.equal(sheets[0].sheet_date, '2026-02-01');
      assert.equal(sheets[0].total_in, 100);
      // The machine readings live in a separate table — confirm the whole schema came across,
      // not just the row the test happened to look for first.
      assert.equal(snap.prepare('SELECT COUNT(*) AS n FROM machine_readings').get().n, 1);
    } finally {
      snap.close();
    }
  });

  test('a second snapshot is skipped while a recent one exists, unless forced', () => {
    const now = new Date('2026-02-02T04:00:00Z'); // an hour after the snapshot above
    assert.equal(backup.runBackup({ now }), null, 'should skip — a fresh snapshot already exists');
    assert.ok(backup.runBackup({ force: true, now }), 'force overrides the freshness check');
  });

  test('two forced snapshots in the same second overwrite rather than throwing (VACUUM INTO wont write over an existing path)', () => {
    const now = new Date('2026-02-02T06:00:00Z');
    const first = backup.runBackup({ force: true, now });
    let second;
    assert.doesNotThrow(() => { second = backup.runBackup({ force: true, now }); });
    assert.equal(second, first, 'same second, same filename');
    assert.equal(backup.listBackups().filter((b) => b.name === first).length, 1, 'no duplicate entry');
  });

  test('a snapshot is taken once the newest one is a day old', () => {
    const name = backup.runBackup({ now: new Date('2026-02-03T05:00:00Z') });
    assert.ok(name, 'a day later, the scheduled backup should run');
  });

  test('retention prunes the oldest snapshots, keeping the newest 14', () => {
    for (let day = 1; day <= 20; day++) {
      backup.runBackup({ force: true, now: new Date(`2026-03-${String(day).padStart(2, '0')}T02:00:00Z`) });
    }
    const kept = backup.listBackups();
    assert.equal(kept.length, 14);
    // listBackups() is newest-first, so the newest kept is the last day written.
    assert.match(kept[0].name, /2026-03-20/);
    assert.ok(!kept.some((b) => /2026-02-/.test(b.name)), 'February snapshots are pruned');
  });
});

describe('/api/backups — admin-only access to snapshots', () => {
  test('a non-admin approved user cannot list, create, or download snapshots', async () => {
    const list = await fetch(`${ctx.baseUrl}/api/backups`, { headers: { Cookie: userCookie } });
    assert.equal(list.status, 403);

    const create = await fetch(`${ctx.baseUrl}/api/backups`, { method: 'POST', headers: { Cookie: userCookie } });
    assert.equal(create.status, 403);

    const name = backup.listBackups()[0].name;
    const download = await fetch(`${ctx.baseUrl}/api/backups/${name}`, { headers: { Cookie: userCookie } });
    assert.equal(download.status, 403);
  });

  test('admin lists snapshots newest first, with size and timestamp', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/backups`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.ok(rows.length > 0);
    assert.ok(rows[0].size > 0, 'a snapshot should not be zero bytes');
    assert.ok(rows[0].created_at);
    assert.deepEqual(rows.map((r) => r.name), [...rows.map((r) => r.name)].sort().reverse());
  });

  test('admin can take a snapshot on demand', async () => {
    const before = backup.listBackups().length;
    const res = await fetch(`${ctx.baseUrl}/api/backups`, { method: 'POST', headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.name);
    assert.ok(backup.listBackups().length >= before, 'the on-demand snapshot exists (retention may cap the count)');
  });

  test('admin can download a snapshot and gets the actual file bytes', async () => {
    const name = backup.listBackups()[0].name;
    const res = await fetch(`${ctx.baseUrl}/api/backups/${name}`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.length, fs.statSync(path.join(backup.backupDir(), name)).size);
    assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3', 'downloaded bytes are a real SQLite file');
  });

  test('a path-traversal filename is rejected rather than serving a file outside the backup dir', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/backups/${encodeURIComponent('../gameroom.db')}`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(res.status, 404);
  });

  test('an unknown snapshot name 404s', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/backups/gameroom-nope.db`, { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 404);
  });
});
