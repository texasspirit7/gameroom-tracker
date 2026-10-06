import { Router } from 'express';
import { config } from '../config.js';
import {
  verifyGoogleCredential, verifyLocalCredential, findOrCreateUser, issueSession, clearSession,
  publicUser, requireAuth, requireApproved, requireAdmin,
  locationsFor, hasPendingAnywhere, issueIdentity, readIdentity, clearIdentity,
} from '../auth.js';
import { getDb } from '../db.js';
import { isLocation, LOCATIONS } from '../locations.js';
import { logAudit } from './audit.js';

export const authRouter = Router();
export const adminRouter = Router();

authRouter.get('/config', (req, res) => {
  res.json({
    // label = the sign-in wording; name = what it's called once you're inside.
    locationNames: Object.fromEntries(Object.entries(LOCATIONS).map(([k, v]) => [k, v.name])),
    authEnabled: config.authEnabled,
    authProvider: config.authProvider,
    googleClientId: config.googleClientId,
  });
});

/**
 * Step one: prove who you are. No session is issued and no data is reachable yet — the reply
 * is only the list of locations this identity may enter, so the picker can offer exactly
 * those and nothing else.
 */
async function identify(req, res, profilePromise) {
  const profile = await profilePromise;
  const locations = locationsFor(profile.email);
  issueIdentity(res, profile);
  res.json({
    name: profile.name,
    locations: locations.map((key) => ({ key, label: LOCATIONS[key].label })),
    // Tells an empty list apart: waiting on an admin, versus not known here at all.
    pending: locations.length === 0 && hasPendingAnywhere(profile.email),
  });
}

authRouter.post('/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Missing Google credential' });
    await identify(req, res, verifyGoogleCredential(credential));
  } catch (err) {
    console.error('[auth/google]', err);
    res.status(401).json({ error: err.message || 'Google sign-in failed' });
  }
});

authRouter.post('/local', async (req, res) => {
  try {
    const { name, email } = req.body || {};
    await identify(req, res, Promise.resolve(verifyLocalCredential({ name, email })));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Sign-in failed' });
  }
});

/**
 * Step two: enter a location. The identity cookie is re-checked against the allowed list
 * rather than trusted from the request, so naming a location you were never offered fails
 * here just as it would have been hidden there.
 */
authRouter.post('/enter', (req, res) => {
  const profile = readIdentity(req);
  if (!profile) return res.status(401).json({ error: 'Sign in again' });

  const { location } = req.body || {};
  if (!isLocation(location)) return res.status(400).json({ error: 'Choose a location' });
  if (!locationsFor(profile.email).includes(location)) {
    return res.status(403).json({ error: 'No access to that location' });
  }

  const db = getDb(location);
  const user = findOrCreateUser(db, profile);
  if (user.status === 'blocked') return res.status(403).json({ error: 'Account blocked' });

  issueSession(res, user, location);
  clearIdentity(res);
  // req.user/req.db aren't populated on the sign-in request itself — the session is only just
  // being issued — so they're set here for the trail to pick up.
  req.db = db;
  req.user = user;
  logAudit(req, { action: 'signed-in', detail: `Signed in to ${LOCATIONS[location].label}` });
  res.json({ user: publicUser(user, location) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user, req.location) });
});

authRouter.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// The roster carries every account's email, role and approval history, so the whole router —
// reads included — is admin-only.
adminRouter.use(requireAuth, requireApproved);

adminRouter.get('/users', requireAdmin, (req, res) => {
  res.json(req.db.prepare('SELECT id, email, name, role, status, created_at, approved_at, approved_by FROM users ORDER BY created_at DESC').all());
});

/**
 * POST /api/admin/users  { email, name? } — grant someone access to this location.
 *
 * Needed because sign-in only offers locations you are already approved for: without a way to
 * add an account ahead of time, a location could never take on anyone beyond ADMIN_EMAILS.
 */
adminRouter.post('/users', requireAdmin, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });

  const existing = req.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'That account already exists here' });

  const name = String(req.body?.name || '').trim() || email;
  const info = req.db.prepare(
    "INSERT INTO users (email, name, role, status, approved_at, approved_by) VALUES (?, ?, 'user', 'approved', datetime('now'), ?)"
  ).run(email, name, req.user.email);

  logAudit(req, { action: 'user-approved', detail: `Added ${email}` });
  res.status(201).json(req.db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(info.lastInsertRowid));
});

adminRouter.post('/users/:id/approve', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = req.db.prepare('SELECT email FROM users WHERE id = ?').get(id);
  const result = req.db.prepare(
    "UPDATE users SET status = 'approved', approved_at = datetime('now'), approved_by = ? WHERE id = ?"
  ).run(req.user.email, id);
  if (!result.changes) return res.status(404).json({ error: 'User not found' });
  logAudit(req, { action: 'user-approved', detail: `Approved ${target?.email ?? `user #${id}`}` });
  res.json({ ok: true });
});

adminRouter.post('/users/:id/block', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "You can't block your own account" });
  const target = req.db.prepare('SELECT email FROM users WHERE id = ?').get(id);
  const result = req.db.prepare("UPDATE users SET status = 'blocked' WHERE id = ?").run(id);
  if (!result.changes) return res.status(404).json({ error: 'User not found' });
  logAudit(req, { action: 'user-blocked', detail: `Blocked ${target?.email ?? `user #${id}`}` });
  res.json({ ok: true });
});

adminRouter.post('/users/:id/role', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const role = req.body?.role;
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: "role must be 'admin' or 'user'" });
  if (id === req.user.id && role === 'user') return res.status(400).json({ error: "You can't demote your own account" });
  const target = req.db.prepare('SELECT email, role FROM users WHERE id = ?').get(id);
  const result = req.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  if (!result.changes) return res.status(404).json({ error: 'User not found' });
  logAudit(req, {
    action: 'user-role-changed',
    detail: `${target?.email ?? `user #${id}`}: ${target?.role ?? '?'} → ${role}`,
  });
  res.json({ ok: true });
});
