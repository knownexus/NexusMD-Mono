# Desktop In-App OAuth (Google Drive + OneDrive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop app sign in to Google Drive and OneDrive itself, via PKCE + loopback OAuth in the Electron main process, with no remote backend and no client secret.

**Architecture:** A new main-process module runs the OAuth dance: generate PKCE, open the system browser, catch the redirect on a one-shot `http://127.0.0.1:<port>` listener, exchange the code at the provider's token endpoint, and return tokens to the renderer over IPC. Pure helpers (PKCE, URL building, response parsing) are split into a separate CommonJS module with unit tests. The renderer's `cloud-auth.js` bindings are rewired from "fetch a remote backend" to "invoke the local IPC", which also removes the silent-failure path. The shared provider code (`packages/ui/src/cloud/providers.js`) and settings UI are untouched.

**Tech Stack:** Electron 29 (Node 20 main process: built-in `crypto`, `http`, global `fetch`), CommonJS for `electron/**`, Vitest for unit tests, React renderer (ESM).

## Global Constraints

- Desktop only (`apps/desktop`). Do not touch mobile (`apps/app`) or web (`apps/web`).
- No new runtime dependencies — use Node built-ins (`crypto`, `http`) and Electron's global `fetch`.
- `electron/**` files are CommonJS (`.cjs`, `require`/`module.exports`). Renderer files under `src/**` are ESM.
- Public client IDs only; never introduce a client secret into the desktop app.
- Google redirect host is `127.0.0.1`; Microsoft redirect host is `localhost`. Both use an OS-assigned port (`listen(0)`).
- PKCE method is always `S256`. Always send and verify the `state` parameter.
- Surface every sign-in/refresh failure to the user via `toast` — no silent `catch {}`.
- Provider key mapping is fixed: `gdrive → google`, `onedrive → microsoft`.

---

### Task 1: Pure OAuth core helpers + test harness

Sets up the desktop unit-test runner and the pure, testable OAuth building blocks (PKCE, auth-URL, token-response parsing) plus the public client-ID config file.

**Files:**
- Create: `apps/desktop/electron/ipc/oauth-config.cjs`
- Create: `apps/desktop/electron/ipc/oauth-core.cjs`
- Create: `apps/desktop/electron/ipc/oauth-core.test.js`
- Create: `apps/desktop/vitest.config.js`
- Modify: `vitest.workspace.js`

**Interfaces:**
- Produces (`oauth-core.cjs`, `module.exports`):
  - `base64url(buf: Buffer|Uint8Array): string`
  - `makePkce(): { verifier: string, challenge: string }`
  - `randomState(): string`
  - `buildAuthUrl(providerCfg, { redirectUri: string, challenge: string, state: string }): string`
  - `decodeJwtEmail(idToken: string): string | null`
  - `parseTokenResponse(json: object): { accessToken: string|null, refreshToken: string|null, email: string|null }`
  - `PROVIDERS: { google: ProviderCfg, microsoft: ProviderCfg }` where `ProviderCfg = { authEndpoint, tokenEndpoint, clientId, scope, redirectHost, authParams }`
- Produces (`oauth-config.cjs`, `module.exports`): `{ googleClientId: string, msClientId: string }`

- [ ] **Step 1: Add the desktop project to the Vitest workspace**

Modify `vitest.workspace.js` to:

```js
// Root vitest workspace — `npm test` (vitest run) discovers every package's suite.
export default [
  'packages/core',
  'packages/web-adapters',
  'packages/ui',
  'apps/desktop',
]
```

- [ ] **Step 2: Add a desktop Vitest config that runs only the electron unit tests**

Create `apps/desktop/vitest.config.js` (scopes Vitest to electron unit tests so it never picks up the Playwright specs in `e2e/`):

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['electron/**/*.test.{js,cjs}'],
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'node',
  },
})
```

- [ ] **Step 3: Create the public client-ID config file**

Create `apps/desktop/electron/ipc/oauth-config.cjs`:

```js
'use strict';

// Public OAuth *client IDs* for the desktop app. These are NOT secrets — the
// desktop app is a PKCE public client and holds no client secret. Fill these in
// with the IDs from your Google "Desktop app" OAuth client and your Azure app
// registration, or override them at runtime with the
// NEXUSMD_GOOGLE_DESKTOP_CLIENT_ID / NEXUSMD_MS_DESKTOP_CLIENT_ID env vars.
module.exports = {
  googleClientId: '',
  msClientId: '',
};
```

- [ ] **Step 4: Write the failing test for the pure helpers**

Create `apps/desktop/electron/ipc/oauth-core.test.js`:

```js
import { describe, it, expect } from 'vitest'
import core from './oauth-core.cjs'

const { base64url, makePkce, randomState, buildAuthUrl, decodeJwtEmail, parseTokenResponse, PROVIDERS } = core

describe('base64url', () => {
  it('encodes without +, / or = padding', () => {
    expect(base64url(Buffer.from('foobar'))).toBe('Zm9vYmFy')
    const enc = base64url(Buffer.from([251, 255, 191]))
    expect(enc).not.toMatch(/[+/=]/)
  })
})

describe('makePkce', () => {
  it('produces an RFC 7636 verifier and an S256 challenge derived from it', () => {
    const crypto = require('crypto')
    const { verifier, challenge } = makePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    const expected = base64url(crypto.createHash('sha256').update(verifier).digest())
    expect(challenge).toBe(expected)
  })
  it('is random per call', () => {
    expect(makePkce().verifier).not.toBe(makePkce().verifier)
  })
})

describe('randomState', () => {
  it('returns a non-empty url-safe string', () => {
    expect(randomState()).toMatch(/^[A-Za-z0-9\-_]+$/)
  })
})

describe('buildAuthUrl', () => {
  const p = {
    authEndpoint: 'https://example.com/auth',
    clientId: 'cid-123',
    scope: 'openid email scope/x',
    authParams: { access_type: 'offline', prompt: 'consent' },
  }
  it('includes PKCE, state, encoded redirect and provider extras', () => {
    const url = buildAuthUrl(p, { redirectUri: 'http://127.0.0.1:5500', challenge: 'CH', state: 'ST' })
    expect(url.startsWith('https://example.com/auth?')).toBe(true)
    expect(url).toContain('client_id=cid-123')
    expect(url).toContain('response_type=code')
    expect(url).toContain('code_challenge=CH')
    expect(url).toContain('code_challenge_method=S256')
    expect(url).toContain('state=ST')
    expect(url).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A5500')
    expect(url).toContain('scope=openid%20email%20scope%2Fx')
    expect(url).toContain('access_type=offline')
    expect(url).toContain('prompt=consent')
  })
})

describe('decodeJwtEmail', () => {
  it('reads email from a JWT payload', () => {
    const payload = core.base64url(Buffer.from(JSON.stringify({ email: 'a@b.com' })))
    expect(decodeJwtEmail(`h.${payload}.s`)).toBe('a@b.com')
  })
  it('returns null on garbage', () => {
    expect(decodeJwtEmail('not-a-jwt')).toBeNull()
  })
})

describe('parseTokenResponse', () => {
  it('maps snake_case fields and extracts email from id_token', () => {
    const idToken = `h.${core.base64url(Buffer.from(JSON.stringify({ email: 'u@x.com' })))}.s`
    const out = parseTokenResponse({ access_token: 'AT', refresh_token: 'RT', id_token: idToken })
    expect(out).toEqual({ accessToken: 'AT', refreshToken: 'RT', email: 'u@x.com' })
  })
  it('tolerates missing fields', () => {
    expect(parseTokenResponse({})).toEqual({ accessToken: null, refreshToken: null, email: null })
  })
})

describe('PROVIDERS', () => {
  it('defines google and microsoft with correct redirect hosts', () => {
    expect(PROVIDERS.google.redirectHost).toBe('127.0.0.1')
    expect(PROVIDERS.microsoft.redirectHost).toBe('localhost')
    expect(PROVIDERS.google.scope).toContain('drive.file')
    expect(PROVIDERS.microsoft.scope).toContain('Files.ReadWrite')
    expect(PROVIDERS.microsoft.scope).toContain('offline_access')
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- oauth-core`
Expected: FAIL — `Cannot find module './oauth-core.cjs'` (module not created yet).

- [ ] **Step 6: Implement the pure helpers**

Create `apps/desktop/electron/ipc/oauth-core.cjs`:

```js
'use strict';

const crypto = require('crypto');
const cfg = require('./oauth-config.cjs');

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
    clientId: process.env.NEXUSMD_GOOGLE_DESKTOP_CLIENT_ID || cfg.googleClientId || '',
    scope: 'openid email https://www.googleapis.com/auth/drive.file',
    redirectHost: '127.0.0.1',
    authParams: { access_type: 'offline', prompt: 'consent' },
  },
  microsoft: {
    authEndpoint:  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientId: process.env.NEXUSMD_MS_DESKTOP_CLIENT_ID || cfg.msClientId || '',
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
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- oauth-core`
Expected: PASS — all `oauth-core` describe blocks green.

- [ ] **Step 8: Commit**

```bash
git add vitest.workspace.js apps/desktop/vitest.config.js apps/desktop/electron/ipc/oauth-config.cjs apps/desktop/electron/ipc/oauth-core.cjs apps/desktop/electron/ipc/oauth-core.test.js
git commit -m "feat(desktop): pure PKCE/OAuth helpers + desktop vitest project"
```

---

### Task 2: Main-process OAuth flow + IPC wiring

Implements the impure OAuth flow (loopback listener, system-browser launch, token exchange/refresh), registers it as IPC handlers, and exposes it to the renderer via preload. This task's deliverable is a working main-process sign-in, so the main.cjs registration and preload bridge are folded in here.

**Files:**
- Create: `apps/desktop/electron/ipc/oauth.cjs`
- Modify: `apps/desktop/electron/main.cjs:13` (requires block) and `apps/desktop/electron/main.cjs:209-214` (register block)
- Modify: `apps/desktop/electron/preload.cjs` (cloud OAuth IPC section)

**Interfaces:**
- Consumes (from Task 1): `oauth-core.cjs` (`PROVIDERS`, `makePkce`, `randomState`, `buildAuthUrl`, `parseTokenResponse`).
- Produces (`oauth.cjs`, `module.exports`):
  - `register(ipcMain): void` — registers `oauth:signIn` and `oauth:refresh` handlers.
  - `runSignIn(provider: 'google'|'microsoft'): Promise<{ accessToken, refreshToken, email }>`
  - `runRefresh(provider, refreshToken): Promise<{ accessToken, refreshToken }>`
- Produces (preload, `window.electronAPI.oauth`):
  - `signIn(provider): Promise<{ accessToken, refreshToken, email }>`
  - `refresh(provider, refreshToken): Promise<{ accessToken, refreshToken }>`

- [ ] **Step 1: Implement the main-process OAuth module**

Create `apps/desktop/electron/ipc/oauth.cjs`:

```js
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
```

- [ ] **Step 2: Require the module in main.cjs**

In `apps/desktop/electron/main.cjs`, add to the ipc requires block (after line 14, `const trayIpc = require('./ipc/tray-ipc.cjs');`):

```js
const oauthIpc       = require('./ipc/oauth.cjs');
```

- [ ] **Step 3: Register the handlers in main.cjs**

In `apps/desktop/electron/main.cjs`, in the `app.whenReady()` block where the other IPC modules register (after line 214, `trayIpc.register(ipcMain, () => mainWindow, () => tray);`):

```js
  oauthIpc.register(ipcMain);
```

- [ ] **Step 4: Expose the bridge in preload.cjs**

In `apps/desktop/electron/preload.cjs`, in the `// ── Cloud OAuth IPC ──` section (replace the existing `openExternal`/`onDeepLink` cloud block — keep `openExternal`, add `oauth`):

```js
  // ── Cloud OAuth IPC ─────────────────────────────────────────────────────────
  // In-app PKCE OAuth: the main process runs the loopback flow and returns tokens.
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  oauth: {
    signIn:  (provider)               => ipcRenderer.invoke('oauth:signIn', provider),
    refresh: (provider, refreshToken) => ipcRenderer.invoke('oauth:refresh', { provider, refreshToken }),
  },
```

- [ ] **Step 5: Verify the app boots and handlers are registered (manual)**

Run (two terminals from repo root):

```bash
npm -w apps/desktop run dev
npm -w apps/desktop start
```

Open DevTools in the app and run in the renderer console:

```js
typeof window.electronAPI.oauth.signIn
```

Expected: `"function"`. The app launches with no main-process errors in the terminal. (Full sign-in is verified in Task 3 once the renderer is wired and client IDs are set per Task 4.)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/ipc/oauth.cjs apps/desktop/electron/main.cjs apps/desktop/electron/preload.cjs
git commit -m "feat(desktop): in-app PKCE loopback OAuth in main process + preload bridge"
```

---

### Task 3: Rewire renderer cloud-auth to the local IPC

Replaces the remote-backend bindings with calls to `window.electronAPI.oauth`, removes the `nexusmd.app` dependency and the `nexusmd://` deep-link redeem path, and surfaces failures via `toast` (fixing the silent "nothing happens").

**Files:**
- Modify: `apps/desktop/src/cloud-auth.js` (full rewrite)
- Modify: `apps/desktop/src/main.jsx:18` and `apps/desktop/src/main.jsx:62`

**Interfaces:**
- Consumes (from Task 2): `window.electronAPI.oauth.signIn(flow)`, `window.electronAPI.oauth.refresh(flow, refreshToken)`.
- Consumes (existing): `makeGoogleDriveProvider`, `makeOneDriveProvider`, `toast` from `@nexusmd/ui`; `getProfileKey` from `./profile-keys.js`.
- Produces: `desktopCloudProviders` (unchanged export name, still consumed by `main.jsx` and `sync.js`). The `registerCloudDeepLink` export is removed.

- [ ] **Step 1: Rewrite the desktop cloud-auth bindings**

Replace the entire contents of `apps/desktop/src/cloud-auth.js` with:

```js
// cloud-auth.js — desktop cloud sync auth bindings (Drive + OneDrive).
// The Electron main process runs an in-app PKCE loopback OAuth flow and returns
// tokens over IPC (window.electronAPI.oauth). No remote backend, no client
// secret. Tokens are stored per-profile in localStorage, mirroring the prior
// behaviour: nexusmd.p.<id>.gdrive.auth / .onedrive.auth = { accessToken, refreshToken, email }
import { getProfileKey } from './profile-keys.js'
import { makeGoogleDriveProvider, makeOneDriveProvider, toast } from '@nexusmd/ui'

const PROVIDERS = {
  gdrive:   { keySuffix: 'gdrive.auth',   flow: 'google',    label: 'Google Drive' },
  onedrive: { keySuffix: 'onedrive.auth', flow: 'microsoft', label: 'OneDrive' },
}

function read(suffix) {
  try { const k = getProfileKey('nexusmd.' + suffix); return k ? JSON.parse(localStorage.getItem(k) || 'null') : null }
  catch { return null }
}
function write(suffix, auth) {
  try { const k = getProfileKey('nexusmd.' + suffix); if (k) localStorage.setItem(k, JSON.stringify(auth)) } catch {}
}
function clear(suffix) {
  try { const k = getProfileKey('nexusmd.' + suffix); if (k) localStorage.removeItem(k) } catch {}
}

function makeBinding(key) {
  const cfg = PROVIDERS[key]
  return {
    isConnected: () => Boolean(read(cfg.keySuffix)?.accessToken),
    async connect() {
      try {
        const auth = await window.electronAPI.oauth.signIn(cfg.flow)
        if (!auth?.accessToken) { toast?.(`${cfg.label} sign-in failed.`, 'error'); return }
        write(cfg.keySuffix, auth)
        window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
        toast?.(`${cfg.label} connected.`, 'success')
      } catch (e) {
        toast?.(e?.message ? `${cfg.label}: ${e.message}` : `Could not sign in to ${cfg.label}.`, 'error')
      }
    },
    async disconnect() {
      clear(cfg.keySuffix)
      window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
    },
    async getToken({ force } = {}) {
      const auth = read(cfg.keySuffix)
      if (!auth?.accessToken) return null
      if (!force) return auth.accessToken
      try {
        const t = await window.electronAPI.oauth.refresh(cfg.flow, auth.refreshToken)
        if (!t?.accessToken) return null
        write(cfg.keySuffix, { ...auth, accessToken: t.accessToken, refreshToken: t.refreshToken || auth.refreshToken })
        return t.accessToken
      } catch { return null }
    },
  }
}

export const desktopCloudProviders = [
  makeGoogleDriveProvider(makeBinding('gdrive')),
  makeOneDriveProvider(makeBinding('onedrive')),
]
```

- [ ] **Step 2: Drop the deep-link import in main.jsx**

In `apps/desktop/src/main.jsx`, change line 18 from:

```js
import { desktopCloudProviders, registerCloudDeepLink } from './cloud-auth.js'
```

to:

```js
import { desktopCloudProviders } from './cloud-auth.js'
```

- [ ] **Step 3: Remove the registerCloudDeepLink() call in main.jsx**

In `apps/desktop/src/main.jsx`, delete line 62:

```js
registerCloudDeepLink()
```

- [ ] **Step 4: Verify the renderer builds with no dangling references**

Run: `npm -w apps/desktop run build`
Expected: build succeeds. Confirm no remaining references to the removed symbol:

Run: `git grep -n "registerCloudDeepLink\|nexusmd.app\|native-url" apps/desktop/src`
Expected: no output.

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS — including the `oauth-core` suite from Task 1; existing `packages/ui` cloud/provider tests remain green (their code is unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/cloud-auth.js apps/desktop/src/main.jsx
git commit -m "feat(desktop): rewire cloud sign-in to in-app OAuth IPC; surface errors"
```

---

### Task 4: Document desktop OAuth setup and verify end-to-end

Documents the one-time developer console setup and client-ID configuration, then verifies the full flow against real providers.

**Files:**
- Modify: `README.md` (Desktop section)

**Interfaces:**
- Consumes: `oauth-config.cjs` / env vars from Task 1; the working flow from Tasks 2–3.

- [ ] **Step 1: Add a "Cloud sign-in" subsection to the README Desktop section**

In `README.md`, immediately after the Desktop "Dev build" subsection (after line 87, the `Start-Dev.ps1` note), insert:

```markdown
### Cloud sign-in (Google Drive / OneDrive)

The desktop app signs in to Google Drive and OneDrive itself using the OAuth
PKCE + loopback flow in the Electron main process — no backend and no client
secret. You need public **client IDs** from each provider:

- **Google:** Google Cloud Console → APIs & Services → Credentials → Create
  OAuth client ID → application type **Desktop app**. Loopback redirects are
  allowed automatically (no redirect URI to register). Enable the Drive API and
  add the `drive.file` / `email` / `openid` scopes on the OAuth consent screen
  (add yourself as a test user if the app is in Testing).
- **Microsoft (OneDrive):** Azure Portal → App registrations → New
  registration. Under **Authentication** → Add a platform → **Mobile and desktop
  applications**, add redirect URI `http://localhost`, and set **Allow public
  client flows** to **Yes**. Supported account types must include **personal
  Microsoft accounts**. Under **API permissions**, add delegated Microsoft Graph
  `Files.ReadWrite`, `offline_access`, `openid`, `email`.

Put the resulting client IDs in `apps/desktop/electron/ipc/oauth-config.cjs`
(they are public, not secrets), or set the `NEXUSMD_GOOGLE_DESKTOP_CLIENT_ID`
and `NEXUSMD_MS_DESKTOP_CLIENT_ID` environment variables before launching.
```

- [ ] **Step 2: Commit the docs**

```bash
git add README.md
git commit -m "docs(desktop): document in-app cloud OAuth setup"
```

- [ ] **Step 3: End-to-end verification (manual)**

Prerequisites: client IDs filled in per Step 1.

1. Launch: `npm -w apps/desktop run dev` and `npm -w apps/desktop start`.
2. Settings → cloud sync card → **Connect Google Drive**.
   - Expected: the system browser opens Google's consent screen; after approving,
     the browser shows "You can return to NexusMD now."; the app shows a "Google
     Drive connected." toast; the card flips to the connected state.
3. Repeat with **Connect OneDrive** (Microsoft consent screen).
4. Run a sync round-trip: save a backup to the provider, confirm it appears in
   the provider's `NexusMD` folder, then restore it.
5. Force a refresh path: with a profile already connected, leave the app long
   enough for the access token to expire (or temporarily corrupt the stored
   `accessToken` in DevTools localStorage) and trigger a sync; confirm the
   401 → refresh → retry path in `providers.js` succeeds.
6. Failure surfacing: temporarily blank a client ID in `oauth-config.cjs`,
   restart, click Connect, and confirm a visible error toast (no silent failure).

---

## Self-Review

**Spec coverage:**
- PKCE + loopback flow in main process → Task 2 (`oauth.cjs`). ✓
- Pure helpers, unit-tested, no new deps → Task 1. ✓
- Generic helper for both providers (`PROVIDERS`) → Task 1/2. ✓
- Preload bridge → Task 2. ✓
- Renderer rewire + provider mapping (`gdrive→google`, `onedrive→microsoft`) → Task 3. ✓
- Remove `nexusmd.app` / `native-url` / `exchange` / `nexusmd://` cloud path → Task 3 (verified by grep in Task 3 Step 4). ✓
- Fix silent failure → Task 3 (`toast` in `connect`). ✓
- Client-ID config via env + committed file → Task 1 (`oauth-config.cjs`). ✓
- Error handling: timeout, state mismatch, token non-2xx, missing client ID → Task 2 (`oauth.cjs`). ✓
- External console setup documented → Task 4. ✓
- Out of scope (mobile, web, history scrub, backend endpoint removal) → untouched. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code. ✓

**Type consistency:** `signIn` → `{ accessToken, refreshToken, email }` (written verbatim by renderer `connect`); `refresh` → `{ accessToken, refreshToken }` (consumed by renderer `getToken`); preload `signIn(provider)` / `refresh(provider, refreshToken)` match handler arities (`oauth:signIn` takes a bare provider string; `oauth:refresh` takes `{ provider, refreshToken }`). `PROVIDERS` keys `google`/`microsoft` match the renderer `flow` values. ✓
