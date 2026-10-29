# End-to-end tests

`backend/tests/*.test.js` imports the Express app into the test process. These spawn
`node backend/server.js` the way Azure does and talk to it over HTTP, which covers the seams
the in-process tests cannot: startup, config read from the environment, SQLite on a real
directory, and the built frontend being served.

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r e2e/requirements.txt
npm run build          # optional; covers the app shell being served
cd e2e && pytest -v
```

Each test file gets its own server, port and empty data directory, so one file's sheets and
users can never explain another file's result. Nothing here touches `data/` in the repo.

## Against a deployed site

`test_production_smoke.py` is read-only and skipped unless `E2E_BASE_URL` is set. It runs in
CI after a deploy:

```bash
E2E_BASE_URL=https://whathappened.azurewebsites.net pytest -m production
```
