'use strict';

const crypto = require('crypto');

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function randomState() {
  return base64url(crypto.randomBytes(16));
}

const PROVIDERS = {
  google: {
    authEndpoint:  'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    get clientId() {
      const main = require('../main.cjs');
      return main.getOAuthClientId('google');
    },
    get clientSecret() {
      const main = require('../main.cjs');
      return main.getOAuthClientSecret('google');
    },
    scope: 'openid email https://www.googleapis.com/auth/drive.file',
    redirectHost: '127.0.0.1',
    authParams: { access_type: 'offline', prompt: 'consent' },
  },
  microsoft: {
    authEndpoint:  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    get clientId() {
      const main = require('../main.cjs');
      return main.getOAuthClientId('microsoft');
    },
    scope: 'openid email offline_access Files.ReadWrite',
    redirectHost: 'localhost',
    authParams: {},
  },
};

function buildAuthUrl(p, { redirectUri, challenge, state }) {
  const params = {
    client_id: p.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    ...p.authParams,
  };
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${p.authEndpoint}?${qs}`;
}

function decodeJwtEmail(idToken) {
  try {
    const payload = idToken.split('.')[1];
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return json.email || null;
  } catch {
    return null;
  }
}

function parseTokenResponse(json) {
  return {
    accessToken: json.access_token || null,
    refreshToken: json.refresh_token || null,
    email: json.id_token ? decodeJwtEmail(json.id_token) : null,
  };
}

module.exports = {
  base64url, makePkce, randomState, buildAuthUrl, decodeJwtEmail, parseTokenResponse, PROVIDERS,
};
