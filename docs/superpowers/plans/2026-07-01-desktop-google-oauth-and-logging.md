# Desktop Google OAuth (native PKCE) + Comprehensive Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google sign-in (Drive + Gmail + Calendar) work on the desktop app with no backend, using a native PKCE loopback OAuth flow in the Electron main process, and make logging comprehensive.

**Architecture:** A provider-generic OAuth engine in `apps/desktop/electron/oauth/` runs the RFC 8252 flow (PKCE + `127.0.0.1` loopback) entirely in the main process (Node → no CORS). The renderer (`cloud-auth.js`) asks main to run the flow over IPC and stores the returned tokens under the existing localStorage contract, so `packages/ui/src/cloud/providers.js` is untouched. Comprehensive logging is folded in via a reusable IPC-logging wrapper, scoped `[area]` tags, full-error logging, and removal of silent `catch {}` blocks.

**Tech Stack:** Electron 43 (Node 20, global `fetch`), electron-log v5, Node `crypto`/`http`, Vitest.

## Global Constraints

- Electron 43 / Node 20 — global `fetch` is available in the main process; do NOT add an `https` fallback.
- Main-process modules under `apps/desktop/electron/` are **CommonJS** (`.cjs`, `require`/`module.exports`). Renderer modules under `apps/desktop/src/` are **ESM**.
- Test files that exercise main-process (`.cjs`) modules MUST start with `// @vitest-environment node` (the project default env is `jsdom`).
- Run tests from `apps/desktop/`. Test command: `npx vitest run <path>`.
- Google scopes (exact, verbatim): `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/calendar`.
- Credentials are committed in-repo per user decision (native-app secrets are non-confidential). First commit uses placeholders `<PASTE_DESKTOP_CLIENT_ID>` / `<PASTE_DESKTOP_CLIENT_SECRET>`; the user pastes real values later.
- Never log token or secret values.
- Work happens on branch `feat/desktop-google-oauth`. Commit after every task.

## File Structure

- Create `apps/desktop/electron/oauth/config.cjs` — provider credentials, endpoints, scopes.
- Create `apps/desktop/electron/oauth/pkce.cjs` — PKCE verifier/challenge/state.
- Create `apps/desktop/electron/oauth/google.cjs` — pure request builders + token exchange/refresh.
- Create `apps/desktop/electron/oauth/loopback.cjs` — ephemeral loopback redirect server.
- Create `apps/desktop/electron/ipc/withLogging.cjs` — `ipcMain.handle` wrapper that logs failures.
- Create `apps/desktop/electron/ipc/oauth.cjs` — orchestrates the flow; registers IPC handlers.
- Modify `apps/desktop/electron/preload.cjs` — expose `oauth` bridge.
- Modify `apps/desktop/electron/main.cjs` — register oauth IPC + lifecycle logging.
- Modify `apps/desktop/src/cloud-auth.js` — native Google binding + full-error logging + fix silent catches.

---

### Task 1: OAuth provider config

**Files:**
- Create: `apps/desktop/electron/oauth/config.cjs`
- Test: `apps/desktop/electron/oauth/config.test.js`

**Interfaces:**
- Produces: `module.exports.google = { clientId, clientSecret, authUrl, tokenUrl, scopes: string[], authParams: { access_type, prompt } }`

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import config from './config.cjs'

describe('oauth config', () => {
  it('defines the google provider with all three scopes and offline consent', () => {
    const g = config.google
    expect(g.authUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(g.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(g.scopes).toEqual([
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
    ])
    expect(g.authParams).toEqual({ access_type: 'offline', prompt: 'consent' })
    expect(typeof g.clientId).toBe('string')
    expect(typeof g.clientSecret).toBe('string')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/oauth/config.test.js`
Expected: FAIL — cannot resolve `./config.cjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// apps/desktop/electron/oauth/config.cjs
'use strict';

// Native-app OAuth clients: the client secret is NOT confidential (RFC 8252 §8.5),
// so it is committed here per project decision. Paste your Google Cloud "Desktop app"
// client credentials below (or provide them via env at build time).
module.exports = {
  google: {
    clientId:     process.env.GOOGLE_DESKTOP_CLIENT_ID     || '<PASTE_DESKTOP_CLIENT_ID>',
    clientSecret: process.env.GOOGLE_DESKTOP_CLIENT_SECRET || '<PASTE_DESKTOP_CLIENT_SECRET>',
    authUrl:  'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
    ],
    // access_type=offline + prompt=consent guarantee a refresh_token is returned.
    authParams: { access_type: 'offline', prompt: 'consent' },
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/oauth/config.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/oauth/config.cjs apps/desktop/electron/oauth/config.test.js
git commit -m "feat(desktop): add Google OAuth provider config"
```

---

### Task 2: PKCE generator

**Files:**
- Create: `apps/desktop/electron/oauth/pkce.cjs`
- Test: `apps/desktop/electron/oauth/pkce.test.js`

**Interfaces:**
- Produces: `makePkce() => { verifier: string, challenge: string, state: string }`; `base64url(buf: Buffer) => string`

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { makePkce } from './pkce.cjs'

describe('makePkce', () => {
  it('derives an S256 challenge from the verifier', () => {
    const { verifier, challenge, state } = makePkce()
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url')
    expect(challenge).toBe(expected)
    expect(state.length).toBeGreaterThan(0)
  })

  it('produces url-safe values (no +, /, or = padding)', () => {
    const { verifier, challenge, state } = makePkce()
    for (const v of [verifier, challenge, state]) expect(v).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('produces unique verifiers per call', () => {
    expect(makePkce().verifier).not.toBe(makePkce().verifier)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/oauth/pkce.test.js`
Expected: FAIL — cannot resolve `./pkce.cjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// apps/desktop/electron/oauth/pkce.cjs
'use strict';
const crypto = require('crypto');

function base64url(buf) { return Buffer.from(buf).toString('base64url'); }

function makePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = base64url(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

module.exports = { makePkce, base64url };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/oauth/pkce.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/oauth/pkce.cjs apps/desktop/electron/oauth/pkce.test.js
git commit -m "feat(desktop): add PKCE generator for native OAuth"
```

---

### Task 3: Google request builders + token exchange/refresh

**Files:**
- Create: `apps/desktop/electron/oauth/google.cjs`
- Test: `apps/desktop/electron/oauth/google.test.js`

**Interfaces:**
- Consumes: config object from Task 1 (`{clientId, clientSecret, authUrl, tokenUrl, scopes, authParams}`).
- Produces:
  - `buildAuthUrl(cfg, { redirectUri, challenge, state }) => string`
  - `exchangeCode(cfg, { code, verifier, redirectUri }, fetchImpl?) => Promise<{accessToken, refreshToken, expiresAt}>`
  - `refreshAccessToken(cfg, refreshToken, fetchImpl?) => Promise<{accessToken, expiresAt}>`

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { buildAuthUrl, exchangeCode, refreshAccessToken } from './google.cjs'

const cfg = {
  clientId: 'cid', clientSecret: 'secret',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/gmail.modify'],
  authParams: { access_type: 'offline', prompt: 'consent' },
}

describe('buildAuthUrl', () => {
  it('includes client, redirect, PKCE, scopes and offline consent', () => {
    const u = new URL(buildAuthUrl(cfg, { redirectUri: 'http://127.0.0.1:5555', challenge: 'CH', state: 'ST' }))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const p = u.searchParams
    expect(p.get('client_id')).toBe('cid')
    expect(p.get('redirect_uri')).toBe('http://127.0.0.1:5555')
    expect(p.get('response_type')).toBe('code')
    expect(p.get('code_challenge')).toBe('CH')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('state')).toBe('ST')
    expect(p.get('access_type')).toBe('offline')
    expect(p.get('prompt')).toBe('consent')
    expect(p.get('scope')).toBe('https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/gmail.modify')
  })
})

describe('exchangeCode', () => {
  it('POSTs the code and maps the token response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }) }))
    const out = await exchangeCode(cfg, { code: 'C', verifier: 'V', redirectUri: 'http://127.0.0.1:5555' }, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({ method: 'POST' }))
    const body = fetchImpl.mock.calls[0][1].body
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('C')
    expect(body.get('code_verifier')).toBe('V')
    expect(body.get('client_secret')).toBe('secret')
    expect(out.accessToken).toBe('AT')
    expect(out.refreshToken).toBe('RT')
    expect(out.expiresAt).toBeGreaterThan(Date.now())
  })

  it('throws with status on non-ok', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400, text: async () => 'bad' }))
    await expect(exchangeCode(cfg, { code: 'C', verifier: 'V', redirectUri: 'x' }, fetchImpl)).rejects.toThrow(/400/)
  })
})

describe('refreshAccessToken', () => {
  it('POSTs the refresh grant and maps the response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT2', expires_in: 3600 }) }))
    const out = await refreshAccessToken(cfg, 'RT', fetchImpl)
    const body = fetchImpl.mock.calls[0][1].body
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('RT')
    expect(out.accessToken).toBe('AT2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/oauth/google.test.js`
Expected: FAIL — cannot resolve `./google.cjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// apps/desktop/electron/oauth/google.cjs
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/oauth/google.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/oauth/google.cjs apps/desktop/electron/oauth/google.test.js
git commit -m "feat(desktop): add Google auth-url builder and token exchange/refresh"
```

---

### Task 4: Loopback redirect server

**Files:**
- Create: `apps/desktop/electron/oauth/loopback.cjs`
- Test: `apps/desktop/electron/oauth/loopback.test.js`

**Interfaces:**
- Produces: `startLoopback() => Promise<{ port: number, waitForCode({state, timeoutMs?}) => Promise<string>, close() => void }>`

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { startLoopback } from './loopback.cjs'

describe('startLoopback', () => {
  it('resolves the code when state matches', async () => {
    const h = await startLoopback()
    const p = h.waitForCode({ state: 'xyz', timeoutMs: 2000 })
    await fetch(`http://127.0.0.1:${h.port}/?code=abc&state=xyz`)
    expect(await p).toBe('abc')
    h.close()
  })

  it('rejects on state mismatch', async () => {
    const h = await startLoopback()
    const p = h.waitForCode({ state: 'xyz', timeoutMs: 2000 })
    await fetch(`http://127.0.0.1:${h.port}/?code=abc&state=WRONG`)
    await expect(p).rejects.toThrow(/state mismatch/)
    h.close()
  })

  it('rejects when the provider returns an error', async () => {
    const h = await startLoopback()
    const p = h.waitForCode({ state: 'xyz', timeoutMs: 2000 })
    await fetch(`http://127.0.0.1:${h.port}/?error=access_denied&state=xyz`)
    await expect(p).rejects.toThrow(/access_denied/)
    h.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/oauth/loopback.test.js`
Expected: FAIL — cannot resolve `./loopback.cjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// apps/desktop/electron/oauth/loopback.cjs
'use strict';
const http = require('http');

const DONE_PAGE =
  '<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding-top:3rem">' +
  '<h2>Sign-in complete</h2><p>You can close this tab and return to the app.</p></body></html>';

function startLoopback() {
  return new Promise((resolve) => {
    const server = http.createServer();
    let settle = null;

    server.on('request', (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1`);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DONE_PAGE);
      if (settle) settle({
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
        error: url.searchParams.get('error'),
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        waitForCode({ state, timeoutMs = 300000 }) {
          return new Promise((res, rej) => {
            const timer = setTimeout(() => { settle = null; rej(new Error('OAuth timed out waiting for redirect')); }, timeoutMs);
            settle = ({ code, state: got, error }) => {
              clearTimeout(timer);
              settle = null;
              if (error) return rej(new Error(`OAuth denied: ${error}`));
              if (got !== state) return rej(new Error('OAuth state mismatch'));
              if (!code) return rej(new Error('OAuth redirect missing code'));
              res(code);
            };
          });
        },
        close() { try { server.close(); } catch { /* already closed */ } },
      });
    });
  });
}

module.exports = { startLoopback };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/oauth/loopback.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/oauth/loopback.cjs apps/desktop/electron/oauth/loopback.test.js
git commit -m "feat(desktop): add loopback redirect server for native OAuth"
```

---

### Task 5: IPC logging wrapper

**Files:**
- Create: `apps/desktop/electron/ipc/withLogging.cjs`
- Test: `apps/desktop/electron/ipc/withLogging.test.js`

**Interfaces:**
- Produces: `withLogging(ipcMain) => (channel: string, fn: Handler) => void` — registers `fn` on `ipcMain.handle(channel, …)`, logging any rejection under `log.scope(channel)` before rethrowing.

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const errorSpy = vi.fn()
vi.mock('electron-log', () => ({ default: { scope: () => ({ error: errorSpy }) } }))

import { withLogging } from './withLogging.cjs'

describe('withLogging', () => {
  beforeEach(() => errorSpy.mockClear())

  it('registers the handler on ipcMain and returns its value', async () => {
    const handlers = {}
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn } }
    withLogging(ipcMain)('x:ok', async () => 42)
    expect(await handlers['x:ok']()).toBe(42)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('logs and rethrows when the handler rejects', async () => {
    const handlers = {}
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn } }
    const boom = new Error('boom')
    withLogging(ipcMain)('x:fail', async () => { throw boom })
    await expect(handlers['x:fail']()).rejects.toThrow('boom')
    expect(errorSpy).toHaveBeenCalledWith(boom)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/withLogging.test.js`
Expected: FAIL — cannot resolve `./withLogging.cjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// apps/desktop/electron/ipc/withLogging.cjs
'use strict';
const log = require('electron-log');

// Returns a handle(channel, fn) that registers fn on ipcMain and logs any
// rejection under log.scope(channel) before rethrowing to the renderer.
function withLogging(ipcMain) {
  return function handle(channel, fn) {
    ipcMain.handle(channel, async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        log.scope(channel).error(err);
        throw err;
      }
    });
  };
}

module.exports = { withLogging };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/withLogging.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/withLogging.cjs apps/desktop/electron/ipc/withLogging.test.js
git commit -m "feat(desktop): add IPC handler logging wrapper"
```

---

### Task 6: OAuth IPC orchestrator

**Files:**
- Create: `apps/desktop/electron/ipc/oauth.cjs`
- Test: `apps/desktop/electron/ipc/oauth.test.js`

**Interfaces:**
- Consumes: `config` (Task 1), `makePkce` (Task 2), `buildAuthUrl`/`exchangeCode`/`refreshAccessToken` (Task 3), `startLoopback` (Task 4), `withLogging` (Task 5), electron `shell`.
- Produces: `register(ipcMain)` — registers `oauth:start` and `oauth:refresh`. `oauth:start` returns `{accessToken, refreshToken, expiresAt}`; `oauth:refresh` returns `{accessToken, expiresAt}` or `null`.

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn(async () => {}) } }))
vi.mock('electron-log', () => ({ default: { scope: () => ({ info: vi.fn(), error: vi.fn() }) } }))
const refreshAccessToken = vi.fn(async () => ({ accessToken: 'AT2', expiresAt: 123 }))
vi.mock('../oauth/google.cjs', () => ({
  buildAuthUrl: () => 'https://auth', exchangeCode: vi.fn(), refreshAccessToken,
}))

import { register } from './oauth.cjs'

function fakeIpc() { const h = {}; return { ipcMain: { handle: (c, fn) => { h[c] = fn } }, h } }

describe('oauth ipc', () => {
  beforeEach(() => refreshAccessToken.mockClear())

  it('oauth:refresh delegates to refreshAccessToken', async () => {
    const { ipcMain, h } = fakeIpc()
    register(ipcMain)
    const out = await h['oauth:refresh'](null, { provider: 'google', refreshToken: 'RT' })
    expect(refreshAccessToken).toHaveBeenCalledWith(expect.any(Object), 'RT')
    expect(out).toEqual({ accessToken: 'AT2', expiresAt: 123 })
  })

  it('oauth:refresh returns null with no refresh token', async () => {
    const { ipcMain, h } = fakeIpc()
    register(ipcMain)
    expect(await h['oauth:refresh'](null, { provider: 'google' })).toBeNull()
  })

  it('rejects an unknown provider', async () => {
    const { ipcMain, h } = fakeIpc()
    register(ipcMain)
    await expect(h['oauth:start'](null, { provider: 'nope' })).rejects.toThrow(/unknown oauth provider/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc/oauth.test.js`
Expected: FAIL — cannot resolve `./oauth.cjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// apps/desktop/electron/ipc/oauth.cjs
'use strict';
const { shell } = require('electron');
const log = require('electron-log');
const config = require('../oauth/config.cjs');
const { makePkce } = require('../oauth/pkce.cjs');
const { startLoopback } = require('../oauth/loopback.cjs');
const { buildAuthUrl, exchangeCode, refreshAccessToken } = require('../oauth/google.cjs');
const { withLogging } = require('./withLogging.cjs');

function register(ipcMain) {
  const handle = withLogging(ipcMain);
  const olog = log.scope('oauth');

  handle('oauth:start', async (_e, { provider = 'google' } = {}) => {
    const cfg = config[provider];
    if (!cfg) throw new Error(`unknown oauth provider: ${provider}`);
    const { verifier, challenge, state } = makePkce();
    const loop = await startLoopback();
    const redirectUri = `http://127.0.0.1:${loop.port}`;
    try {
      const authUrl = buildAuthUrl(cfg, { redirectUri, challenge, state });
      olog.info(`starting ${provider} OAuth on ${redirectUri}`);
      await shell.openExternal(authUrl);
      const code = await loop.waitForCode({ state });
      olog.info(`received ${provider} auth code; exchanging for tokens`);
      const tokens = await exchangeCode(cfg, { code, verifier, redirectUri });
      olog.info(`${provider} OAuth complete`);
      return tokens;
    } finally {
      loop.close();
    }
  });

  handle('oauth:refresh', async (_e, { provider = 'google', refreshToken } = {}) => {
    const cfg = config[provider];
    if (!cfg) throw new Error(`unknown oauth provider: ${provider}`);
    if (!refreshToken) return null;
    olog.info(`refreshing ${provider} access token`);
    return refreshAccessToken(cfg, refreshToken);
  });
}

module.exports = { register };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc/oauth.test.js`
Expected: PASS (3 tests). Note: the full `oauth:start` happy path (browser + loopback) is covered by manual E2E in Task 10, since it opens a system browser.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/oauth.cjs apps/desktop/electron/ipc/oauth.test.js
git commit -m "feat(desktop): add OAuth IPC orchestrator"
```

---

### Task 7: Expose oauth over the preload bridge

**Files:**
- Modify: `apps/desktop/electron/preload.cjs` (add `oauth` block as a top-level sibling of `logs`, before the final `});`)
- Test: `apps/desktop/electron/preload.test.js`

**Interfaces:**
- Produces (renderer global): `window.electronAPI.oauth.start(provider?) => Promise`, `window.electronAPI.oauth.refresh(refreshToken, provider?) => Promise`. Also asserts `window.electronAPI.logs` remains top-level (regression guard).

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

let exposed
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_n, o) => { exposed = o } },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), removeAllListeners: vi.fn() },
}))

describe('preload bridge', () => {
  it('exposes oauth and logs at the top level', async () => {
    await import('./preload.cjs')
    expect(typeof exposed.oauth.start).toBe('function')
    expect(typeof exposed.oauth.refresh).toBe('function')
    expect(typeof exposed.logs.list).toBe('function')   // regression: logs must stay top-level
    expect(exposed.update.oauth).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/preload.test.js`
Expected: FAIL — `exposed.oauth` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/electron/preload.cjs`, immediately after the `logs: { … },` block and before the closing `});`, add:

```js
  // ── OAuth (native desktop flow) ────────────────────────────────────────────
  oauth: {
    start:   (provider = 'google') => ipcRenderer.invoke('oauth:start', { provider }),
    refresh: (refreshToken, provider = 'google') => ipcRenderer.invoke('oauth:refresh', { provider, refreshToken }),
  },
```

The tail of the object must read:

```js
  logs: {
    list:   () => ipcRenderer.invoke('logs:list'),
    read:   (date) => ipcRenderer.invoke('logs:read', { date }),
    delete: (date) => ipcRenderer.invoke('logs:delete', { date }),
  },

  // ── OAuth (native desktop flow) ────────────────────────────────────────────
  oauth: {
    start:   (provider = 'google') => ipcRenderer.invoke('oauth:start', { provider }),
    refresh: (refreshToken, provider = 'google') => ipcRenderer.invoke('oauth:refresh', { provider, refreshToken }),
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/preload.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/preload.cjs apps/desktop/electron/preload.test.js
git commit -m "feat(desktop): expose oauth bridge in preload"
```

---

### Task 8: Register oauth IPC + lifecycle logging in main

**Files:**
- Modify: `apps/desktop/electron/main.cjs` (require + register oauth IPC near line 53/284; add lifecycle logs)

**Interfaces:**
- Consumes: `register(ipcMain)` from Task 6.
- Produces: no exports; wires oauth handlers into the running app and adds `log.scope('lifecycle')` entries.

- [ ] **Step 1: Add the require**

In the IPC requires block (near `const logsIpc = require('./ipc/logs.cjs');`, ~line 53), add:

```js
const oauthIpc       = require('./ipc/oauth.cjs');
```

- [ ] **Step 2: Register the handlers**

Immediately after `logsIpc.register(ipcMain);` (~line 284), add:

```js
  oauthIpc.register(ipcMain);
```

- [ ] **Step 3: Add lifecycle logging**

At the very start of the `app.whenReady().then(async () => {` callback body (before `mainWindow = createMainWindow();`), add:

```js
  log.scope('lifecycle').info('app ready; creating main window');
```

Inside `app.on('before-quit', () => {` (before `forceQuit = true;`), add:

```js
  log.scope('lifecycle').info('app quitting');
```

- [ ] **Step 4: Verify the app boots and handlers register**

Run: `node --check apps/desktop/electron/main.cjs`
Expected: no output (syntax OK).

Then start the app against the dev server (two terminals):
```bash
cd apps/desktop && npm run dev
# other terminal:
cd apps/desktop && VITE_DEV_SERVER_URL=http://localhost:5173 npm run start
```
Expected: app launches; today's log file shows `[lifecycle] app ready; creating main window`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/main.cjs
git commit -m "feat(desktop): register oauth IPC and add lifecycle logging"
```

---

### Task 9: Native Google binding + comprehensive error logging in renderer

**Files:**
- Modify: `apps/desktop/src/cloud-auth.js`
- Test: `apps/desktop/src/cloud-auth.test.js`

**Interfaces:**
- Consumes: `window.electronAPI.oauth.start()` / `.refresh(refreshToken)` (Task 7).
- Produces (new export): `makeNativeGoogleBinding() => { isConnected, connect, disconnect, getToken({force}) }`; `desktopCloudProviders` now uses it for Google Drive.

- [ ] **Step 1: Write the failing test**

```js
// apps/desktop/src/cloud-auth.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@nexusmd/ui', () => ({
  makeGoogleDriveProvider: (b) => b, makeOneDriveProvider: (b) => b, toast: () => {},
}))
vi.mock('./profile-keys.js', () => ({ getProfileKey: (k) => k }))
vi.mock('./adapters/secureStorage.js', () => ({ secureStorageAdapter: { get: async () => null, set: async () => {} } }))

import { makeNativeGoogleBinding } from './cloud-auth.js'

const KEY = 'nexusmd.google.auth'

beforeEach(() => {
  localStorage.clear()
  window.electronAPI = { oauth: { start: vi.fn(), refresh: vi.fn() } }
})

describe('makeNativeGoogleBinding', () => {
  it('returns null token when disconnected', async () => {
    expect(await makeNativeGoogleBinding().getToken()).toBeNull()
  })

  it('returns the cached token when unexpired', async () => {
    localStorage.setItem(KEY, JSON.stringify({ accessToken: 'good', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 }))
    const b = makeNativeGoogleBinding()
    expect(await b.getToken()).toBe('good')
    expect(window.electronAPI.oauth.refresh).not.toHaveBeenCalled()
  })

  it('refreshes and re-stores when the token is expired', async () => {
    localStorage.setItem(KEY, JSON.stringify({ accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() - 1000 }))
    window.electronAPI.oauth.refresh.mockResolvedValue({ accessToken: 'new', expiresAt: Date.now() + 3_600_000 })
    const b = makeNativeGoogleBinding()
    expect(await b.getToken()).toBe('new')
    expect(window.electronAPI.oauth.refresh).toHaveBeenCalledWith('r')
    expect(JSON.parse(localStorage.getItem(KEY)).accessToken).toBe('new')
  })

  it('connect stores tokens returned by the native flow', async () => {
    window.electronAPI.oauth.start.mockResolvedValue({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 42 })
    await makeNativeGoogleBinding().connect()
    expect(JSON.parse(localStorage.getItem(KEY))).toMatchObject({ accessToken: 'AT', refreshToken: 'RT' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cloud-auth.test.js`
Expected: FAIL — `makeNativeGoogleBinding` is not exported.

- [ ] **Step 3: Implement the binding and swap the provider**

In `apps/desktop/src/cloud-auth.js`, add this exported factory (e.g. just above `desktopCloudProviders`):

```js
// Native desktop Google connection: tokens come from the Electron main process
// (PKCE loopback flow) — no backend. One connection grants Drive + Gmail + Calendar.
export function makeNativeGoogleBinding() {
  const suffix = 'google.auth'
  return {
    isConnected: () => Boolean(read(suffix)?.accessToken),
    async connect() {
      try {
        console.info('[cloud-auth] Initiating google OAuth connection (native)')
        const tokens = await window.electronAPI.oauth.start()
        write(suffix, tokens)
        console.info('[cloud-auth] google OAuth connected')
        window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
      } catch (err) {
        console.error('[cloud-auth] Failed to connect google:', err?.stack || err)
        toast?.('Google sign-in failed. Please try again.', 'error')
      }
    },
    async disconnect() { clear(suffix) },
    async getToken({ force } = {}) {
      const auth = read(suffix)
      if (!auth?.accessToken) return null
      const expired = auth.expiresAt && Date.now() > auth.expiresAt - 60_000
      if (!force && !expired) return auth.accessToken
      try {
        const next = await window.electronAPI.oauth.refresh(auth.refreshToken)
        if (!next?.accessToken) return force ? null : auth.accessToken
        write(suffix, { ...auth, ...next })
        return next.accessToken
      } catch (err) {
        console.error('[cloud-auth] google token refresh failed:', err?.stack || err)
        return force ? null : auth.accessToken
      }
    },
  }
}
```

Then change the Drive provider to use it:

```js
export const desktopCloudProviders = [
  makeGoogleDriveProvider(makeNativeGoogleBinding()),
  makeOneDriveProvider(makeBinding('onedrive')),
]
```

- [ ] **Step 4: Fix the silent catch blocks (comprehensive logging)**

Replace each bare `catch {}` / `catch { return null }` that hides a real failure with a logged version. Apply these exact edits:

In `getToken` of `makeBinding` (the OneDrive path), change:
```js
      } catch { return null }
```
to:
```js
      } catch (err) { console.warn('[cloud-auth] token refresh failed:', err?.message || err); return null }
```

In `redeem()`, change the trailing:
```js
  } catch {}
```
to:
```js
  } catch (err) { console.error('[cloud-auth] OAuth redeem failed:', err?.stack || err) }
```

In `makeDesktopOAuthService` → `getToken`, change:
```js
      } catch { return null }
```
to:
```js
      } catch (err) { console.warn('[cloud-auth] token refresh failed:', err?.message || err); return null }
```

In `makeDesktopOAuthService` → `loadCreds`, change:
```js
      } catch { return {} }
```
to:
```js
      } catch (err) { console.warn('[cloud-auth] loadCreds failed:', err?.message || err); return {} }
```

In `makeDesktopOAuthService` → `saveCreds`, change:
```js
      } catch {}
```
to:
```js
      } catch (err) { console.warn('[cloud-auth] saveCreds failed:', err?.message || err) }
```

(Leave the `read`/`write`/`clear` localStorage guards as-is — those are intentional per-call guards, not failure sites.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/cloud-auth.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/cloud-auth.js apps/desktop/src/cloud-auth.test.js
git commit -m "feat(desktop): route Google auth through native flow; log full errors, fix silent catches"
```

---

### Task 10: Full verification + credentials + manual E2E

**Files:** none (verification + user configuration)

- [ ] **Step 1: Run the full desktop test suite**

Run: `cd apps/desktop && npx vitest run`
Expected: all suites PASS, including the new `oauth/*`, `ipc/*`, `preload`, and `cloud-auth` tests plus the existing `log-parse`/`LogsCard` suites.

- [ ] **Step 2: Paste real credentials**

Edit `apps/desktop/electron/oauth/config.cjs`, replacing `<PASTE_DESKTOP_CLIENT_ID>` and `<PASTE_DESKTOP_CLIENT_SECRET>` with the Google Cloud **Desktop app** client's ID and secret (or set `GOOGLE_DESKTOP_CLIENT_ID` / `GOOGLE_DESKTOP_CLIENT_SECRET` in the build environment).

- [ ] **Step 3: Configure the Google Cloud project (one-time, in the console)**

  - OAuth client type must be **Desktop app**.
  - Enable the **Google Drive API**, **Gmail API**, and **Google Calendar API**.
  - On the OAuth consent screen, add your account as a **Test user** (sensitive scopes) or publish the app.

- [ ] **Step 4: Manual E2E**

Rebuild/relaunch the app (`npm run build:win` then launch, or the dev-server flow from Task 8). In Settings, click **Connect Google Drive**:
  - System browser opens Google consent listing Drive, Gmail, and Calendar access.
  - After approving, the browser shows "Sign-in complete", and the app shows Drive connected.
  - A `.nmdprofile` file appears in your Drive **NexusMD** folder on next sync.
  - The in-app log viewer shows the `[oauth]` step trail (`starting google OAuth…`, `received … auth code…`, `google OAuth complete`) and `[cloud-auth] google OAuth connected`.

- [ ] **Step 5: Commit the credentials**

```bash
git add apps/desktop/electron/oauth/config.cjs
git commit -m "chore(desktop): set Google Desktop OAuth client credentials"
```

---

## Self-Review Notes

- **Spec coverage:** native PKCE loopback (Tasks 2/4/6), no backend (Task 9 removes fetch-to-backend for Google), single Google connection with all three scopes (Tasks 1/3), token storage contract preserved (Task 9), preload sibling care (Task 7), comprehensive logging — full errors + silent-catch fixes (Task 9), IPC wrapper (Task 5), scoped areas + lifecycle (Tasks 6/8). External prerequisites and E2E (Task 10). OneDrive/web/keychain explicitly deferred.
- **Type consistency:** `{accessToken, refreshToken, expiresAt}` from `exchangeCode`/`oauth:start`; `{accessToken, expiresAt}` from `refreshAccessToken`/`oauth:refresh`. Renderer `refresh(refreshToken)` matches preload `refresh(refreshToken, provider='google')`. `startLoopback().waitForCode({state, timeoutMs})` used consistently in Tasks 4 and 6.
- **No placeholders:** the only `<PASTE_…>` markers are intentional credential slots filled in Task 10.
```
