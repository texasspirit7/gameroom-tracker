import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { extractFromXlsx } from '../extract/xlsxExtract.js';

/** Builds a minimal daily-sheet-shaped xlsx buffer for a given set of extra rows below the machine table. */
function buildSheet(extraRows) {
  const wb = xlsx.utils.book_new();
  const rows = [
    ['#', 'Previous In', 'Current In', 'Daily In', 'Previous Out', 'Current Out', 'Daily Out', 'Hold'],
    [1, 0, 100, 100, 0, 50, 50, '50%'],
    ['Total', '', '', 100, '', '', 50, '50%'],
    [],
    ['Total Out', '$', 50, 'Total In', '$', 100, 'Bank'],
    ...extraRows,
  ];
  const ws = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('extractFromXlsx (regression: "FD" row must be "family dollar", not "food")', () => {
  test('FD label maps to category "family dollar"', () => {
    const buf = buildSheet([['FD', '', 25]]);
    const result = extractFromXlsx(buf);
    assert.deepEqual(result.expenses, [{ category: 'family dollar', amount: 25 }]);
  });

  test('misc expense label still normalizes to "misc"', () => {
    const buf = buildSheet([['Misc Expense', '', 40]]);
    const result = extractFromXlsx(buf);
    assert.deepEqual(result.expenses, [{ category: 'misc', amount: 40 }]);
  });

  test('a literal "food" cell (not FD) is not present in the recognized label list', () => {
    const buf = buildSheet([['food', '', 999]]);
    const result = extractFromXlsx(buf);
    assert.equal(result.expenses.some((e) => e.category === 'food'), false);
  });
});

describe('extractFromXlsx — machine table + totals sanity', () => {
  test('reads machine rows and totals correctly', () => {
    const buf = buildSheet([]);
    const result = extractFromXlsx(buf);
    assert.equal(result.machines.length, 1);
    assert.equal(result.machines[0].machine_number, 1);
    assert.equal(result.machines[0].daily_in, 100);
    assert.equal(result.totals.total_in, 100);
    assert.equal(result.totals.total_out, 50);
  });

  test('throws a clear error when the machine table header is missing', () => {
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([['not', 'a', 'sheet']]);
    xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    assert.throws(() => extractFromXlsx(buf), /Could not find machine table header/);
  });
});
