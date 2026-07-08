import { useEffect, useRef } from 'react';
import { useAuth } from '../AuthContext.jsx';

const SCRIPT_ID = 'google-identity-services';

function loadGsiScript() {
  if (document.getElementById(SCRIPT_ID)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/** Renders the real "Sign in with Google" button (Google Identity Services). */
export default function GoogleSignInButton() {
  const { googleClientId, loginWithGoogle } = useAuth();
  const buttonRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadGsiScript().then(() => {
      if (cancelled || !window.google || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => loginWithGoogle(response.credential),
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline', size: 'large', width: 280, text: 'signin_with',
      });
    });
    return () => { cancelled = true; };
  }, [googleClientId]);

  return <div ref={buttonRef} className="google-signin-button" />;
}
