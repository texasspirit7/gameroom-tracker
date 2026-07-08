import { useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import GoogleSignInButton from './GoogleSignInButton.jsx';

export default function LoginGate({ children }) {
  const { loading, authEnabled, user, logout } = useAuth();

  if (loading) return <div className="gate-screen"><p className="muted"><span className="spinner" />Loading…</p></div>;
  if (!authEnabled) return children;
  if (!user) return <SignInScreen />;

  if (user.status === 'pending') {
    return (
      <div className="gate-screen">
        <div className="gate-card">
          <div className="gate-icon">⏳</div>
          <h2>Waiting for approval</h2>
          <p className="muted">
            Signed in as <strong>{user.email}</strong>. An admin needs to approve your account
            before you can view or upload sheets.
          </p>
          <button className="secondary" onClick={logout}>Sign out</button>
        </div>
      </div>
    );
  }

  if (user.status === 'blocked') {
    return (
      <div className="gate-screen">
        <div className="gate-card">
          <div className="gate-icon">🚫</div>
          <h2>Account blocked</h2>
          <p className="muted">Contact an admin if you think this is a mistake.</p>
          <button className="secondary" onClick={logout}>Sign out</button>
        </div>
      </div>
    );
  }

  return children;
}

function SignInScreen() {
  const { authProvider } = useAuth();
  return (
    <div className="gate-screen">
      <div className="gate-card">
        <div className="gate-icon">🎰</div>
        <h2>La Pryor Game Room Tracker</h2>
        <p className="muted">Sign in to continue. New accounts need admin approval before they can view data.</p>
        {authProvider === 'google' ? <GoogleSignInScreen /> : <LocalLoginForm />}
      </div>
    </div>
  );
}

function GoogleSignInScreen() {
  const { error } = useAuth();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <GoogleSignInButton />
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}

function LocalLoginForm() {
  const { login, error } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    await login(name, email);
    setBusy(false);
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label className="gate-label">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Your name" />
      </label>
      <label className="gate-label">
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
      </label>
      {error && <div className="error-box">{error}</div>}
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
