import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { sheetsRouter } from './routes/sheets.js';
import { dashboardRouter, machinesRouter } from './routes/dashboard.js';
import { expensesRouter } from './routes/expenses.js';
import { profitSplitRouter, seedCloseOutReceipt } from './routes/profitSplit.js';
import { investmentRouter, seedInvestmentBudget } from './routes/investment.js';
import { LOCATION_KEYS, locationOf, DEFAULT_LOCATION } from './locations.js';
import { getDb } from './db.js';
import { analyticsRouter } from './routes/analytics.js';
import { authRouter, adminRouter } from './routes/auth.js';
import { auditRouter } from './routes/audit.js';
import { exportRouter } from './routes/export.js';
import { backupsRouter } from './routes/backups.js';
import { requireAuth, requireApproved } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Builds the configured Express app (no listening) — shared by server.js and tests. */
// Opens every location's database at boot — creating the file and schema for any that don't
// exist yet — and seeds the close-out payment for those that have one, so the settled history
// has a real receipt behind it rather than a figure hard-coded into the page.
for (const key of LOCATION_KEYS) {
  const db = getDb(key);
  seedCloseOutReceipt(db, locationOf(key));
  seedInvestmentBudget(db, locationOf(key));
}

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      authEnabled: config.authEnabled,
      imageExtraction: Boolean(config.anthropicApiKey),
    });
  });

  // Auth routes are always mounted (harmless when auth is off);
  // enforcement middleware is applied only when AUTH_ENABLED=true.
  app.use('/api/auth', authRouter);
  if (config.authEnabled) {
    app.use('/api/admin', adminRouter);
    app.use('/api', (req, res, next) => {
      if (req.path.startsWith('/auth') || req.path === '/health') return next();
      requireAuth(req, res, () => requireApproved(req, res, next));
    });
  } else {
    // No session means no location on the request — dev runs against the default one.
    app.use('/api', (req, res, next) => {
      req.location = DEFAULT_LOCATION;
      req.db = getDb(DEFAULT_LOCATION);
      next();
    });
    console.warn('[server] AUTH DISABLED — running open for local testing (set AUTH_ENABLED=true to enforce sign-in)');
  }

  app.use('/api/sheets', sheetsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/machines', machinesRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/profit-split', profitSplitRouter);
  app.use('/api/investment', investmentRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/export', exportRouter);
  app.use('/api/backups', backupsRouter);

  // Serve built frontend when it exists (production / local single-server mode)
  const dist = path.join(__dirname, '..', 'frontend', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, req, res, next) => {
    console.error('[server]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
