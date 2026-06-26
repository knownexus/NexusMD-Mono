// google-auth.js — Google OAuth helpers and token storage (per-profile localStorage)
// Tokens stored at: nexusmd.p.{profileId}.google.auth = { accessToken, refreshToken, email }
// OAuth flow: startGoogleOAuth() redirects to Google → Google redirects back to
//   /?from=google&code=xxx → handleGoogleOAuthCallback() exchanges code + saves tokens.

import { getProfileKey } from './profile-keys.js';
import { toast } from './toast.jsx';

function getGoogleAuth() {
  try {
    const k = getProfileKey('nexusmd.google.auth');
    return k ? JSON.parse(localStorage.getItem(k) || 'null') : null;
  } catch (_) { return null; }
}

function saveGoogleAuth(auth) {
  try {
    const k = getProfileKey('nexusmd.google.auth');
    if (k) localStorage.setItem(k, JSON.stringify(auth));
  } catch (_) {}
}

function clearGoogleAuth() {
  try {
    const k = getProfileKey('nexusmd.google.auth');
    if (k) localStorage.removeItem(k);
  } catch (_) {}
}

function emitTokenExpired() {
  document.dispatchEvent(new CustomEvent('nexusmd:token-expired', { detail: { service: 'google' } }));
}

async function refreshGoogleToken() {
  const auth = getGoogleAuth();
  if (!auth?.refreshToken) { emitTokenExpired(); return null; }
  try {
    const res = await fetch('/api/google/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { emitTokenExpired(); return null; }
    const { accessToken } = await res.json();
    saveGoogleAuth({ ...auth, accessToken });
    return accessToken;
  } catch (_) { return null; }
}

async function getGoogleToken() {
  const auth = getGoogleAuth();
  return auth?.accessToken ?? null;
}

async function startGoogleOAuth() {
  try {
    const redirectUri = window.location.origin + '/?from=google';
    const res = await fetch(`/api/google/auth/url?redirectUri=${encodeURIComponent(redirectUri)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      toast?.('Google OAuth is not configured on the server.', 'error');
      return;
    }
    const { url } = await res.json();
    window.location.href = url;
  } catch (_) {
    toast?.('Could not start Google sign-in.', 'error');
  }
}

// Called on page load — exchanges the OAuth code if present in the URL.
async function handleGoogleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('from') !== 'google') return;
  const code = params.get('code');
  if (!code) return;

  // Strip OAuth params from the URL immediately
  window.history.replaceState({}, '', window.location.pathname);

  try {
    const redirectUri = window.location.origin + '/?from=google';
    const res = await fetch('/api/google/auth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      toast?.('Google sign-in failed. Please try again.', 'error');
      return;
    }
    const { accessToken, refreshToken } = await res.json();
    saveGoogleAuth({ accessToken, refreshToken });
    document.dispatchEvent(new CustomEvent('google:auth:changed', { detail: { connected: true } }));
    toast?.('Google account connected.', 'success');
    // Navigate to settings → connection tab
    document.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: { view: 'settings', tab: 'connection' } }));
  } catch (_) {
    toast?.('Google sign-in failed. Please try again.', 'error');
  }
}

export const GoogleAuth = {
  isConnected: () => Boolean(getGoogleAuth()?.accessToken),
  getToken:    () => getGoogleToken(),
  refresh:     () => refreshGoogleToken(),
  connect:     () => startGoogleOAuth(),
  disconnect:  () => {
    clearGoogleAuth();
    document.dispatchEvent(new CustomEvent('google:auth:changed', { detail: { connected: false } }));
  },
  saveAuth:    saveGoogleAuth,
  getAuth:     getGoogleAuth,
  handleCallback: handleGoogleOAuthCallback,
};

// Run callback handler on load (safe no-op if no OAuth params present)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', handleGoogleOAuthCallback);
} else {
  handleGoogleOAuthCallback();
}
