import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Boots the REAL Express app (backend/app.js) on an ephemeral port against an
 * isolated temp DATA_DIR, so tests exercise production code paths end-to-end
 * instead of a re-implementation that can drift from the real routes.
 */
export async function startTestServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameroom-test-'));
  process.env.DATA_DIR = tempDir;
  process.env.AUTH_ENABLED = 'true';
  process.env.AUTH_PROVIDER = 'local';
  process.env.GOOGLE_CLIENT_ID = '';
  process.env.ANTHROPIC_API_KEY = '';
  process.env.ADMIN_EMAILS = 'admin@test.local';
  process.env.JWT_SECRET = 'test-only-secret';
  process.env.NODE_ENV = 'test';

  const { createApp } = await import('../../app.js');
  const { db } = await import('../../db.js');
  const app = createApp();

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    db,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

/** Signs in (auto-approved admin, since ADMIN_EMAILS matches) and returns the session cookie header. */
export async function signInAsAdmin(baseUrl) {
  const res = await fetch(`${baseUrl}/api/auth/local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Admin', email: 'admin@test.local' }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Sign-in did not return a session cookie');
  return cookie;
}

/**
 * Signs in a non-admin user, then approves them using an admin session so the
 * account is 'approved' (not 'pending') — for testing the admin-only
 * *authorization* boundary specifically, not the separate approval gate.
 */
export async function signInAsApprovedUser(baseUrl, adminCookie, email = 'user@test.local') {
  const signInRes = await fetch(`${baseUrl}/api/auth/local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email }),
  });
  const cookie = signInRes.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Sign-in did not return a session cookie');
  const { user } = await signInRes.json();

  await fetch(`${baseUrl}/api/admin/users/${user.id}/approve`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });

  return cookie;
}
