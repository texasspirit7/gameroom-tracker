import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { sheetsRouter } from './routes/sheets.js';
import { dashboardRouter, machinesRouter } from './routes/dashboard.js';
import { expensesRouter } from './routes/expenses.js';
import { profitSplitRouter } from './routes/profitSplit.js';
import { authRouter, adminRouter } from './routes/auth.js';
import { requireAuth, requireApproved } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Builds the configured Express app (no listening) — shared by server.js and tests. */
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
    console.warn('[server] AUTH DISABLED — running open for local testing (set AUTH_ENABLED=true to enforce sign-in)');
  }

  app.use('/api/sheets', sheetsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/machines', machinesRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/profit-split', profitSplitRouter);

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
