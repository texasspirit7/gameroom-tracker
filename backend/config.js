import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root if present (no dependency needed)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT) || 3003,
  dataDir: path.resolve(__dirname, '..', process.env.DATA_DIR || './data'),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
  // Sign-in + admin approval is ON by default now.
  // authProvider 'local' = lightweight name/email sign-in (no password, no external
  // verification) — an interim stand-in so roles/approval work before Google OAuth
  // is wired up for the Azure phase. Set AUTH_PROVIDER=google + GOOGLE_CLIENT_ID later
  // to swap in real verified sign-in without touching any other code.
  authEnabled: process.env.AUTH_ENABLED !== 'false',
  authProvider: process.env.GOOGLE_CLIENT_ID ? 'google' : (process.env.AUTH_PROVIDER || 'local'),
};

if (!config.jwtSecret) {
  if (isProd) {
    throw new Error('JWT_SECRET must be set in production');
  }
  config.jwtSecret = 'dev-only-insecure-secret';
  console.warn('[config] JWT_SECRET not set — using insecure dev secret');
}

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });
