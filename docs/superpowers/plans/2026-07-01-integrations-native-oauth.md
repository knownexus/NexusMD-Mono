# Integrations Native OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Integrations' Google connect through the existing native OAuth flow, add a native Microsoft/Entra flow (one connection for OneDrive + Calendar, also fixing OneDrive cloud sync), and remove the redundant broken ADO/GitHub OAuth buttons while keeping their PAT paths.

**Architecture:** Reuse the provider-generic native OAuth engine built in `feat/desktop-google-oauth`. Generalize the token-endpoint module to support secret-less (PKCE public) clients and rotated refresh tokens, add a `microsoft` provider to config, generalize the renderer binding to any provider, make the shared OAuth card tolerate providers without credential fields, and update the Integrations panel wiring.

**Tech Stack:** Electron 43 (Node 20, global `fetch`), electron-log v5, Node `crypto`/`http`, React, Vitest.

## Global Constraints

- Electron 43 / Node 20 — global `fetch` available in the main process; no `https` fallback.
- Main-process modules under `apps/desktop/electron/` are **CommonJS** (`.cjs`). Renderer (`apps/desktop/src/`) and `packages/ui/src/` are **ESM**.
- Test files exercising `.cjs` modules MUST start with `// @vitest-environment node`. Renderer/UI tests use the default jsdom env (no pragma).
- `vi.mock` does NOT intercept CJS `require()` in `.cjs` modules — use injectable dependencies (existing pattern) or `Module.prototype.require` interception, never `vi.mock`, for `.cjs`. ESM modules mock normally.
- Run tests from `apps/desktop/`: `npx vitest run <path>`. For `packages/ui` tests, run from `packages/ui/`: `npx vitest run <path>`.
- Microsoft Graph scopes (exact): `offline_access`, `Files.ReadWrite`, `Calendars.ReadWrite`, `User.Read`. Entra endpoints on `login.microsoftonline.com/common/oauth2/v2.0/{authorize,token}`.
- Microsoft is a **public client**: no client secret; PKCE only. Entra **rotates** the refresh token on each refresh — the new one must be persisted.
- Credentials live in `config.cjs` (placeholder `<PASTE_ENTRA_CLIENT_ID>` for Microsoft; Google already set). Never log token or secret values.
- **Do NOT modify `apps/desktop/src/main.jsx`** — it is concurrently edited by another session. `makeDesktopOAuthService` MUST remain exported (main.jsx:121 uses it for a GitHub token-health check).
- Token storage shape: `{ accessToken, refreshToken, expiresAt }` under localStorage suffix `<provider>.auth`. Proactive refresh within 60s of `expiresAt`.
- Work on branch `feat/desktop-google-oauth` (continues the prior feature). Commit after every task; stage only each task's own files (explicit `git add`, never `-A`/`.` — the working tree has unrelated changes).

## File Structure

- Rename `apps/desktop/electron/oauth/google.cjs` → `endpoints.cjs` (+ test); make secret optional + rotated-refresh aware.
- Modify `apps/desktop/electron/ipc/oauth.cjs` — update the require path to `endpoints.cjs`.
- Modify `apps/desktop/electron/oauth/config.cjs` — add `microsoft` provider.
- Modify `apps/desktop/src/cloud-auth.js` — `makeNativeBinding({provider,suffix})`, google/microsoft convenience bindings, wire OneDrive to microsoft.
- Modify `packages/ui/src/views/view-settings.jsx` — `OAuthServiceCard` tolerates absent `credFields`/`loadCreds`/`saveCreds`.
- Modify `apps/desktop/src/desktop-settings.jsx` — Integrations: native google/microsoft, remove ado/github OAuth entries + credFields.

---

### Task 1: Generalize token endpoints (rename + secret-optional + rotated refresh)

**Files:**
- Rename: `apps/desktop/electron/oauth/google.cjs` → `apps/desktop/electron/oauth/endpoints.cjs`
- Rename: `apps/desktop/electron/oauth/google.test.js` → `apps/desktop/electron/oauth/endpoints.test.js`
- Modify: `apps/desktop/electron/ipc/oauth.cjs:7` (require path)

**Interfaces:**
- Consumes: config provider shape `{clientId, clientSecret, authUrl, tokenUrl, scopes, authParams}` (clientSecret may be `''`).
- Produces (unchanged names):
  - `buildAuthUrl(cfg, {redirectUri, challenge, state}) => string`
  - `exchangeCode(cfg, {code, verifier, redirectUri}, fetchImpl?) => Promise<{accessToken, refreshToken, expiresAt}>`
  - `refreshAccessToken(cfg, refreshToken, fetchImpl?) => Promise<{accessToken, expiresAt, refreshToken?}>` — `refreshToken` key present only when the response includes a new one.

- [ ] **Step 1: Rename the files with git (preserve history)**

Run from repo root:
```bash
git mv apps/desktop/electron/oauth/google.cjs apps/desktop/electron/oauth/endpoints.cjs
git mv apps/desktop/electron/oauth/google.test.js apps/desktop/electron/oauth/endpoints.test.js
```

- [ ] **Step 2: Update the import in the renamed test**

In `apps/desktop/electron/oauth/endpoints.test.js`, change the import source from `./google.cjs` to `./endpoints.cjs`:
```js
import { buildAuthUrl, exchangeCode, refreshAccessToken } from './endpoints.cjs'
```

- [ ] **Step 3: Update the require in the IPC orchestrator**

In `apps/desktop/electron/ipc/oauth.cjs`, line 7, change:
```js
const google = require('../oauth/google.cjs');
```
to:
```js
const google = require('../oauth/endpoints.cjs');
```
(Leave the local variable name `google` and its `.buildAuthUrl`/`.exchangeCode`/`.refreshAccessToken` usages as-is — only the path changes.)

- [ ] **Step 4: Add failing tests for secret-optional + rotated refresh**

Append these tests to `apps/desktop/electron/oauth/endpoints.test.js` (inside the existing top-level `describe` blocks or as new ones):
```js
describe('public client (no secret)', () => {
  it('omits client_secret when cfg.clientSecret is empty', async () => {
    const publicCfg = { ...cfg, clientSecret: '' }
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }) }))
    await exchangeCode(publicCfg, { code: 'C', verifier: 'V', redirectUri: 'x' }, fetchImpl)
    const body = fetchImpl.mock.calls[0][1].body
    expect(body.has('client_secret')).toBe(false)
    expect(body.get('client_id')).toBe('cid')
  })

  it('includes client_secret when set', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT', expires_in: 3600 }) }))
    await exchangeCode(cfg, { code: 'C', verifier: 'V', redirectUri: 'x' }, fetchImpl)
    expect(fetchImpl.mock.calls[0][1].body.get('client_secret')).toBe('secret')
  })
})

describe('refreshAccessToken rotation', () => {
  it('returns a rotated refreshToken when the response includes one', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }) }))
    const out = await refreshAccessToken(cfg, 'RT', fetchImpl)
    expect(out.accessToken).toBe('AT2')
    expect(out.refreshToken).toBe('RT2')
  })

  it('omits refreshToken when the response has none', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT2', expires_in: 3600 }) }))
    const out = await refreshAccessToken(cfg, 'RT', fetchImpl)
    expect(out.accessToken).toBe('AT2')
    expect('refreshToken' in out).toBe(false)
  })
})
```

- [ ] **Step 5: Run tests to verify the new ones fail**

Run: `npx vitest run electron/oauth/endpoints.test.js`
Expected: the 4 new tests FAIL (current code always sends `client_secret` and never returns `refreshToken` from refresh); existing tests still pass.

- [ ] **Step 6: Implement secret-optional + rotated refresh in `endpoints.cjs`**

Replace the bodies of `exchangeCode` and `refreshAccessToken` so the secret is conditional and refresh surfaces a rotated token. Full file:
```js
// apps/desktop/electron/oauth/endpoints.cjs
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
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (cfg.clientSecret) params.set('client_secret', cfg.clientSecret);
  const j = await postForm(cfg.tokenUrl, params, fetchImpl);
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (j.expires_in || 0) * 1000 };
}

async function refreshAccessToken(cfg, refreshToken, fetchImpl = fetch) {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (cfg.clientSecret) params.set('client_secret', cfg.clientSecret);
  const j = await postForm(cfg.tokenUrl, params, fetchImpl);
  const out = { accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in || 0) * 1000 };
  if (j.refresh_token) out.refreshToken = j.refresh_token;
  return out;
}

module.exports = { buildAuthUrl, exchangeCode, refreshAccessToken };
```

- [ ] **Step 7: Run tests to verify all pass**

Run: `npx vitest run electron/oauth/endpoints.test.js electron/ipc/oauth.test.js`
Expected: all pass (endpoints incl. 4 new; oauth ipc still green via its require of the renamed module).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/electron/oauth/endpoints.cjs apps/desktop/electron/oauth/endpoints.test.js apps/desktop/electron/ipc/oauth.cjs
git commit -m "refactor(desktop): generalize oauth endpoints (secret-optional, rotated refresh)"
```

---

### Task 2: Add the Microsoft/Entra provider to config

**Files:**
- Modify: `apps/desktop/electron/oauth/config.cjs`
- Modify: `apps/desktop/electron/oauth/config.test.js`

**Interfaces:**
- Produces: `config.microsoft = { clientId, clientSecret:'', authUrl, tokenUrl, scopes[], authParams:{} }`.

- [ ] **Step 1: Add a failing test for the microsoft provider**

Append to `apps/desktop/electron/oauth/config.test.js` (inside the existing describe):
```js
it('defines the microsoft provider as a public client with Graph scopes', () => {
  const m = config.microsoft
  expect(m.authUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
  expect(m.tokenUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
  expect(m.scopes).toEqual(['offline_access', 'Files.ReadWrite', 'Calendars.ReadWrite', 'User.Read'])
  expect(m.clientSecret).toBe('')          // public client — PKCE, no secret
  expect(m.authParams).toEqual({})
  expect(typeof m.clientId).toBe('string')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/oauth/config.test.js`
Expected: FAIL — `config.microsoft` is undefined.

- [ ] **Step 3: Add the microsoft provider**

In `apps/desktop/electron/oauth/config.cjs`, add a `microsoft` key alongside `google` inside `module.exports`:
```js
  microsoft: {
    clientId:     process.env.MS_DESKTOP_CLIENT_ID || '<PASTE_ENTRA_CLIENT_ID>',
    clientSecret: '',                                   // public client — PKCE, no secret
    authUrl:  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'Files.ReadWrite', 'Calendars.ReadWrite', 'User.Read'],
    authParams: {},
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/oauth/config.test.js`
Expected: PASS (existing google test + new microsoft test).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/oauth/config.cjs apps/desktop/electron/oauth/config.test.js
git commit -m "feat(desktop): add Microsoft/Entra OAuth provider config"
```

---

### Task 3: Generalize the renderer binding + wire OneDrive to Microsoft

**Files:**
- Modify: `apps/desktop/src/cloud-auth.js`
- Modify: `apps/desktop/src/cloud-auth.test.js`

**Interfaces:**
- Consumes: `window.electronAPI.oauth.start(provider)` / `.refresh(refreshToken, provider)` (already provider-aware from the preload bridge).
- Produces:
  - `makeNativeBinding({ provider, suffix }) => { isConnected, connect, disconnect, getToken }`
  - `makeNativeGoogleBinding()` = `makeNativeBinding({ provider:'google', suffix:'google.auth' })`
  - `makeNativeMicrosoftBinding()` = `makeNativeBinding({ provider:'microsoft', suffix:'microsoft.auth' })`
  - `desktopCloudProviders` = Drive→google binding, OneDrive→microsoft binding.

- [ ] **Step 1: Write failing tests**

Add to `apps/desktop/src/cloud-auth.test.js`:
```js
import { makeNativeMicrosoftBinding } from './cloud-auth.js'

describe('makeNativeMicrosoftBinding', () => {
  const KEY = 'nexusmd.microsoft.auth'
  beforeEach(() => {
    localStorage.clear()
    window.electronAPI = { oauth: { start: vi.fn(), refresh: vi.fn() } }
  })

  it('connect stores tokens under microsoft.auth', async () => {
    window.electronAPI.oauth.start.mockResolvedValue({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 42 })
    await makeNativeMicrosoftBinding().connect()
    expect(window.electronAPI.oauth.start).toHaveBeenCalledWith('microsoft')
    expect(JSON.parse(localStorage.getItem(KEY))).toMatchObject({ accessToken: 'AT', refreshToken: 'RT' })
  })

  it('persists a rotated refresh token on refresh', async () => {
    localStorage.setItem(KEY, JSON.stringify({ accessToken: 'old', refreshToken: 'RT1', expiresAt: Date.now() - 1000 }))
    window.electronAPI.oauth.refresh.mockResolvedValue({ accessToken: 'new', refreshToken: 'RT2', expiresAt: Date.now() + 3_600_000 })
    const tok = await makeNativeMicrosoftBinding().getToken()
    expect(window.electronAPI.oauth.refresh).toHaveBeenCalledWith('RT1', 'microsoft')
    expect(tok).toBe('new')
    expect(JSON.parse(localStorage.getItem(KEY)).refreshToken).toBe('RT2')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cloud-auth.test.js`
Expected: FAIL — `makeNativeMicrosoftBinding` is not exported.

- [ ] **Step 3: Generalize the binding**

In `apps/desktop/src/cloud-auth.js`, replace the existing `makeNativeGoogleBinding` function (around line 115) with a generic factory plus two convenience wrappers. The generic `connect`/`getToken` pass the provider to the bridge and persist a rotated refresh token when present:
```js
// Native desktop OAuth binding for any provider whose flow runs in the Electron
// main process (PKCE loopback). `provider` is passed to the IPC bridge; tokens are
// stored under localStorage `suffix`. Handles providers that rotate refresh tokens.
export function makeNativeBinding({ provider, suffix }) {
  return {
    isConnected: () => Boolean(read(suffix)?.accessToken),
    async connect() {
      try {
        console.info(`[cloud-auth] Initiating ${provider} OAuth connection (native)`)
        const tokens = await window.electronAPI.oauth.start(provider)
        write(suffix, tokens)
        console.info(`[cloud-auth] ${provider} OAuth connected`)
        window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
      } catch (err) {
        console.error(`[cloud-auth] Failed to connect ${provider}:`, err?.stack || err)
        toast?.('Sign-in failed. Please try again.', 'error')
      }
    },
    async disconnect() { clear(suffix) },
    async getToken({ force } = {}) {
      const auth = read(suffix)
      if (!auth?.accessToken) return null
      const expired = auth.expiresAt && Date.now() > auth.expiresAt - 60_000
      if (!force && !expired) return auth.accessToken
      try {
        const next = await window.electronAPI.oauth.refresh(auth.refreshToken, provider)
        if (!next?.accessToken) return force ? null : auth.accessToken
        write(suffix, { ...auth, ...next })   // ...next carries a rotated refreshToken when present
        return next.accessToken
      } catch (err) {
        console.error(`[cloud-auth] ${provider} token refresh failed:`, err?.stack || err)
        return force ? null : auth.accessToken
      }
    },
  }
}

export function makeNativeGoogleBinding() {
  return makeNativeBinding({ provider: 'google', suffix: 'google.auth' })
}
export function makeNativeMicrosoftBinding() {
  return makeNativeBinding({ provider: 'microsoft', suffix: 'microsoft.auth' })
}
```

- [ ] **Step 4: Wire OneDrive to the Microsoft binding**

In `apps/desktop/src/cloud-auth.js`, change `desktopCloudProviders` (around line 150):
```js
export const desktopCloudProviders = [
  makeGoogleDriveProvider(makeNativeGoogleBinding()),
  makeOneDriveProvider(makeNativeMicrosoftBinding()),
]
```
(Leave `makeBinding` and `makeDesktopOAuthService` in the file — still used elsewhere.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/cloud-auth.test.js`
Expected: PASS — existing google-binding tests + the 2 new microsoft tests. The prior `oauth.refresh` call now passes `provider` as a second arg; confirm the existing google refresh test still passes (it asserted `toHaveBeenCalledWith('r')` — update that existing assertion to `toHaveBeenCalledWith('r', 'google')` if present).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/cloud-auth.js apps/desktop/src/cloud-auth.test.js
git commit -m "feat(desktop): generalize native OAuth binding; wire OneDrive to Microsoft"
```

---

### Task 4: Make the shared OAuth card tolerate providers without credential fields

**Files:**
- Modify: `packages/ui/src/views/view-settings.jsx` (the `OAuthServiceCard` component, ~line 618-745)
- Test: `packages/ui/tests/oauth-service-card.test.jsx` (create)

**Interfaces:**
- Consumes: `service` object. `credFields`/`loadCreds`/`saveCreds` become OPTIONAL. When `credFields` is absent/empty, the card renders no credential inputs and enables Connect directly.
- Produces: unchanged rendering contract for services that DO pass `credFields`.

- [ ] **Step 1: Write a failing test**

Create `packages/ui/tests/oauth-service-card.test.jsx`:
```jsx
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { IntegrationsView } from '../src/views/view-settings.jsx'

afterEach(() => cleanup())

describe('OAuthServiceCard without credFields', () => {
  it('renders Connect (no credential inputs) when the service has no credFields', () => {
    const service = {
      id: 'google', label: 'Google', icon: 'calendar', desc: 'Google stuff',
      isConnected: () => false, connect: vi.fn(), disconnect: vi.fn(),
      // no credFields / loadCreds / saveCreds
    }
    render(<IntegrationsView services={[service]} />)
    expect(screen.getByText('Google')).toBeTruthy()
    // The connect button is present and not gated behind credential inputs
    expect(screen.getByRole('button', { name: /connect/i })).toBeTruthy()
    // No credential textboxes rendered
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/ui/`): `npx vitest run tests/oauth-service-card.test.jsx`
Expected: FAIL — `OAuthServiceCard` calls `credFields.every(...)`/`credFields.map(...)` and throws on undefined, or `loadCreds()` throws.

- [ ] **Step 3: Make credFields/loadCreds/saveCreds optional**

In `packages/ui/src/views/view-settings.jsx`, in the `OAuthServiceCard` component:
1. Default the destructured props:
```js
  const {
    isConnected, connect, disconnect,
    credFields = [], loadCreds, saveCreds,
    children,
    // ...existing (id, label, icon, desc)
  } = service;
```
2. Guard the creds-load effect so it no-ops without `loadCreds`:
```js
  React.useEffect(() => {
    if (!loadCreds) return;
    const result = loadCreds();
    // ...existing body...
  }, [loadCreds]);
```
3. `allCredsFilled` is already `credFields.every(...)` → with `credFields = []` it evaluates to `true` (connect enabled). Keep it.
4. Only render the credentials block when there are fields:
```js
  {credFields.length > 0 && (
    <>
      {credFields.map(f => ( /* ...existing input row... */ ))}
      {/* existing Save creds button */}
    </>
  )}
```
(Preserve the existing markup inside; only wrap it in the `credFields.length > 0 &&` guard. Leave the connect/disconnect rows and `{children}` unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/ui/`): `npx vitest run tests/oauth-service-card.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the existing settings/integration tests for regressions**

Run (from `packages/ui/`): `npx vitest run tests/`
Expected: existing suites still pass (services that pass `credFields` unaffected).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-settings.jsx packages/ui/tests/oauth-service-card.test.jsx
git commit -m "feat(ui): OAuthServiceCard supports services without credential fields"
```

---

### Task 5: Rewire the Integrations panel (native Google/Microsoft; remove ADO/GitHub OAuth + cred UI)

**Files:**
- Modify: `apps/desktop/src/desktop-settings.jsx` (the `IntegrationsPanel` `oauthServices`, ~line 413-476)
- Modify: `apps/desktop/src/desktop-settings.test.jsx` (add assertions) — if a suitable test file exists; otherwise create `apps/desktop/src/IntegrationsPanel.test.jsx`

**Interfaces:**
- Consumes: `makeNativeGoogleBinding`, `makeNativeMicrosoftBinding` from `./cloud-auth.js`; `IntegrationsView` from `@nexusmd/ui`.
- Produces: `oauthServices` = exactly two entries — Google (native google binding) and Microsoft (native microsoft binding) — each without `credFields`. GitHub keeps its PAT children under one of these? No: GitHub/ADO PAT rows move out of the removed OAuth entries (see Step 3).

- [ ] **Step 1: Write failing assertions**

Add to the desktop-settings test (create `apps/desktop/src/IntegrationsPanel.test.jsx` if none exists):
```jsx
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('@nexusmd/ui', async (orig) => ({
  ...(await orig()),
  IntegrationsView: ({ services }) => (
    <div>{services.map(s => <div key={s.id} data-testid={`svc-${s.id}`}>{s.label}</div>)}</div>
  ),
}))
const startSpy = vi.fn()
vi.mock('./cloud-auth.js', () => ({
  makeNativeGoogleBinding: () => ({ id: 'google', isConnected: () => false, connect: vi.fn(), disconnect: vi.fn() }),
  makeNativeMicrosoftBinding: () => ({ id: 'microsoft', isConnected: () => false, connect: vi.fn(), disconnect: vi.fn() }),
  makeDesktopOAuthService: () => ({ isConnected: () => false, connect: vi.fn(), disconnect: vi.fn() }),
  desktopCloudProviders: [],
}))

import { IntegrationsPanel } from './desktop-settings.jsx'

afterEach(() => cleanup())

describe('IntegrationsPanel OAuth services', () => {
  it('offers exactly Google and Microsoft native connects (no ado/github OAuth entries)', () => {
    render(<IntegrationsPanel />)
    expect(screen.getByTestId('svc-google')).toBeTruthy()
    expect(screen.getByTestId('svc-microsoft')).toBeTruthy()
    expect(screen.queryByTestId('svc-ado')).toBeNull()
    expect(screen.queryByTestId('svc-github')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/IntegrationsPanel.test.jsx`
Expected: FAIL — current panel has 4 OAuth entries incl. `ado`/`github`.

- [ ] **Step 3: Rewrite `oauthServices` in `IntegrationsPanel`**

In `apps/desktop/src/desktop-settings.jsx`:
1. Update the import to add the native bindings:
```js
import { desktopCloudProviders, makeDesktopOAuthService, makeNativeGoogleBinding, makeNativeMicrosoftBinding } from './cloud-auth.js'
```
2. Replace the `oauthServices` array (currently `ado`, `microsoft`, `gdrive`, `github` entries, each with `credFields`) with two native entries and no `credFields`:
```js
  const oauthServices = React.useMemo(() => [
    {
      id: 'google',
      label: 'Google',
      icon: 'calendar',
      desc: 'Google Calendar, Gmail, and Drive',
      ...makeNativeGoogleBinding(),
    },
    {
      id: 'microsoft',
      label: 'Microsoft / Entra ID',
      icon: 'mail',
      desc: 'Sign in with Microsoft — OneDrive, Teams, Calendar',
      ...makeNativeMicrosoftBinding(),
    },
  ], [])
```
3. The GitHub PAT rows and ADO connection previously nested under the removed OAuth entries' `children` must remain reachable. Move `<DesktopGitHubPATRow />` and the GitHub repos row (currently inside the github entry's `children`, ~line 457-471) to render directly in `IntegrationsPanel`'s returned JSX, below `<IntegrationsView services={oauthServices} />` (find the `return (...)` of `IntegrationsPanel` near the `IntegrationsView` usage and place the PAT/repos rows after it). If ADO had a PAT/connection child, likewise keep it rendered directly. Do NOT remove `DesktopGitHubPATRow` or the ADO card — only detach them from the deleted OAuth entries.

- [ ] **Step 4: Run the panel test + the desktop suite**

Run: `npx vitest run src/IntegrationsPanel.test.jsx`
Expected: PASS.
Then run the full desktop suite to catch fallout: `npx vitest run`
Expected: all pass. If any existing desktop-settings test referenced the removed `ado`/`github` OAuth entries or `credFields`, update it to match the new two-entry panel (adjust assertions to the native google/microsoft entries; keep PAT-row assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/desktop-settings.jsx apps/desktop/src/IntegrationsPanel.test.jsx apps/desktop/src/desktop-settings.test.jsx
git commit -m "feat(desktop): Integrations uses native Google/Microsoft; drop redundant ADO/GitHub OAuth + cred UI"
```
(Only include `desktop-settings.test.jsx` in the add if you modified it.)

---

### Task 6: Full verification + Entra registration + E2E (human)

**Files:** none (verification + user configuration)

- [ ] **Step 1: Run the full desktop + ui suites**

Run (from `apps/desktop/`): `npx vitest run` → all pass.
Run (from `packages/ui/`): `npx vitest run` → all pass.

- [ ] **Step 2: Register the Entra app (Azure portal)**

  - Azure portal → **App registrations** → New registration.
  - **Supported account types:** personal + work/school as needed (this maps to the `/common` authority already in config).
  - **Platform:** Add a platform → **Mobile and desktop applications** → add redirect URIs **`http://localhost`** and **`http://127.0.0.1`** (register both; Entra matches any loopback port).
  - **API permissions:** Microsoft Graph → **Delegated** → add `Files.ReadWrite`, `Calendars.ReadWrite`, `User.Read`, `offline_access`. Grant consent (or consent at first sign-in as the user).
  - Copy the **Application (client) ID**.

- [ ] **Step 3: Paste the client ID**

Edit `apps/desktop/electron/oauth/config.cjs`, replace `<PASTE_ENTRA_CLIENT_ID>` with the Application (client) ID (or set `MS_DESKTOP_CLIENT_ID` in the build env). No client secret.

- [ ] **Step 4: Manual E2E**

Rebuild/relaunch the app. In **Settings → Integrations**:
  - **Connect Microsoft** → system browser shows the Microsoft consent (OneDrive + Calendar + sign-in) → approve → "Sign-in complete" → panel shows Microsoft connected; tokens stored under `microsoft.auth`.
  - **OneDrive cloud sync** (Backup/Restore or Cloud Sync card) now works against the same connection — a `.nmdprofile` round-trips to OneDrive `/NexusMD`.
  - **Connect Google** in Integrations shares the existing Drive connection (no re-consent if already connected).
  - ADO and GitHub show only their PAT entry (no broken OAuth button).
  - The log viewer shows the `[oauth]` step trail for the Microsoft flow.
  - **Loopback host caveat:** if Entra rejects the redirect, confirm both `http://localhost` and `http://127.0.0.1` are registered; the server uses `127.0.0.1`.

- [ ] **Step 5: Commit the client ID**

```bash
git add apps/desktop/electron/oauth/config.cjs
git commit -m "chore(desktop): set Entra desktop OAuth client id"
```

---

## Self-Review Notes

- **Spec coverage:** Google-in-Integrations native (Task 5); Microsoft native flow (Tasks 1-3,5), one `microsoft.auth` connection for OneDrive+Calendar incl. OneDrive cloud-sync fix (Task 3); ADO/GitHub OAuth removal + PAT kept (Task 5); credentials in config + cred UI removed (Tasks 2,4,5); secret-optional + rotated refresh for public client (Task 1); Entra setup + loopback caveat (Task 6). `makeDesktopOAuthService` kept and `main.jsx` untouched (Global Constraints, Task 3 note).
- **Type consistency:** `{accessToken, refreshToken, expiresAt}` end to end; `refreshAccessToken` adds `refreshToken` only when rotated; binding merge `{...auth, ...next}` preserves the old token when not rotated. `oauth.start(provider)`/`oauth.refresh(refreshToken, provider)` match the preload bridge signatures.
- **No placeholders:** the only `<PASTE_...>` marker is the intentional Entra client-id slot filled in Task 6.
