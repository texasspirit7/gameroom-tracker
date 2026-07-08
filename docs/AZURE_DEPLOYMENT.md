# Deploying to Azure with Google Sign-In

This walks through hosting the Game Room Tracker on Azure App Service so it's
reachable from anywhere, secured with real Google sign-in and admin approval.

The app is already built for this: it reads `PORT` from the environment, serves
the built frontend from one Node process, refuses to boot in production without
a real `JWT_SECRET`, and the Google sign-in button is wired up on the frontend —
switching from local dev sign-in to Google is just setting `GOOGLE_CLIENT_ID`.

## Part 1 — Create the Google OAuth client (one-time)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project (or use an existing one).
2. **APIs & Services → OAuth consent screen**
   - User type: External
   - Add your email as the app support/developer contact
   - Scopes: the defaults (`email`, `profile`, `openid`) are enough
   - You can leave it in "Testing" mode and add the Gmail addresses of everyone
     who'll use the tracker as test users, or publish it — either works for a
     small private tool like this.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `Game Room Tracker`
   - Leave Authorized JavaScript origins empty for now — you'll add the real
     Azure URL in Part 2 once you know it.
4. Copy the generated **Client ID** (looks like `xxxxx.apps.googleusercontent.com`).
   You don't need the client secret — sign-in verification happens with just the ID.

## Part 2 — Create the Azure resources

Requires the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) and `az login` first.

```bash
# pick a globally-unique app name — this becomes <name>.azurewebsites.net
APP_NAME=la-pryor-tracker
RESOURCE_GROUP=gameroom-rg
LOCATION=eastus

az group create --name $RESOURCE_GROUP --location $LOCATION

az appservice plan create \
  --name gameroom-plan \
  --resource-group $RESOURCE_GROUP \
  --sku B1 \
  --is-linux

az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan gameroom-plan \
  --name $APP_NAME \
  --runtime "NODE:22-lts"
```

Use the **B1** tier or higher — the Free (F1) tier sleeps after 20 minutes of
inactivity, which defeats "accessible from anywhere, anytime." B1 runs
~$13/month and supports **Always On**, which you should enable next:

```bash
az webapp config set --resource-group $RESOURCE_GROUP --name $APP_NAME --always-on true
```

Your site's URL is now `https://$APP_NAME.azurewebsites.net`. Go back to the
Google Cloud Console → your OAuth client → **Authorized JavaScript origins**
and add that exact URL.

## Part 3 — Persistent storage for the database

App Service's `/home` directory is backed by Azure Files and survives restarts
and redeploys (unlike the rest of the container filesystem, which is wiped on
every deploy). Point the app's SQLite database and uploaded files there:

```bash
az webapp config appsettings set --resource-group $RESOURCE_GROUP --name $APP_NAME --settings \
  DATA_DIR=/home/data
```

This is a single-instance setup (no horizontal scale-out) — correct for one
game room's worth of traffic, and it's what SQLite expects.

## Part 4 — App settings (environment variables)

Generate a real secret first:

```bash
JWT_SECRET=$(openssl rand -hex 32)
```

Then set everything in one call:

```bash
az webapp config appsettings set --resource-group $RESOURCE_GROUP --name $APP_NAME --settings \
  NODE_ENV=production \
  AUTH_ENABLED=true \
  GOOGLE_CLIENT_ID="<client-id-from-part-1>" \
  ADMIN_EMAILS="ppudot1@gmail.com" \
  JWT_SECRET="$JWT_SECRET" \
  ANTHROPIC_API_KEY="<your-anthropic-key-if-using-photo-uploads>" \
  CLAUDE_MODEL=claude-sonnet-5 \
  DATA_DIR=/home/data \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false
```

Notes:
- Setting `GOOGLE_CLIENT_ID` automatically switches `AUTH_PROVIDER` to `google`
  (see `backend/config.js`) — the local name/email form disappears and the
  real "Sign in with Google" button takes over.
- **Don't set `PORT`** — Azure injects its own and the app already reads
  `process.env.PORT`, so overriding it will break routing.
- `SCM_DO_BUILD_DURING_DEPLOYMENT=false` because the GitHub Action below
  builds everything before upload — Azure's Oryx builder doesn't need to (and
  wouldn't know how to) build this multi-folder repo on its own.

Set the startup command so the platform runs the right entry point:

```bash
az webapp config set --resource-group $RESOURCE_GROUP --name $APP_NAME \
  --startup-file "node backend/server.js"
```

## Part 5 — Deploy via GitHub Actions

1. Push this repo to GitHub if you haven't already:
   ```bash
   git remote add origin https://github.com/<you>/gameroom-tracker.git
   git push -u origin main
   ```
2. Get a publish profile and add it as a GitHub secret:
   ```bash
   az webapp deployment list-publishing-profiles \
     --resource-group $RESOURCE_GROUP --name $APP_NAME --xml > publish-profile.xml
   ```
   Copy the file's contents into a new GitHub repo secret named
   `AZURE_WEBAPP_PUBLISH_PROFILE` (Settings → Secrets and variables → Actions).
   Delete `publish-profile.xml` locally afterward — it's a credential.
3. Add this workflow file at `.github/workflows/deploy.yml`:

   ```yaml
   name: Deploy to Azure
   on:
     push:
       branches: [main]
   jobs:
     build-and-deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: '22'
         - run: npm run install:all
         - run: npm run build
         - run: npm install --omit=dev --prefix backend
         - name: Assemble deploy package
           run: |
             mkdir -p deploy/backend deploy/frontend
             cp -r backend/* deploy/backend/
             cp -r frontend/dist deploy/frontend/dist
         - uses: azure/webapps-deploy@v3
           with:
             app-name: la-pryor-tracker
             publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
             package: deploy
   ```

   Replace `app-name` with your actual `$APP_NAME`. This builds the frontend,
   installs only backend production dependencies, assembles a `deploy/` folder
   shaped exactly like the app expects (`deploy/backend/server.js` +
   `deploy/frontend/dist/`), and ships it — no Oryx build guesswork on Azure's side.

4. Push to `main` — the workflow runs automatically and deploys.

## Part 6 — First login and admin bootstrap

1. Visit `https://<your-app-name>.azurewebsites.net`.
2. Click **Sign in with Google** and use the Gmail address you put in
   `ADMIN_EMAILS`. That account is auto-approved as admin on first sign-in —
   no manual approval step needed for yourself.
3. Anyone else who signs in lands in **pending** status. Go to
   **Admin — Users** to approve them (or block them). Any signed-in approved
   user can view that page; only admins get the action buttons.

## Part 7 — Ongoing operations

- **Redeploy**: every push to `main` redeploys automatically.
- **Logs**: `az webapp log tail --resource-group $RESOURCE_GROUP --name $APP_NAME`
- **Back up the database**: the source of truth is `/home/data/gameroom.db`.
  Download it periodically via the Kudu/SCM site
  (`https://<app-name>.scm.azurewebsites.net/DebugConsole`) or enable App
  Service's built-in backup feature (available on B1+, configurable in the
  Portal under **Backups**).
- **Add a custom domain / HTTPS**: App Service gives you a free
  `*.azurewebsites.net` HTTPS endpoint immediately; adding your own domain is
  a separate step under **Custom domains** in the Portal if you want one later.
