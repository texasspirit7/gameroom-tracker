/**
 * Released-to-date, in its own module with no imports.
 *
 * Both the investment page and the profit split need it — the split measures recovery against
 * what was actually released — and keeping it here means neither has to import the other.
 */
export const releasedTotal = (db) =>
  Math.round(db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM investment_disbursements').get().t * 100) / 100;
