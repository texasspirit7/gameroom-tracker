import { db } from '../db.js';
import { normalizeMachines } from './claudeExtract.js';

const near = (a, b, tol = 1) => Math.abs((a ?? 0) - (b ?? 0)) <= tol;

/**
 * Validate an extracted sheet against its own totals and against the
 * previous sheet's meters. Returns { warnings: [] }.
 */
export function validateSheet({ sheetDate, machines, totals, excludeSheetId }) {
  const warnings = [];
  const rows = normalizeMachines(machines);

  const sumIn = rows.reduce((s, m) => s + (Number(m.daily_in) || 0), 0);
  const sumOut = rows.reduce((s, m) => s + (Number(m.daily_out) || 0), 0);

  if (totals?.total_in != null && !near(sumIn, totals.total_in)) {
    warnings.push(
      `Machine Daily In sums to ${sumIn.toLocaleString()} but sheet Total In is ${Number(totals.total_in).toLocaleString()}`
    );
  }
  if (totals?.total_out != null && !near(sumOut, totals.total_out)) {
    warnings.push(
      `Machine Daily Out sums to ${sumOut.toLocaleString()} but sheet Total Out is ${Number(totals.total_out).toLocaleString()}`
    );
  }

  for (const m of rows) {
    const dIn = (Number(m.curr_in) || 0) - (Number(m.prev_in) || 0);
    const dOut = (Number(m.curr_out) || 0) - (Number(m.prev_out) || 0);
    if (m.curr_in != null && m.prev_in != null && !near(dIn, m.daily_in)) {
      warnings.push(`Machine ${m.machine_number}: Current In − Previous In = ${dIn}, but Daily In reads ${m.daily_in}`);
    }
    if (m.curr_out != null && m.prev_out != null && !near(dOut, m.daily_out)) {
      warnings.push(`Machine ${m.machine_number}: Current Out − Previous Out = ${dOut}, but Daily Out reads ${m.daily_out}`);
    }
  }

  // Meter continuity vs the most recently uploaded sheet before this one.
  // Uses upload order (id), not sheet_date — meters are a running physical
  // count, so "previous" means the last reading taken, which matters even
  // when two sheets share a date (e.g. separate shifts).
  if (sheetDate) {
    const prevSheet = excludeSheetId
      ? db.prepare('SELECT id, sheet_date FROM sheets WHERE id < ? ORDER BY id DESC LIMIT 1').get(excludeSheetId)
      : db.prepare('SELECT id, sheet_date FROM sheets ORDER BY id DESC LIMIT 1').get();
    if (prevSheet) {
      const prevReadings = db
        .prepare('SELECT machine_number, curr_in, curr_out FROM machine_readings WHERE sheet_id = ?')
        .all(prevSheet.id);
      const prevByNum = new Map(prevReadings.map((r) => [r.machine_number, r]));
      for (const m of rows) {
        const prev = prevByNum.get(Number(m.machine_number));
        if (!prev) continue;
        if (!near(prev.curr_in, m.prev_in)) {
          warnings.push(
            `Machine ${m.machine_number}: Previous In (${m.prev_in}) doesn't match Current In (${prev.curr_in}) from ${prevSheet.sheet_date} — possible missed day or misread`
          );
        }
        if (!near(prev.curr_out, m.prev_out)) {
          warnings.push(
            `Machine ${m.machine_number}: Previous Out (${m.prev_out}) doesn't match Current Out (${prev.curr_out}) from ${prevSheet.sheet_date}`
          );
        }
      }
    }
  }

  return { warnings };
}

/** meter profit = (total_in + loan_rtn) − (total_out + match) — no expenses */
export function computeMeterProfit({ totals, settlement }) {
  const totalIn = Number(totals?.total_in) || 0;
  const totalOut = Number(totals?.total_out) || 0;
  const loanRtn = Number(settlement?.loan_rtn) || 0;
  const match = Number(settlement?.match_amount) || 0;
  return totalIn + loanRtn - (totalOut + match);
}
