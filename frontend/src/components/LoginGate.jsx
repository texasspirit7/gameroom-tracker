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
  const { authProvider, allowed, pendingApproval, enter, resetIdentity } = useAuth();

  // Identity comes first: the list of locations is specific to who you are, so there is
  // nothing honest to show until you have said. Nobody is offered a door they can't open.
  if (allowed === null) {
    return (
      <div className="gate-screen">
        <div className="gate-card">
          <div className="gate-icon">📊</div>
          <h2>Sign in</h2>
          <p className="muted">New accounts need an admin to grant access before they can be used.</p>
          {authProvider === 'google' ? <GoogleSignInScreen /> : <LocalLoginForm />}
        </div>
      </div>
    );
  }

  if (allowed.length === 0) {
    return (
      <div className="gate-screen">
        <div className="gate-card">
          <div className="gate-icon">🔒</div>
          <h2>{pendingApproval ? 'Waiting for approval' : 'No access yet'}</h2>
          <p className="muted">
            {pendingApproval
              ? 'Your account exists but hasn’t been approved. An admin needs to let you in.'
              : 'This account hasn’t been given access to anywhere. Ask an admin to add you.'}
          </p>
          <button className="gate-back" onClick={resetIdentity}>← not you?</button>
        </div>
      </div>
    );
  }

  return (
    <div className="gate-screen">
      <div className="gate-card">
        <div className="gate-icon">📊</div>
        <h2>Choose a location</h2>
        <p className="muted">Each one keeps its own records and its own accounts.</p>
        <div className="gate-locations">
          {allowed.map((l) => (
            <button key={l.key} className="btn" onClick={() => enter(l.key)}>{l.label}</button>
          ))}
        </div>
        <button className="gate-back" onClick={resetIdentity}>← not you?</button>
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
