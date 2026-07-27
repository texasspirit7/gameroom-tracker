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
    assert.deepEqual(r, { date: '2026-05-10', source: 'manual' });
  });

  test('a malformed provided date is ignored, falling through to the extracted date', () => {
    const r = resolveSheetDate({ providedDate: 'not-a-date', extractedDate: '2026-05-01', lastSheetDate: null, today: '2026-06-01' });
    assert.deepEqual(r, { date: '2026-05-01', source: 'extracted' });
  });

  test('the date auto-extracted from the sheet wins when nothing was typed in', () => {
    const r = resolveSheetDate({ providedDate: undefined, extractedDate: '2026-05-01', lastSheetDate: '2026-04-01', today: '2026-06-01' });
    assert.deepEqual(r, { date: '2026-05-01', source: 'extracted' });
  });

  test('with nothing else available, guesses the day after the last sheet on record — not today', () => {
    const r = resolveSheetDate({ providedDate: undefined, extractedDate: null, lastSheetDate: '2026-07-22', today: '2026-07-24' });
    assert.deepEqual(r, { date: '2026-07-23', source: 'guessed' });
  });

  test('guessing across a month boundary', () => {
    const r = resolveSheetDate({ providedDate: null, extractedDate: null, lastSheetDate: '2026-07-31', today: '2026-08-05' });
    assert.equal(r.date, '2026-08-01');
    assert.equal(r.source, 'guessed');
  });

  test('with no prior sheets and nothing else available, falls back to today as a last resort', () => {
    const r = resolveSheetDate({ providedDate: null, extractedDate: null, lastSheetDate: null, today: '2026-06-01' });
    assert.deepEqual(r, { date: '2026-06-01', source: 'guessed' });
  });
});

describe('resolveSheetDate — bounds-checking an auto-extracted date (a well-formed date can still be a misread)', () => {
  test('an extracted date far in the future is rejected and replaced by the guess', () => {
    const r = resolveSheetDate({ extractedDate: '2027-06-01', lastSheetDate: '2026-06-10', today: '2026-06-11' });
    assert.equal(r.source, 'guessed');
    assert.equal(r.date, '2026-06-11'); // day after the last sheet
    assert.equal(r.rejectedDate, '2027-06-01');
  });

  test('an extracted date far in the past is KEPT but flagged — discarding a date printed on the sheet would repeat the bug this guards against', () => {
    const r = resolveSheetDate({ extractedDate: '2025-06-01', lastSheetDate: '2026-06-10', today: '2026-06-11' });
    assert.equal(r.date, '2025-06-01', 'the date read off the document is preserved');
    assert.equal(r.source, 'extracted');
    assert.equal(r.suspiciouslyOld, 375);
    assert.equal(r.rejectedDate, undefined);
  });

  test('a normal recent extracted date carries no suspicion flag', () => {
    const r = resolveSheetDate({ extractedDate: '2026-06-10', lastSheetDate: null, today: '2026-06-11' });
    assert.equal(r.suspiciouslyOld, undefined);
  });

  test('tomorrow is still accepted — a timezone edge, not a misread', () => {
    const r = resolveSheetDate({ extractedDate: '2026-06-12', lastSheetDate: null, today: '2026-06-11' });
    assert.deepEqual(r, { date: '2026-06-12', source: 'extracted' });
  });

  test('a date inside the 60-day backfill window is accepted', () => {
    const r = resolveSheetDate({ extractedDate: '2026-05-20', lastSheetDate: null, today: '2026-06-11' });
    assert.deepEqual(r, { date: '2026-05-20', source: 'extracted' });
  });

  test('a manually-typed date is never bounds-checked — backfilling old sheets is legitimate', () => {
    const r = resolveSheetDate({ providedDate: '2024-01-15', extractedDate: null, lastSheetDate: '2026-06-10', today: '2026-06-11' });
    assert.deepEqual(r, { date: '2024-01-15', source: 'manual' });
  });
});
