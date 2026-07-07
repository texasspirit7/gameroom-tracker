# Game Room Tracker

Daily reconciliation-sheet tracker for the La Pryor game room (40 machines).
Upload the daily sheet (Excel or a photo), the data is extracted and validated,
and dashboards show profit trends, per-machine analytics, and cash-control alerts.

## Run locally

```bash
npm run install:all     # first time — installs backend + frontend deps
npm run build           # build the frontend (served by the backend)
npm run seed            # optional: load the two sample days (05/29, 05/30)
npm start               # http://localhost:3001
```

For development with hot reload run `npm run dev:backend` and `npm run dev:frontend`
in two terminals (frontend on :3000 proxies /api to :3001).

## Uploading sheets

- **.xlsx** — parsed directly from the spreadsheet (exact, preferred).
- **Photo (.jpg/.png/.webp)** — read with Claude vision; requires `ANTHROPIC_API_KEY`
  in `.env` (copy `.env.example`). Always check the Review screen after a photo upload.

Every upload is validated automatically:
- machine Daily In/Out must sum to the sheet's Total In/Out
- Current − Previous must equal Daily for every machine
- each machine's Previous meter must match the prior sheet's Current meter
  (catches missed days and misreads)
- one sheet per date — duplicates are rejected

Meter profit is computed as `(Total In + Loan RTN) − (Total Out + Match + expenses)`,
and Over/Short as `Cash Profit − Meter Profit`.

## Pages

| Page | What it shows |
|---|---|
| Dashboard | Profit trend (meter vs cash vs over/short), in/out bars, expense breakdown, alerts (big payouts, negative hold, cash short), dead machines |
| Upload Sheet | Drag-and-drop upload with date picker |
| Daily Sheets | All sheets with status, warnings, P/L — click to open |
| Sheet detail | Editable 40-row meter table + summary fields; re-validates on save; mark verified; delete |
| Machines | Per-machine leaderboard: net, hold %, active days, max payout, flags (dead/bleeding/negative) |
| Machine detail | Daily in/out/net chart, best/worst day, full meter history |

## Authentication (scaffolded, OFF by default)

Google sign-in with admin approval is fully implemented but disabled while testing.
To enable later:

1. Create an OAuth 2.0 Web client in Google Cloud Console.
2. In `.env` set `AUTH_ENABLED=true`, `GOOGLE_CLIENT_ID=…`, `JWT_SECRET=<random>`,
   and `ADMIN_EMAILS=you@gmail.com`.
3. New Google users land in `pending` status; admins approve or block them via
   `/api/admin/users` (admin UI page to be added in the auth phase).

## Azure hosting (later phase)

Planned: Azure App Service (Linux, Node 22), startup command `node backend/server.js`,
`DATA_DIR=/home/data` for persistent SQLite + uploads, secrets in App Service
configuration, GitHub Actions deploy. The app already serves the built frontend from
one server, reads `PORT` from the environment, and refuses to boot in production
without a real `JWT_SECRET` — no code changes needed to deploy.
