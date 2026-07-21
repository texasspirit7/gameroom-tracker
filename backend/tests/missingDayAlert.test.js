import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// dashboard.js transitively imports db.js, which opens a real SQLite file at
// config.dataDir on module load — point it at a throwaway temp dir first so
// this pure-function test never touches the real dev database.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameroom-unit-test-'));
process.env.DATA_DIR = tempDir;
process.env.JWT_SECRET = 'test-only-secret';

const { missingDayAlert } = await import('../routes/dashboard.js');
const { db } = await import('../db.js');

after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe('missingDayAlert (Dashboard: flag a gap in daily uploads)', () => {
  test('no sheets ever uploaded — no alert (nothing to compare against)', () => {
    assert.equal(missingDayAlert(null), null);
  });

  test('latest upload was today — no alert', () => {
    assert.equal(missingDayAlert(daysAgo(0)), null);
  });

  test('a 1-day gap is still within tolerance — no alert', () => {
    assert.equal(missingDayAlert(daysAgo(1)), null);
  });

  test('a 2-day gap crosses the threshold — medium alert naming the exact gap', () => {
    const alert = missingDayAlert(daysAgo(2));
    assert.ok(alert);
    assert.equal(alert.level, 'medium');
    assert.match(alert.message, /No sheet uploaded in 2 days/);
  });

  test('a 6-day gap is still medium', () => {
    assert.equal(missingDayAlert(daysAgo(6)).level, 'medium');
  });

  test('a 7-day-or-more gap escalates to high', () => {
    assert.equal(missingDayAlert(daysAgo(7)).level, 'high');
    assert.equal(missingDayAlert(daysAgo(30)).level, 'high');
  });
});
