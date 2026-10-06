import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export default function AdminUsers() {
  const { user: me, isAdmin, authEnabled, locationLabel } = useAuth();
  const canManage = !authEnabled || isAdmin;
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [invite, setInvite] = useState({ email: '', name: '' });
  const [inviting, setInviting] = useState(false);

  const load = () => api.adminUsers().then(setUsers).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const act = async (fn) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const addUser = async (e) => {
    e.preventDefault();
    setInviting(true);
    setError(null);
    try {
      await api.addUser(invite.email.trim(), invite.name.trim());
      setInvite({ email: '', name: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  };

  if (error && !users) return <div className="error-box">{error}</div>;
  if (!users) return <p className="muted"><span className="spinner" />Loading…</p>;

  const pending = users.filter((u) => u.status === 'pending');
  const others = users.filter((u) => u.status !== 'pending');

  return (
    <>
      <h1 className="page-title">Admin — Users</h1>
      <div className="page-sub">
        {canManage
          ? 'Approve new sign-ins, block accounts, and manage who has admin rights.'
          : 'Who has access — approving and blocking requires an admin account.'}
      </div>
      {error && <div className="error-box">{error}</div>}

      {canManage && (
        <div className="panel">
          <h2>Give someone access</h2>
          {/* Sign-in only offers locations you're already approved for, so without this a new
              person would sign in and be shown nothing at all. */}
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Adds an approved account for <strong>{locationLabel || 'this location'}</strong> only.
            They can sign in straight away; other locations stay closed to them.
          </p>
          <form className="receipt-form" onSubmit={addUser}>
            <label className="grow">Email
              <input
                type="email" required placeholder="someone@example.com"
                value={invite.email}
                onChange={(ev) => setInvite((v) => ({ ...v, email: ev.target.value }))}
              />
            </label>
            <label className="grow">Name (optional)
              <input
                type="text" placeholder="Their name"
                value={invite.name}
                onChange={(ev) => setInvite((v) => ({ ...v, name: ev.target.value }))}
              />
            </label>
            <button className="btn" disabled={inviting}>{inviting ? 'Adding…' : 'Add user'}</button>
          </form>
        </div>
      )}

      {pending.length > 0 && (
        <div className="panel">
          <h2>Pending approval ({pending.length})</h2>
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Requested</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {pending.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.created_at}</td>
                  {canManage && (
                    <td>
                      <button onClick={() => act(() => api.approveUser(u.id))}>Approve</button>{' '}
                      <button className="danger" onClick={() => act(() => api.blockUser(u.id))}>Block</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h2>All users ({others.length})</h2>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Approved by</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {others.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td><span className={`badge ${u.role === 'admin' ? 'verified' : ''}`}>{u.role}</span></td>
                <td><span className={`badge ${u.status === 'blocked' ? 'bleeding' : 'verified'}`}>{u.status}</span></td>
                <td>{u.approved_by || '—'}</td>
                {canManage && (
                  <td>
                    {u.id !== me?.id && (
                      <>
                        {u.role === 'admin' ? (
                          <button className="secondary" onClick={() => act(() => api.setUserRole(u.id, 'user'))}>Make user</button>
                        ) : (
                          <button className="secondary" onClick={() => act(() => api.setUserRole(u.id, 'admin'))}>Make admin</button>
                        )}{' '}
                        {u.status === 'blocked' ? (
                          <button onClick={() => act(() => api.approveUser(u.id))}>Unblock</button>
                        ) : (
                          <button className="danger" onClick={() => act(() => api.blockUser(u.id))}>Block</button>
                        )}
                      </>
                    )}
                    {u.id === me?.id && <span className="muted">(you)</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
