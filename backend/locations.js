/**
 * The locations this install serves.
 *
 * Each one gets its own SQLite file rather than a `location` column on every table. That makes
 * separation physical: a query that forgets to filter can't reach another location's money,
 * because the rows simply aren't in the file it has open. It also means each location carries
 * its own users, machines, backups and profit arrangement without any of them needing to know
 * the others exist.
 */
export const LOCATIONS = {
  la: {
    key: 'la',
    label: 'What happened in La',
    name: 'La Pryor',
    // The original single-location database, kept under its old name so the live data needs
    // no migration — it simply becomes La's.
    dbFile: 'gameroom.db',
    split: { a: 0.4, b: 0.6 },
    /**
     * Everything to this Sunday was settled in one payment and isn't recomputed. La only —
     * it's a fact about this location's history, not about how the app works.
     */
    closeOut: { date: '2026-08-23', received: 7400, firstWeek: '2026-08-24' },
    runningTarget: 80000,
    // No setup investment tracked for La — it was already running.
    investment: null,
  },
  h: {
    key: 'h',
    label: 'What happened in H',
    name: 'Houston',
    dbFile: 'h.db',
    split: { a: 0.5, b: 0.5 },
    // No history to close out — H starts from its first sheet.
    closeOut: null,
    /**
     * The target is what has actually been released, not a figure guessed up front — see
     * investment below. Left null so nothing is hard-coded; the split page derives it.
     */
    runningTarget: null,
    /**
     * Setup costs for this location, quoted 2026. Seeded once into investment_budget and
     * editable afterwards, so a misread or a changed price is corrected in the app rather
     * than here.
     *
     */
    investment: {
      quotedTotal: 174150,
      budget: [
        { line: 1, item: 'Original bally firelinks 27 (incl. 27 conversions)', qty: 14, each: 3500, amount: 49000 },
        { line: 2, item: 'SG j43', qty: 3, each: 7000, amount: 21000 },
        { line: 3, item: 'Twinstars', qty: 2, each: 3500, amount: 7000 },
        { line: 4, item: 'Aristocrat', qty: 3, each: 3500, amount: 10500 },
        { line: 5, item: 'Igt 27 cabinet', qty: 2, each: 3000, amount: 6000 },
        { line: 6, item: 'Chinese firelinks (used)', qty: 5, each: 2000, amount: 10000 },
        { line: 7, item: 'Wooden cabinets (pog, lol, texas keno)', qty: 25, each: 750, amount: 18750 },
        { line: 8, item: 'Match system', qty: 1, each: 1300, amount: 1300 },
        { line: 9, item: 'Cameras set', qty: null, each: null, amount: 4000 },
        { line: 10, item: 'Chairs', qty: 40, each: 40, amount: 1600 },
        { line: 11, item: 'Bank', qty: 1, each: 15000, amount: 15000 },
        { line: 12, item: 'Rent — 6 months upfront', qty: 6, each: 5000, amount: 30000 },
      ],
    },
  },
};

export const LOCATION_KEYS = Object.keys(LOCATIONS);
export const DEFAULT_LOCATION = 'la';

export const isLocation = (key) => Object.hasOwn(LOCATIONS, key);
export const locationOf = (key) => LOCATIONS[key] ?? null;

/** What the sign-in screen needs: no database paths or financial terms. */
export const publicLocations = () =>
  LOCATION_KEYS.map((k) => ({ key: k, label: LOCATIONS[k].label }));
