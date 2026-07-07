# Game Room Tracker

Daily reconciliation-sheet tracker for the La Pryor game room. Upload the daily
sheet (Excel or a photo), the data is extracted and validated, and dashboards
show profit trends, per-machine analytics, and cash-control alerts.

## Run locally

```bash
npm run install:all     # first time — installs backend + frontend deps
npm run build           # build the frontend (served by the backend)
npm run seed            # optional: load the two sample days (05/29, 05/30)
npm start               # http://localhost:3003 (fixed port — see .env)
```

For development with hot reload run `npm run dev:backend` and `npm run dev:frontend`
in two terminals (frontend on :3000 proxies /api to :3003).

Copy `.env.example` to `.env` before first run — it sets the fixed port, the admin
email, and a JWT secret. Without it the app falls back to an insecure dev secret
and a warning in the logs.

## Uploading sheets

- **.xlsx** — parsed directly from the spreadsheet (exact, preferred).
- **Photo (.jpg/.png/.webp)** — read with Claude vision; requires `ANTHROPIC_API_KEY`
  in `.env`. Always check the Review screen after a photo upload.
- Sheets can have any number of machine rows — extraction and the Machines pages
  are row-based, not hardcoded to a fixed count.

Every upload is validated automatically:
- machine Daily In/Out must sum to the sheet's Total In/Out
- Current − Previous must equal Daily for every machine
- each machine's Previous meter must match the prior sheet's Current meter
  (catches missed days and misreads)
- one sheet per date — duplicates are rejected

**Meter profit** = `(Total In + Loan RTN) − (Total Out + Match + expenses)` — what the
machine meters say you made, from the numbers on the sheet.
**Cash profit** = what was actually counted in the bank/drawer that day.
**Over/Short** = `Cash Profit − Meter Profit` — the gap between them, and the main
fraud/error signal in the app.

## Pages

| Page | What it shows |
|---|---|
| Dashboard | Profit trend (meter vs cash vs over/short), in/out bars, expense breakdown (sheet + other), alerts (big payouts, negative hold, cash short), dead machines |
| Upload Sheet | Drag-and-drop upload with date picker — open to every approved user |
| Daily Sheets | All sheets with status, warnings, P/L, and an admin-only Delete column |
| Sheet detail | Editable meter table + summary fields (admin-only edit/verify/delete; others view read-only) |
| Machines | Per-machine leaderboard: net, hold %, active days, max payout, flags (dead/bleeding/negative) |
| Machine detail | Daily in/out/net chart, best/worst day, full meter history, prev/next bounded to the actual machine numbers present |
| Other Expenses | Recurring overhead (rent, electricity, etc.) logged separately from daily sheets; rolls into the Dashboard's expense breakdown |
| Admin — Users | Approve/block accounts, promote/demote admins (visible to admins only) |

Every data page (Dashboard, Machines, Other Expenses) shares one date-range picker
top-right: Today, Yesterday, Last 7 Days, This/Last Week, This/Last Month, Last 30
Days, Year to Date, All Time, or a custom From/To range.

## Accounts, roles & permissions

Sign-in is **on by default**. Two roles:

- **admin** — approves/blocks new users, promotes/demotes other admins, and is the
  only role that can edit, verify, or delete a sheet or an other-expense entry.
- **user** — can sign in (once approved), upload sheets, log other-expenses, and
  view everything. Cannot edit or delete.

New sign-ins land in `pending` until an admin approves them from **Admin — Users**.
Emails listed in `ADMIN_EMAILS` (`.env`) are auto-approved as admins on first sign-in.

Sign-in itself is currently **local**: a name + email form with no password and no
external verification (`AUTH_PROVIDER=local`, the default). This exists so
roles/approval can be used today, before real Google OAuth is set up. To switch to
verified Google sign-in later: create an OAuth 2.0 Web client in Google Cloud
Console, set `GOOGLE_CLIENT_ID` in `.env` (this alone flips `AUTH_PROVIDER` to
`google`) — no other code changes needed.

To turn sign-in off entirely for local testing, set `AUTH_ENABLED=false`.

## Azure hosting (later phase)

Planned: Azure App Service (Linux, Node 22), startup command `node backend/server.js`,
`DATA_DIR=/home/data` for persistent SQLite + uploads, secrets in App Service
configuration, GitHub Actions deploy. The app already serves the built frontend from
one server, reads `PORT` from the environment, and refuses to boot in production
without a real `JWT_SECRET` — no code changes needed to deploy.
