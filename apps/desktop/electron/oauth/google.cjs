'use strict';

function buildAuthUrl(cfg, { redirectUri, challenge, state }) {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    ...cfg.authParams,
  });
  return `${cfg.authUrl}?${p.toString()}`;
}

async function postForm(url, params, fetchImpl) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!res.ok) throw new Error(`token endpoint failed: HTTP ${res.status} - ${await res.text()}`);
  return res.json();
}

async function exchangeCode(cfg, { code, verifier, redirectUri }, fetchImpl = fetch) {
  const j = await postForm(cfg.tokenUrl, new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  }), fetchImpl);
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (j.expires_in || 0) * 1000 };
}

async function refreshAccessToken(cfg, refreshToken, fetchImpl = fetch) {
  const j = await postForm(cfg.tokenUrl, new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }), fetchImpl);
  return { accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in || 0) * 1000 };
}

module.exports = { buildAuthUrl, exchangeCode, refreshAccessToken };
