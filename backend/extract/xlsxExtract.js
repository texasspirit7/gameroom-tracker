import xlsx from 'xlsx';

const EXPENSE_LABELS = [
  'pay', 'fd', 'coke', 'grass', 'cleaning', 'sams', 'walmart', 'misc expense',
  'loan', 'rent', 'bonus', 'drawing', 'credit', 'referral',
];
const LABEL_TO_CATEGORY = { 'misc expense': 'misc', fd: 'family dollar' };

const num = (v) => {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[$,()\s]/g, ''));
  if (Number.isNaN(n)) return 0;
  return /\(.*\)/.test(String(v)) ? -n : n;
};

/**
 * Parse the daily sheet layout from an .xlsx buffer.
 * Finds the machine meter table by its header row, then scans the
 * settlement/bank boxes below it by label.
 */
export function extractFromXlsx(buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  // Locate header row: contains "Previous In" and "Current In"
  const headerIdx = grid.findIndex(
    (row) =>
      row?.some((c) => String(c).trim().toLowerCase() === 'previous in') &&
      row?.some((c) => String(c).trim().toLowerCase() === 'current in')
  );
  if (headerIdx === -1) throw new Error('Could not find machine table header (Previous In / Current In) in the spreadsheet');

  const header = grid[headerIdx].map((c) => String(c ?? '').trim().toLowerCase());
  const col = (label) => header.indexOf(label);
  const cols = {
    num: col('#'),
    prevIn: col('previous in'),
    currIn: col('current in'),
    dailyIn: col('daily in'),
    prevOut: col('previous out'),
    currOut: col('current out'),
    dailyOut: col('daily out'),
  };

  const machines = [];
  let i = headerIdx + 1;
  for (; i < grid.length; i++) {
    const row = grid[i] || [];
    const first = String(row[cols.num] ?? '').trim().toLowerCase();
    if (first === 'total') break;
    const machineNumber = Number(first);
    if (!machineNumber) continue;
    machines.push({
      machine_number: machineNumber,
      prev_in: num(row[cols.prevIn]),
      curr_in: num(row[cols.currIn]),
      daily_in: num(row[cols.dailyIn]),
      prev_out: num(row[cols.prevOut]),
      curr_out: num(row[cols.currOut]),
      daily_out: num(row[cols.dailyOut]),
    });
  }

  // Scan remaining rows for labeled values (label cell → first numeric cell to its right)
  const labelValue = (label) => {
    for (let r = i; r < grid.length; r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (String(row[c] ?? '').trim().toLowerCase() === label) {
          for (let cc = c + 1; cc < Math.min(row.length, c + 4); cc++) {
            const v = row[cc];
            if (v != null && v !== '' && v !== '$' && !Number.isNaN(num(v))) {
              if (String(v).trim() === '-') return 0;
              return num(v);
            }
          }
        }
      }
    }
    return null;
  };

  const expenses = [];
  for (const label of EXPENSE_LABELS) {
    const v = labelValue(label);
    if (v) expenses.push({ category: LABEL_TO_CATEGORY[label] || label, amount: v });
  }
  // "name" rows under Pay hold payroll amounts
  const payFromNames = (() => {
    let sum = 0;
    for (let r = i; r < grid.length; r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (String(row[c] ?? '').trim().toLowerCase() === 'name') {
          for (let cc = c + 1; cc < Math.min(row.length, c + 4); cc++) {
            if (row[cc] != null && row[cc] !== '' && row[cc] !== '$') { sum += num(row[cc]); break; }
          }
        }
      }
    }
    return sum;
  })();
  if (payFromNames) expenses.push({ category: 'pay', amount: payFromNames });

  return {
    machines,
    totals: {
      total_in: labelValue('total in'),
      total_out: labelValue('total out'),
    },
    settlement: {
      match_amount: labelValue('match') || 0,
      loan_rtn: labelValue('loan rtn') || 0,
    },
    bank: {
      start_bank: labelValue('opening'),
      meter_profit: labelValue('profit (loss)'),
      over_short: labelValue('short/over'),
      end_bank: labelValue('new bank'),
    },
    expenses,
  };
}
