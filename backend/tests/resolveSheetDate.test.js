import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// sheets.js transitively imports db.js, which opens a real SQLite file at
// config.dataDir on module load — point it at a throwaway temp dir first so
// this pure-function test never touches the real dev database.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameroom-unit-test-'));
process.env.DATA_DIR = tempDir;
process.env.JWT_SECRET = 'test-only-secret';

const { resolveSheetDate } = await import('../routes/sheets.js');
const { db } = await import('../db.js');

after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('resolveSheetDate (regression: a sheet with no date must not silently default to "today")', () => {
  test('an explicit provided date wins over everything else', () => {
    const r = resolveSheetDate({ providedDate: '2026-05-10', extractedDate: '2026-05-01', lastSheetDate: '2026-04-01', today: '2026-06-01' });
    assert.deepEqual(r, { date: '2026-05-10', guessed: false });
  });

  test('a malformed provided date is ignored, falling through to the extracted date', () => {
    const r = resolveSheetDate({ providedDate: 'not-a-date', extractedDate: '2026-05-01', lastSheetDate: null, today: '2026-06-01' });
    assert.deepEqual(r, { date: '2026-05-01', guessed: false });
  });

  test('the date auto-extracted from the sheet wins when nothing was typed in', () => {
    const r = resolveSheetDate({ providedDate: undefined, extractedDate: '2026-05-01', lastSheetDate: '2026-04-01', today: '2026-06-01' });
    assert.deepEqual(r, { date: '2026-05-01', guessed: false });
  });

  test('with nothing else available, guesses the day after the last sheet on record — not today', () => {
    const r = resolveSheetDate({ providedDate: undefined, extractedDate: null, lastSheetDate: '2026-07-22', today: '2026-07-24' });
    assert.deepEqual(r, { date: '2026-07-23', guessed: true });
  });

  test('guessing across a month boundary', () => {
    const r = resolveSheetDate({ providedDate: null, extractedDate: null, lastSheetDate: '2026-07-31', today: '2026-08-05' });
    assert.equal(r.date, '2026-08-01');
    assert.equal(r.guessed, true);
  });

  test('with no prior sheets and nothing else available, falls back to today as a last resort', () => {
    const r = resolveSheetDate({ providedDate: null, extractedDate: null, lastSheetDate: null, today: '2026-06-01' });
    assert.deepEqual(r, { date: '2026-06-01', guessed: true });
  });
});
