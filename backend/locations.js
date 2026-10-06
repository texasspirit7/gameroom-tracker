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
  },
  h: {
    key: 'h',
    label: 'What happened in H',
    name: 'Houston',
    dbFile: 'h.db',
    split: { a: 0.5, b: 0.5 },
    // No history to close out — H starts from its first sheet.
    closeOut: null,
    runningTarget: 175000,
  },
};

export const LOCATION_KEYS = Object.keys(LOCATIONS);
export const DEFAULT_LOCATION = 'la';

export const isLocation = (key) => Object.hasOwn(LOCATIONS, key);
export const locationOf = (key) => LOCATIONS[key] ?? null;

/** What the sign-in screen needs: no database paths or financial terms. */
export const publicLocations = () =>
  LOCATION_KEYS.map((k) => ({ key: k, label: LOCATIONS[k].label }));
