# CLAUDE.md

Guidance for Claude Code when working in this repository.

## This is a LIVE PRODUCTION app

`https://la-pryor.azurewebsites.net` — a real game room's daily reconciliation tracker, actively used.
**Always run the regression suite before and after every change. Never skip this.**

```bash
npm test
```

24+ tests (`backend/tests/*.test.js`, Node's built-in `node:test` + `node:assert`, no extra deps) boot the
**real** Express app (`backend/app.js`) on an ephemeral port against an isolated temp `DATA_DIR`, and hit the
actual HTTP routes — not a reimplementation that can drift from production code.

Every test in this suite exists because something broke in production first:
- `rows.reduce is not a function` — Claude vision extraction returned `machines` as an object, not an array.
- `UNIQUE constraint failed: machine_readings.sheet_id, machine_readings.machine_number` — a duplicate
  machine number in the extracted data crashed the initial insert (the PATCH route already upserted; the
  initial upload insert didn't).
- `over_short` silently wiped to `null` on unrelated sheet edits.
- The "FD" (Family Dollar) expense row was mislabeled "food".

**When you fix a bug, add a regression test for it in the same commit — that's how this list grows.**

## Deploy loop

1. `npm test` — must pass.
2. Commit + push to `main` → GitHub Actions (`.github/workflows/deploy.yml`) builds + deploys via OIDC.
3. `az webapp restart --resource-group gameroom-rg --name la-pryor` — first-boot health polling after deploy
   has been flaky before; a restart + manual health check is the reliable way to confirm.
4. `curl https://la-pryor.azurewebsites.net/api/health` → expect `{"ok":true,...}`.
5. For frontend changes, also verify the actual deployed bundle contains the change
   (`curl` the `/assets/index-*.js` referenced by the homepage and `grep` for a distinctive string) —
   a green deploy + healthy server does not by itself prove the feature is live.

## Local dev

- Repo: `/Users/praveenpudota/Desktop/Praveen/Texas/gameroom-tracker-code` (this one — not the sibling
  `gameroom-tracker/` reference copy).
- `npm run install:all` then `npm start` (or `node backend/server.js`) — fixed port 3003.
- SQLite at `data/gameroom.db`; uploaded files at `data/uploads/`. Never commit test/scratch data into these —
  clean up anything created while manually verifying a feature.
