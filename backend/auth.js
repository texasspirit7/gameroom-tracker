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

export function findOrCreateUser({ email, name, picture }) {
  const isAdmin = config.adminEmails.includes(email);
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    // Keep profile fresh; promote to admin if added to ADMIN_EMAILS later
    db.prepare(
      `UPDATE users SET name = ?, picture = ?,
         role = CASE WHEN ? THEN 'admin' ELSE role END,
         status = CASE WHEN ? THEN 'approved' ELSE status END
       WHERE id = ?`
    ).run(name, picture, isAdmin ? 1 : 0, isAdmin ? 1 : 0, existing.id);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
  }
  const result = db.prepare(
    `INSERT INTO users (email, name, picture, role, status, approved_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    email,
    name,
    picture,
    isAdmin ? 'admin' : 'user',
    isAdmin ? 'approved' : 'pending',
    isAdmin ? new Date().toISOString() : null
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
