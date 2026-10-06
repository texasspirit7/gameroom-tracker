import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);
const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'wheel'];

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authProvider, setAuthProvider] = useState('local');
  // Set once an identity is proven: the locations that identity may actually enter, which
  // is why nothing is offered until someone has said who they are.
  const [allowed, setAllowed] = useState(null);   // null = not identified yet
  const [locationNames, setLocationNames] = useState({});
  const [pendingApproval, setPendingApproval] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const cfg = await api.authConfig();
      setAuthEnabled(cfg.authEnabled);
      setAuthProvider(cfg.authProvider);
      setLocationNames(cfg.locationNames || {});
      setGoogleClientId(cfg.googleClientId || '');
      if (!cfg.authEnabled) {
        setUser(null);
        return;
      }
      try {
        const { user: me } = await api.me();
        setUser(me);
      } catch {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  /** Exchange a proven identity for a session at one location. */
  const enter = async (location) => {
    setError(null);
    try {
      const { user: me } = await api.enterLocation(location);
      setUser(me);
      setAllowed(null);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  /** Back to the start of sign-in — used by the "not you?" link. */
  const resetIdentity = () => {
    setAllowed(null);
    setPendingApproval(false);
    setError(null);
  };

  const login = async (name, email) => {
    setError(null);
    try {
      const { locations, pending } = await api.identifyLocal(name, email);
      setAllowed(locations);
      setPendingApproval(Boolean(pending));
      // One door means there is nothing to choose — go straight in.
      if (locations.length === 1) return enter(locations[0].key);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const loginWithGoogle = async (credential) => {
    setError(null);
    try {
      const { locations, pending } = await api.identifyGoogle(credential);
      setAllowed(locations);
      setPendingApproval(Boolean(pending));
      // One door means there is nothing to choose — go straight in.
      if (locations.length === 1) return enter(locations[0].key);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    if (!authEnabled || !user) return;

    let timer;
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        logoutRef.current();
      }, INACTIVITY_LIMIT_MS);
    };

    resetTimer();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetTimer));

    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [authEnabled, user]);

  const isAdmin = user?.role === 'admin';
  // Owning the activity trail is narrower than being an admin — the trail records what
  // admins do to each other's accounts, so it isn't visible to them generally.
  const isOwner = Boolean(user?.isOwner);

  return (
    <AuthContext.Provider value={{
      loading, authEnabled, authProvider, googleClientId, user, error,
      login, loginWithGoogle, logout, isAdmin, isOwner, refresh,
      allowed, pendingApproval, enter, resetIdentity,
      // Which location this session is in — the shell names it so the two can't be confused.
      locationLabel: locationNames[user?.location] || null,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
