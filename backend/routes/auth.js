import { Router } from 'express';
import { config } from '../config.js';
import {
  verifyGoogleCredential, verifyLocalCredential, findOrCreateUser, issueSession, clearSession,
  publicUser, requireAuth, requireAdmin,
} from '../auth.js';
import { db } from '../db.js';

export const authRouter = Router();
export const adminRouter = Router();

authRouter.get('/config', (req, res) => {
  res.json({ authEnabled: config.authEnabled, authProvider: config.authProvider, googleClientId: config.googleClientId });
});

authRouter.post('/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Missing Google credential' });
    const profile = await verifyGoogleCredential(credential);
    const user = findOrCreateUser(profile);
    if (user.status === 'blocked') return res.status(403).json({ error: 'Account blocked' });
    issueSession(res, user);
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('[auth/google]', err);
    res.status(401).json({ error: err.message || 'Google sign-in failed' });
  }
});

authRouter.post('/local', (req, res) => {
  try {
    const { name, email } = req.body || {};
    const profile = verifyLocalCredential({ name, email });
    const user = findOrCreateUser(profile);
    if (user.status === 'blocked') return res.status(403).json({ error: 'Account blocked' });
    issueSession(res, user);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Sign-in failed' });
  }
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

authRouter.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/users', (req, res) => {
  res.json(db.prepare('SELECT id, email, name, role, status, created_at, approved_at, approved_by FROM users ORDER BY created_at DESC').all());
});

adminRouter.post('/users/:id/approve', (req, res) => {
  const result = db.prepare(
    "UPDATE users SET status = 'approved', approved_at = datetime('now'), approved_by = ? WHERE id = ?"
  ).run(req.user.email, Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

adminRouter.post('/users/:id/block', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "You can't block your own account" });
  const result = db.prepare("UPDATE users SET status = 'blocked' WHERE id = ?").run(id);
  if (!result.changes) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

adminRouter.post('/users/:id/role', (req, res) => {
  const id = Number(req.params.id);
  const role = req.body?.role;
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: "role must be 'admin' or 'user'" });
  if (id === req.user.id && role === 'user') return res.status(400).json({ error: "You can't demote your own account" });
  const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  if (!result.changes) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});
