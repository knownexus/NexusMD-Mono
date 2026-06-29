'use strict';

const http = require('http');
const { shell } = require('electron');
const core = require('./oauth-core.cjs');

const WAIT_MS = 5 * 60 * 1000; // user has 5 minutes to complete sign-in

// Start a single-use loopback HTTP listener on an OS-assigned free port.
function loopbackListen(host) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, host, () => resolve(server));
  });
}

async function runSignIn(provider) {
  const p = core.PROVIDERS[provider];
  if (!p) throw new Error(`unknown provider: ${provider}`);
  if (!p.clientId) throw new Error(`${provider} desktop client id not configured`);

  const { verifier, challenge } = core.makePkce();
  const state = core.randomState();
  const server = await loopbackListen(p.redirectHost);
  const redirectUri = `http://${p.redirectHost}:${server.address().port}`;

  const codePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server.close(); reject(new Error('sign-in timed out')); }, WAIT_MS);
    server.on('request', (req, res) => {
      const url = new URL(req.url, redirectUri);
      const code = url.searchParams.get('code');
      const retState = url.searchParams.get('state');
      const err = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem">You can return to NexusMD now.</body>');
      clearTimeout(timer);
      server.close();
      if (err) return reject(new Error(err));
      if (!code || retState !== state) return reject(new Error('invalid OAuth response'));
      resolve(code);
    });
  });

  await shell.openExternal(core.buildAuthUrl(p, { redirectUri, challenge, state }));
  const code = await codePromise;

  const resp = await fetch(p.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: p.clientId,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!resp.ok) throw new Error(`token exchange failed (${resp.status})`);
  return core.parseTokenResponse(await resp.json());
}

async function runRefresh(provider, refreshToken) {
  const p = core.PROVIDERS[provider];
  if (!p) throw new Error(`unknown provider: ${provider}`);
  const resp = await fetch(p.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: p.clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: p.scope,
    }),
  });
  if (!resp.ok) throw new Error(`token refresh failed (${resp.status})`);
  const t = core.parseTokenResponse(await resp.json());
  return { accessToken: t.accessToken, refreshToken: t.refreshToken };
}

function register(ipcMain) {
  ipcMain.handle('oauth:signIn', (_e, provider) => runSignIn(provider));
  ipcMain.handle('oauth:refresh', (_e, { provider, refreshToken }) => runRefresh(provider, refreshToken));
}

module.exports = { register, runSignIn, runRefresh };
