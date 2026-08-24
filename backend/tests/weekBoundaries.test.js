import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// profitSplit.js transitively imports db.js, which opens a real SQLite file at
// config.dataDir on module load — point it at a throwaway temp dir first so this
// pure-function test never touches the real dev database.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameroom-unit-test-'));
process.env.DATA_DIR = tempDir;
process.env.JWT_SECRET = 'test-only-secret';

const { mondayOf, CLOSE_OUT_DATE, FIRST_WEEK_START } = await import('../routes/profitSplit.js');
const { db } = await import('../db.js');

after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('mondayOf — Monday–Sunday weeks', () => {
  const cases = [
    ['2026-08-24', '2026-08-24', 'Monday is its own week start'],
    ['2026-08-25', '2026-08-24', 'Tuesday'],
    ['2026-08-30', '2026-08-24', 'Sunday closes the week that began six days earlier'],
    ['2026-08-31', '2026-08-31', 'the next Monday starts a new week'],
    ['2026-08-23', '2026-08-17', 'the close-out Sunday belongs to the week before'],
    ['2027-01-03', '2026-12-28', 'a week spanning the year end'],
    ['2026-03-01', '2026-02-23', 'a week spanning a month end'],
    ['2028-02-29', '2028-02-28', 'a leap day'],
  ];
  for (const [date, expected, why] of cases) {
    test(`${date} → ${expected} (${why})`, () => assert.equal(mondayOf(date), expected));
  }

  test('every day of one week maps to the same Monday', () => {
    const days = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'];
    assert.deepEqual(days.map(mondayOf), days.map(() => '2026-08-24'));
  });

  test('the close-out is the Sunday immediately before the first weekly period', () => {
    assert.equal(CLOSE_OUT_DATE, '2026-08-23');
    assert.equal(FIRST_WEEK_START, '2026-08-24');
    assert.equal(mondayOf(FIRST_WEEK_START), FIRST_WEEK_START, 'the first period starts on a Monday');
  });
});
