---
name: gameroom-tracker
description: Domain reference for this app — the two-location daily-sheet reconciliation site at whathappened.azurewebsites.net. Read before changing sheets/upload, the dashboard, analytics, profit split, investment, machines, expenses, users and roles, or the location registry. Covers the one-database-per-location architecture, the profit-split rules, the sign-in flow, and the mistakes that have already broken production once.
---

# Game Room Tracker

A live reconciliation tracker for two game rooms. Someone uploads the day's sheet (xlsx, or a
photo read by Claude vision), the app extracts the machine table and totals, and everything
else — dashboard, analytics, profit split, investment recovery — is derived from those sheets.

`CLAUDE.md` in the repo root owns the **process**: test discipline, the deploy loop, rollback.
Read it too; this file is the **domain**. The short version of the process, because it is not
optional: `npm test` before and after every change, a regression test in the same commit as
every bug fix, and after deploying, grep the live bundle for the change — a green pipeline is
not proof.

There are **two suites**, and both gate the deploy:

| | what it does | run it |
|---|---|---|
| `backend/tests/*.test.js` | imports the Express app in-process, hits the real routes | `npm test` |
| `e2e/` (pytest) | spawns `node backend/server.js` and drives it over HTTP | `cd e2e && pytest` |

The end-to-end suite covers what in-process tests structurally cannot: server startup, config
read from the environment, SQLite on a real directory, the built frontend being served, and the
read-only checks that run against production after a deploy (`pytest -m production`, needing
`E2E_BASE_URL`). One server per test file, each on its own port and empty data directory.

Put a test where it belongs: a formula or a route contract belongs in the node suite, which is
faster and more precise. A journey across several routes, or anything about how the process is
configured and started, belongs in `e2e/`.

## Two locations, two databases

`backend/locations.js` is the registry and the only place the two locations are described.

| | key | name (inside the app) | label (sign-in) | split | db file |
|---|---|---|---|---|---|
| | `la` | London | "What happened in La" | 40/60 | `gameroom.db` |
| | `h` | Helsinki | "What happened in H" | 50/50 | `h.db` |

Three distinct identifiers, and conflating them is the easy mistake:

- **key** (`la`, `h`) — baked into live session cookies and into the SQLite filenames on disk.
  Changing one invalidates every signed-in session and orphans a database file. Treat as frozen.
- **name** — what you see once you are inside. Safe to rename; pinned by
  `backend/tests/locationNames.test.js`.
- **label** — the sign-in wording, shown to anyone who loads the site, so it deliberately says
  less than the inside of the app does. Keep the names out of it.

Separation is **physical, not a `WHERE` clause**: each location gets its own SQLite file, so a
query that forgets to filter cannot reach the other location's money — the rows are not in the
file it has open. Each location carries its own users, machines, backups and profit arrangement.

`backend/db.js` therefore exports **`getDb(locationKey)` and no default `db`**. That is
deliberate: a call site that forgets which location it is serving throws `ReferenceError`
instead of silently reading London's data while showing Helsinki's name. Do not add a
convenience default export back.

`requireAuth` sets `req.location` and `req.db = getDb(req.location)` from the JWT. Route
handlers should use `req.db` and never reach for a module-level handle.

## Profit split

Weekly, **Monday to Sunday**. In SQL, Monday of a date's week is
`date(x, 'weekday 0', '-6 days')` — the idiom used throughout `backend/routes/profitSplit.js`.

- Each week's **owed** = that week's net profit × the location's A share.
- Payments (`profit_receipts`) go into one running pool, drawn **oldest week first** — not
  matched to the week they were paid in. Each week reports `coverage` from that.
- **Expenses** (`split_expenses`) count *toward* what has been settled, alongside payments:
  `balance = owed_total − received_total − expenses_total`.
- Recording or deleting a payment never moves the split itself — the split is derived from
  sheets, and settlement is a separate ledger.
- **London** has a close-out: everything to Sunday 2026-08-23 was settled in one $7,400
  payment and is not recomputed; weekly accounting starts 2026-08-24. Helsinki has none and
  starts from its first sheet.
- The progress bar is a **running total toward a target**. London's target is a flat $80,000.
  Helsinki's is whatever has actually been *released* against the setup investment, so it
  follows the disbursements rather than a constant — hence `runningTarget: null` there.

Editing an old daily sheet re-derives every later week. That is known and currently accepted;
amounts are not snapshotted when a week settles.

## Investment recovery — Helsinki only

Helsinki was built out against a 2026 quote (`investment.budget` in the registry, seeded once
into `investment_budget` and editable in the app afterwards, so a changed price is corrected in
the UI rather than in code). London tracks none, and `/api/investment` correctly 404s there.

Money released is recorded in `investment_disbursements`. A disbursement not itemised against a
budget line is **spread pro-rata across the lines that still need funding**, with the last
funded line absorbing the rounding remainder so the parts sum to the whole.

`backend/investmentTotals.js` exists only to hold `releasedTotal(db)`. It is a leaf module with
no imports, breaking the cycle between the investment routes and the profit-split summary that
needs the released figure for its target. Keep it that way.

## Sign-in, roles, owner

Sign-in is two-phase, because the list of locations is specific to who you are:

1. `POST /api/auth/local` or `/google` — **identify only**. Returns the name and the locations
   this address may enter; sets a 10-minute identity cookie. No session yet.
2. `POST /api/auth/enter { location }` — re-checks access, then issues the session JWT.
3. `POST /api/auth/switch { location }` — same re-check, re-issues the session. The frontend
   does a **full page reload** after switching; without it the shell showed the new location's
   name over the old location's data.

`locationsFor(email)` asks every location's database, so access is the union of where the
account is approved. Addresses in `ADMIN_EMAILS` are seeded as admins everywhere.

`OWNER_EMAIL` (default `texasspirit7@gmail.com`) is one account that cannot be deleted, blocked
or demoted **by anyone, including itself** — promotion still works. The roster returns `isOwner`
per row and the UI shows a badge instead of buttons. Note what this does *not* do: it protects
the account inside the app, not the setting. Whoever controls the Azure configuration can point
`OWNER_EMAIL` elsewhere, so the real boundary is the Azure account. The owner is also the only
account that may read the Activity trail.

When verifying owner protection, **sign in as a second admin**. From the owner's own session the
self-guards answer first (400) and the owner-protection branch is never reached (403).

## Where things live

```
backend/
  locations.js        the registry — names, splits, close-out, investment budget
  db.js               applySchema + getDb(key); no default export, on purpose
  auth.js             JWT, session shape, locationsFor, isOwnerEmail
  config.js           env → config; PORT defaults 3003, DATA_DIR defaults ./data
  investmentTotals.js leaf module: releasedTotal(db)
  routes/             auth sheets dashboard machines expenses profitSplit
                      investment analytics audit export backups range
frontend/src/
  pages/              Dashboard Sheets SheetDetail Upload Machines MachineDetail
                      Expenses ProfitSplit Investment Analytics AdminUsers Activity
  components/         LoginGate DateRangePicker GoogleSignInButton CabinetCard …
```

`machinesRouter` is exported from **`routes/dashboard.js`**, not a `machines.js`. A change to
the dashboard that forgets this takes the Machines page down in both locations — it has.

Tables: `users sheets machine_readings expenses other_expenses profit_splits profit_receipts
profit_notes investment_budget investment_disbursements split_expenses audit_log`.

Nav visibility is driven by `adminOnly` / `ownerOnly` / `investmentOnly` flags in
`frontend/src/App.jsx`.

## Conventions worth matching

- **One sheet per day.** A second upload for a date returns **409**; the way to replace one is
  delete then re-upload.
- Date ranges default to **This Week** (full Mon–Sun) on every page. Charts start at the first
  recorded data, not at an epoch.
- Analytics and the dashboard trends are **line charts** with drill-down preserved.
- "Expenses" is overloaded: the daily sheet's own overhead rows, and the separate
  `split_expenses` charged against the profit-split balance. Check which one a ticket means.

## Gotchas that have cost real time

- **Tests:** one `startTestServer()` per file. Node caches ES modules per process, so a second
  one reuses a `db.js` singleton that teardown has already closed. For the same reason, never
  import an app module at a test file's top level — it opens the database against the *real*
  data dir before `startTestServer` can redirect it.
- `node:sqlite` returns **null-prototype rows**, which strict `deepEqual` rejects. Spread them.
- **No backticks inside SQL comments** in a JS template literal. It closes the literal and you
  get `SyntaxError: missing ) after argument list` from somewhere unrelated. This has happened
  twice.
- **Recharts:** `dot`/`activeDot` must be **elements**, not render functions — the function form
  silently skips the dot layer for multi-point series. Also set `isAnimationActive={false}`, or
  the layer is withheld until the mount animation reports finished.
- **Mobile:** use `100dvh`, not `100vh` — `vh` reports the chrome-hidden height, which put the
  sidebar's sign-out button off-screen with no way to scroll to it.
- **Backups:** copying `gameroom.db` alone loses recent transactions because of WAL. Use
  `VACUUM INTO` for a consistent snapshot. Backups currently live only on the App Service
  filesystem.
- A new guard is not trusted until it has been **sabotaged and seen to fail**. Several guards
  here looked tested and were not: an orphan-file test that returned at an earlier guard before
  any file was written, and a last-admin check that `requireAdmin` made unreachable.

## Local dev

```bash
npm run install:all
npm start                 # backend on 3003, serves the built frontend
npm run dev:frontend      # Vite, when working on the UI
```

`AUTH_PROVIDER=local` gives passwordless name/email sign-in for development; production is
Google OAuth. SQLite lives in `data/`, uploads in `data/uploads/`. Clean up anything created
while manually verifying — never commit scratch sheets.
