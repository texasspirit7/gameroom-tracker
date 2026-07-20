import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// validate.js/claudeExtract.js transitively import db.js, which opens a real
// SQLite file at config.dataDir on module load — point it at a throwaway temp
// dir first so these "pure" unit tests never touch the real dev database.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameroom-unit-test-'));
process.env.DATA_DIR = tempDir;
process.env.JWT_SECRET = 'test-only-secret';

const { validateSheet, computeMeterProfit } = await import('../extract/validate.js');
const { normalizeMachines, normalizeExpenses, normalizeSheetDate } = await import('../extract/claudeExtract.js');
const { db } = await import('../db.js');

after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('normalizeMachines (regression: production "rows.reduce is not a function" crash)', () => {
  test('object-shaped machines (keyed by index) is coerced to an array', () => {
    const objShaped = { 0: { machine_number: 1 }, 1: { machine_number: 2 } };
    const result = normalizeMachines(objShaped);
    assert.equal(Array.isArray(result), true);
    assert.equal(result.length, 2);
  });

  test('array input passes through unchanged', () => {
    const arr = [{ machine_number: 1 }];
    assert.deepEqual(normalizeMachines(arr), arr);
  });

  test('null/undefined becomes an empty array', () => {
    assert.deepEqual(normalizeMachines(null), []);
    assert.deepEqual(normalizeMachines(undefined), []);
  });
});

describe('normalizeExpenses (regression: "name" and "pay" shown as two separate expense categories)', () => {
  test('a "name" category is remapped to "pay"', () => {
    const result = normalizeExpenses([{ category: 'name', amount: 300 }]);
    assert.deepEqual(result, [{ category: 'pay', amount: 300 }]);
  });

  test('is case/whitespace-insensitive', () => {
    const result = normalizeExpenses([{ category: '  Name ', amount: 300 }]);
    assert.equal(result[0].category, 'pay');
  });

  test('other categories pass through unchanged', () => {
    const result = normalizeExpenses([{ category: 'pay', amount: 300 }, { category: 'cleaning', amount: 60 }]);
    assert.deepEqual(result, [{ category: 'pay', amount: 300 }, { category: 'cleaning', amount: 60 }]);
  });

  test('non-array input becomes an empty array', () => {
    assert.deepEqual(normalizeExpenses(null), []);
    assert.deepEqual(normalizeExpenses(undefined), []);
  });
});

describe('normalizeSheetDate (auto-detected date from Claude vision — never trust the LLM string verbatim)', () => {
  test('a well-formed YYYY-MM-DD string passes through', () => {
    assert.equal(normalizeSheetDate('2026-07-06'), '2026-07-06');
  });

  test('malformed strings (wrong format, MM/DD/YYYY, garbage) become null', () => {
    assert.equal(normalizeSheetDate('07/06/2026'), null);
    assert.equal(normalizeSheetDate('not a date'), null);
    assert.equal(normalizeSheetDate('2026-7-6'), null);
  });

  test('missing/non-string input becomes null', () => {
    assert.equal(normalizeSheetDate(undefined), null);
    assert.equal(normalizeSheetDate(null), null);
    assert.equal(normalizeSheetDate(12345), null);
  });
});

describe('validateSheet (regression: must not crash on malformed machines shape)', () => {
  test('object-shaped machines does not throw, and totals still cross-check', () => {
    const objShaped = {
      0: { machine_number: 1, daily_in: 100, daily_out: 50, curr_in: 100, prev_in: 0, curr_out: 50, prev_out: 0 },
      1: { machine_number: 2, daily_in: 200, daily_out: 75, curr_in: 200, prev_in: 0, curr_out: 75, prev_out: 0 },
    };
    assert.doesNotThrow(() => {
      const { warnings } = validateSheet({ sheetDate: null, machines: objShaped, totals: { total_in: 300, total_out: 125 } });
      assert.equal(warnings.length, 0, 'sums match totals, no warnings expected');
    });
  });

  test('flags a mismatch between machine daily_in sum and the sheet total_in', () => {
    const machines = [{ machine_number: 1, daily_in: 100, daily_out: 0 }];
    const { warnings } = validateSheet({ sheetDate: null, machines, totals: { total_in: 999, total_out: 0 } });
    assert.ok(warnings.some((w) => w.includes('Daily In sums to')));
  });
});

describe('validateSheet (regression: near-empty machine table extraction must be called out clearly)', () => {
  test('a single all-zero placeholder row with real sheet totals gets an explicit "extraction likely failed" warning', () => {
    // Mirrors a real production case: Claude vision read the sheet totals/expenses
    // correctly but returned only one degenerate machine row instead of the full table.
    const machines = [{ machine_number: 0, prev_in: 0, curr_in: 0, daily_in: 0, prev_out: 0, curr_out: 0, daily_out: 0 }];
    const { warnings } = validateSheet({ sheetDate: null, machines, totals: { total_in: 4698, total_out: 1448 } });
    assert.ok(
      warnings[0].includes('Machine table extraction likely failed'),
      'the extraction-failed warning must be present and come first'
    );
  });

  test('does not fire when there is no real activity to miss (empty sheet, all zero totals)', () => {
    const { warnings } = validateSheet({ sheetDate: null, machines: [], totals: { total_in: 0, total_out: 0 } });
    assert.ok(!warnings.some((w) => w.includes('extraction likely failed')));
  });

  test('does not fire for a normal, fully-populated machine table', () => {
    const machines = [
      { machine_number: 1, daily_in: 100, daily_out: 50 },
      { machine_number: 2, daily_in: 200, daily_out: 75 },
    ];
    const { warnings } = validateSheet({ sheetDate: null, machines, totals: { total_in: 300, total_out: 125 } });
    assert.ok(!warnings.some((w) => w.includes('extraction likely failed')));
  });
});

describe('computeMeterProfit — (Total In + Loan RTN) − (Total Out + Match), no expenses subtracted', () => {
  test('basic case', () => {
    const mp = computeMeterProfit({
      totals: { total_in: 300, total_out: 125 },
      settlement: { match_amount: 0, loan_rtn: 0 },
    });
    assert.equal(mp, 175);
  });

  test('includes loan_rtn and subtracts match_amount', () => {
    const mp = computeMeterProfit({
      totals: { total_in: 2421, total_out: 1600 },
      settlement: { match_amount: 435, loan_rtn: 0 },
    });
    assert.equal(mp, 386);
  });

  test('missing/null fields default to 0 rather than throwing or producing NaN', () => {
    const mp = computeMeterProfit({ totals: {}, settlement: {} });
    assert.equal(mp, 0);
  });
});
