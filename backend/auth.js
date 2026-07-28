import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { db } from './db.js';

const COOKIE_NAME = 'grt_session';
const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

export async function verifyGoogleCredential(credential) {
  if (!googleClient) throw new Error('Google sign-in is not configured (GOOGLE_CLIENT_ID missing)');
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: config.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new Error('Google account email is not verified');
  }
  return {
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email,
    picture: payload.picture || null,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lightweight interim sign-in: trusts the client-submitted name/email with no
 * password and no external verification. This is NOT secure — it exists so
 * role/approval workflows can be exercised before real Google OAuth is wired
 * up (set AUTH_PROVIDER=google + GOOGLE_CLIENT_ID to switch, no other changes needed).
 */
export function verifyLocalCredential({ name, email }) {
  if (config.authProvider !== 'local') {
    throw new Error('Local sign-in is disabled — Google sign-in is configured');
  }
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();
  if (!EMAIL_RE.test(cleanEmail)) throw new Error('Enter a valid email address');
  if (!cleanName) throw new Error('Enter your name');
  return { email: cleanEmail, name: cleanName, picture: null };
}

/** Approved admins currently on the system — used to decide whether break-glass recovery applies. */
const adminCount = () =>
  db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'approved'").get().n;

export function findOrCreateUser({ email, name, picture }) {
  const listedAsAdmin = config.adminEmails.includes(email);
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    // ADMIN_EMAILS seeds access; it does not govern it. Re-applying it on every sign-in meant
    // demoting (or blocking) a listed address in the admin UI silently reverted the moment that
    // person logged in again — config quietly overruling a deliberate admin decision.
    //
    // The single exception is recovery: if no approved admin is left, a listed address can still
    // get back in, so a bad demotion can't lock everyone out of the system permanently.
    const rescue = listedAsAdmin && adminCount() === 0;
    db.prepare(
      `UPDATE users SET name = ?, picture = ?,
         role = CASE WHEN ? THEN 'admin' ELSE role END,
         status = CASE WHEN ? THEN 'approved' ELSE status END
       WHERE id = ?`
    ).run(name, picture, rescue ? 1 : 0, rescue ? 1 : 0, existing.id);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
  }
  const result = db.prepare(
    `INSERT INTO users (email, name, picture, role, status, approved_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    email,
    name,
    picture,
    listedAsAdmin ? 'admin' : 'user',
    listedAsAdmin ? 'approved' : 'pending',
    listedAsAdmin ? new Date().toISOString() : null
  );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

export function issueSession(res, user) {
  const token = jwt.sign({ uid: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: '30d',
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME);
}

export function publicUser(user) {
  const { id, email, name, picture, role, status } = user;
  return { id, email, name, picture, role, status };
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    clearSession(res);
    return res.status(401).json({ error: 'Session expired' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
  if (!user) {
    clearSession(res);
    return res.status(401).json({ error: 'Account not found' });
  }
  if (user.status === 'blocked') {
    return res.status(403).json({ error: 'Account blocked' });
  }
  req.user = user;
  next();
}

export function requireApproved(req, res, next) {
  if (req.user.status !== 'approved') {
    return res.status(403).json({ error: 'Account pending admin approval' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/** Gate for delete/modify routes: enforces admin-only when auth is on, passes through when it's off. */
export function adminGate(req, res, next) {
  if (!config.authEnabled) return next();
  return requireAdmin(req, res, next);
}
