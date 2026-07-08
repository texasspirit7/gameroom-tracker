import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);
const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'wheel'];

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authProvider, setAuthProvider] = useState('local');
  const [googleClientId, setGoogleClientId] = useState('');
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const cfg = await api.authConfig();
      setAuthEnabled(cfg.authEnabled);
      setAuthProvider(cfg.authProvider);
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

  const login = async (name, email) => {
    setError(null);
    try {
      const { user: me } = await api.loginLocal(name, email);
      setUser(me);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const loginWithGoogle = async (credential) => {
    setError(null);
    try {
      const { user: me } = await api.loginGoogle(credential);
      setUser(me);
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

  return (
    <AuthContext.Provider value={{
      loading, authEnabled, authProvider, googleClientId, user, error,
      login, loginWithGoogle, logout, isAdmin, refresh,
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
