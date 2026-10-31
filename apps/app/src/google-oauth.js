// google-oauth.js — Google sign-in done by the app itself, with no server of ours: the "installed app" flow.
// The app opens Google's consent page with a one-time PKCE challenge; Google sends the browser back to
// `com.knownexus.nexus:/oauth2redirect?code=…&state=…`, which only this app can open; the app then trades
// the code for tokens straight with Google. An Android-type OAuth client has no client secret, so nothing
// secret ships in the app. Setup: docs/google-sign-in.md.

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
// The Android app id doubles as the redirect scheme (Google requires it to match the client's package name).
export const REDIRECT_SCHEME = 'com.knownexus.nexus';
export const REDIRECT_URI = `${REDIRECT_SCHEME}:/oauth2redirect`;
export const SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive.file',
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
};

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomString(bytes = 32, c = globalThis.crypto) {
  const a = new Uint8Array(bytes);
  c.getRandomValues(a);
  return base64url(a);
}

// PKCE: the verifier stays in the app; Google gets only its SHA-256 until the code is traded.
export async function makePkce(c = globalThis.crypto) {
  const verifier = randomString(48, c);
  const digest = await c.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function buildAuthUrl({ clientId, scope, challenge, state, redirectUri = REDIRECT_URI }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope,
    code_challenge: challenge, code_challenge_method: 'S256', state,
    access_type: 'offline', prompt: 'consent',
  });
  return `${GOOGLE_AUTH_URL}?${q}`;
}

// The link Google sends the browser back to, or null if it is not that link.
export function parseRedirect(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${REDIRECT_SCHEME}:` || u.pathname !== '/oauth2redirect') return null;
  return { code: u.searchParams.get('code'), state: u.searchParams.get('state'), error: u.searchParams.get('error') };
}

async function tokenRequest(params, fetchImpl) {
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  let body = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !body.access_token) {
    const err = new Error(body.error_description || body.error || `Google answered ${res.status}`);
    err.code = body.error || '';
    throw err;
  }
  return body;
}

export async function exchangeCode({ clientId, code, verifier, redirectUri = REDIRECT_URI, fetchImpl = fetch, now = Date.now }) {
  const t = await tokenRequest({
    client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code',
  }, fetchImpl);
  return { accessToken: t.access_token, refreshToken: t.refresh_token || '', expiresAt: now() + (t.expires_in || 3600) * 1000 };
}

// err.code === 'invalid_grant' means the user revoked access (or the refresh token expired): sign in again.
export async function refreshAccessToken({ clientId, refreshToken, fetchImpl = fetch, now = Date.now }) {
  const t = await tokenRequest({ client_id: clientId, refresh_token: refreshToken, grant_type: 'refresh_token' }, fetchImpl);
  return { accessToken: t.access_token, expiresAt: now() + (t.expires_in || 3600) * 1000 };
}

// A sign-in only counts if this app started it, and only with the `state` it made: stops a stray or crafted link
// from storing tokens, and ties the returning code to the PKCE verifier kept here.
const PENDING_KEY = 'nexusmd.oauth.google.pending';
const PENDING_TTL_MS = 10 * 60 * 1000;
export function markGooglePending(p, now = Date.now(), storage = localStorage) {
  try { storage.setItem(PENDING_KEY, JSON.stringify({ ...p, at: now })); } catch { /* ignore */ }
}
export function takeGooglePending(state, now = Date.now(), storage = localStorage) {
  try {
    const p = JSON.parse(storage.getItem(PENDING_KEY) || 'null');
    if (!p) return null;
    const fresh = now - p.at >= 0 && now - p.at <= PENDING_TTL_MS;
    // Only the matching link uses the record up, so a forged one cannot cancel the real sign-in.
    if (fresh && p.state === state) { storage.removeItem(PENDING_KEY); return p; }
    if (!fresh) storage.removeItem(PENDING_KEY);
    return null;
  } catch { return null; }
}
