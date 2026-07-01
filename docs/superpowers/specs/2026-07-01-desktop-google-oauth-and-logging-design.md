# Desktop Google OAuth (native PKCE) + Comprehensive Logging — Design

**Date:** 2026-07-01
**Status:** Approved (pending spec review)
**Scope:** `apps/desktop` (desktop platform only; web is a separate future effort)

## Context

The desktop app's cloud sign-in (`apps/desktop/src/cloud-auth.js`) assumes a backend at
`https://nexusmd.app` that brokers OAuth (`/api/<provider>/auth/native-url|exchange|refresh`)
and redirects back through the `nexusmd://` custom protocol. **That backend does not exist**
— `nexusmd.app` doesn't resolve (DNS `NXDOMAIN`) — so every `connect()` fails with
`TypeError: Failed to fetch`. This surfaced in the in-app log viewer as
`[cloud-auth] Failed to initiate gdrive connection: Failed to fetch`.

The user has a Google Cloud **Desktop** OAuth client and wants Google sign-in to work on
desktop (priority), covering **Google Drive, Gmail, and Google Calendar**. There is no backend
to build against, and none is wanted for desktop.

Separately, the logging that made this diagnosable is too shallow: errors are logged as
`err.message` only, and several `catch {}` blocks swallow failures silently.

### Goals

1. Google sign-in works on desktop with **no backend**, using the native "OAuth 2.0 for Native
   Apps" (RFC 8252) PKCE + loopback flow, granting Drive + Gmail + Calendar in one consent.
2. Logging is comprehensive: full errors, no silent catches, scoped `[area]` tags, and
   lifecycle/IPC coverage — so failures like the above are self-explanatory.

### Non-goals (explicit)

- Building Gmail/Calendar **features** — only the auth/scopes so tokens are usable later.
- OneDrive/Microsoft and the web platform — left as-is for now (noted as follow-ups).
- Migrating token storage to OS keychain — noted as a future hardening step.

## Approach

**Native PKCE loopback in the Electron main process.** Main runs the whole flow (Node → no
CORS, can host a loopback server); the renderer stays thin and stores tokens under the existing
contract, so `packages/ui/src/cloud/providers.js` is untouched.

```
renderer (cloud-auth.js)                   main process (new electron/oauth/*)
  connect()          ──IPC oauth:start────▶ 1. PKCE: verifier / challenge(S256) / state
                                            2. loopback server on http://127.0.0.1:0
                                            3. shell.openExternal(Google auth URL)
       system browser ──user consents─────▶ 4. Google → http://127.0.0.1:<port>/?code&state
                                            5. validate state; exchange code → tokens
  ◀───{accessToken,refreshToken,expiresAt}─ 6. return tokens (server closes)
  write('google.auth', tokens)              (localStorage — unchanged provider contract)

  getToken({force}) ──IPC oauth:refresh───▶ POST grant_type=refresh_token → new access token
```

## Connection model

One **Google** connection, stored under suffix `google.auth` as
`{ accessToken, refreshToken, expiresAt }`, requesting all three scopes together. The Drive
provider (and future Gmail/Calendar consumers) share this single token. The old per-provider
`gdrive.auth` path is retired for Google; no migration needed (it never produced valid tokens).

**Scopes:**
- `https://www.googleapis.com/auth/drive` (full)
- `https://www.googleapis.com/auth/gmail.modify` (read/write, no permanent delete)
- `https://www.googleapis.com/auth/calendar` (full read/write)

## Components

All new files under `apps/desktop/electron/`:

- **`oauth/config.cjs`** — committed provider config. Credentials are committed per user's
  choice (Google treats native-app secrets as non-confidential). **Placeholders on first
  commit; user pastes real Desktop `clientId`/`clientSecret`.**
  ```js
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
      authParams: { access_type: 'offline', prompt: 'consent' }, // always returns refresh_token
    },
  }
  ```
- **`oauth/pkce.cjs`** — `crypto`-based: `verifier = base64url(randomBytes(32))`,
  `challenge = base64url(sha256(verifier))`, `state = base64url(randomBytes(16))`. Pure/testable.
- **`oauth/loopback.cjs`** — `http.createServer` on `127.0.0.1:0`. On the redirect request:
  validate `state`, serve a "Sign-in complete — you can close this tab" HTML page, resolve the
  `code`; on `?error=`, reject. Exposes `{ port, waitForCode({state, timeoutMs}), close() }`.
  Default timeout 300s; `close()` idempotent.
- **`oauth/google.cjs`** — pure request builders + I/O:
  `buildAuthUrl(cfg, {redirectUri, challenge, state})`,
  `exchangeCode(cfg, {code, verifier, redirectUri})`,
  `refreshToken(cfg, refreshToken)`. Uses main-process global `fetch` (Electron ≥28 / Node ≥18;
  fallback to `https` if the shipped Electron predates global fetch — verify at implementation).
- **`ipc/oauth.cjs`** — registers handlers via a logging wrapper:
  - `oauth:start` → pkce → loopback → openExternal → waitForCode → exchangeCode →
    `{accessToken, refreshToken, expiresAt: Date.now()+expires_in*1000}`; `close()` in `finally`.
  - `oauth:refresh` → `refreshToken()` → `{accessToken, expiresAt}` (reuse stored refresh token).
  - Distinct errors for user-cancel, timeout, and token-endpoint HTTP failures (status + body).
- **`preload.cjs`** — expose `oauth: { start: () => invoke('oauth:start'), refresh: (rt) =>
  invoke('oauth:refresh', { refreshToken: rt }) }` as a **top-level sibling** (same brace care
  as the recent `logs` fix).
- **`main.cjs`** — register `oauthIpc` alongside the other IPC modules.

## Renderer changes — `src/cloud-auth.js`

Add a native Google binding used by the Drive provider (replaces `makeBinding('gdrive')`):

```js
function makeNativeGoogleBinding() {
  const suffix = 'google.auth'
  return {
    isConnected: () => Boolean(read(suffix)?.accessToken),
    async connect() {
      const tokens = await window.electronAPI.oauth.start()   // {accessToken, refreshToken, expiresAt}
      write(suffix, tokens)
      window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
    },
    async disconnect() { clear(suffix) },
    async getToken({ force } = {}) {
      const auth = read(suffix)
      if (!auth?.accessToken) return null
      const expired = auth.expiresAt && Date.now() > auth.expiresAt - 60_000
      if (!force && !expired) return auth.accessToken
      const next = await window.electronAPI.oauth.refresh(auth.refreshToken)
      if (!next?.accessToken) return force ? null : auth.accessToken
      write(suffix, { ...auth, ...next })
      return next.accessToken
    },
  }
}

export const desktopCloudProviders = [
  makeGoogleDriveProvider(makeNativeGoogleBinding()),
  makeOneDriveProvider(makeBinding('onedrive')),   // unchanged for now (still backend-based)
]
```

The backend `native-url`/`exchange`/`refresh` fetches and the `nexusmd://` `redeem()` path are
removed for Google. `nexusmd://` deep-link infra (`ipc/deepLink.cjs`) stays — unrelated.

## Error handling & logging (task #2, folded in)

- **`cloud-auth.js`:** log full errors — `console.error('[cloud-auth] …:', err?.stack || err)` —
  include the attempted URL/context; replace every silent `catch {}` (token refresh, redeem,
  cred load/save) with at least a `console.warn('[cloud-auth] …:', e)`.
- **New `electron/ipc/withLogging.cjs`:** wraps `ipcMain.handle` so any handler rejection is
  logged under a `log.scope(channel)` before rethrowing. Applied to the oauth handlers (and
  available for others).
- **OAuth module:** step-by-step `log.scope('oauth')` entries (flow start, browser opened, code
  received, exchange ok/fail, refresh ok/fail) with no token/secret values in the message.
- **Scoped `[area]` tags:** adopt `log.scope('<area>')` in the new main modules and add key
  lifecycle logs in `main.cjs` (app ready, main window created, quit). Renderer keeps the
  existing `[area]` console convention (already parsed by the log viewer). **Boundary:** this
  task adds scopes to new code + lifecycle + fixes the identified silent catches; it does **not**
  rewrite every existing module.

## Data flow & storage

`google.auth` in `localStorage` (per-profile key), shape `{ accessToken, refreshToken,
expiresAt }`. Access tokens refresh proactively when within 60s of `expiresAt`; the provider's
existing 401-retry (`getToken({force:true})`) remains a fallback. **Security note:** refresh
tokens in `localStorage` are readable by the renderer; moving them to `safeStorage`/OS keychain
is a documented future hardening step, out of scope here.

## External prerequisites (not code)

- Google Cloud OAuth client must be type **Desktop app** (enables loopback redirect + secret).
- Enable the **Drive, Gmail, and Calendar** APIs on the project.
- On the OAuth consent screen, add the user as a **test user** (sensitive scopes) or publish.

## Testing

- **`pkce.test`** — `challenge === base64url(sha256(verifier))`; formats are base64url.
- **`loopback.test`** — start server; `GET 127.0.0.1:<port>/?code=abc&state=<match>` resolves
  `abc`; mismatched `state` rejects; `?error=access_denied` rejects; timeout rejects.
- **`google.test`** — `buildAuthUrl` includes all three scopes, `code_challenge_method=S256`,
  `access_type=offline`, `prompt=consent`, correct `redirect_uri`; token/refresh request bodies
  correct (mocked fetch).
- **`cloud-auth` test** — `getToken` returns cached token when unexpired; calls
  `oauth.refresh` and re-stores when expired/forced; returns null when disconnected.
- **Manual E2E** — Connect Google Drive → browser consent (Drive+Gmail+Calendar listed) →
  tokens stored → a `.nmdprofile` appears in the Drive `NexusMD` folder; log viewer shows the
  `[oauth]` step trail.

## Rollout

1. Land config with placeholder credentials + the main-process oauth engine (+ tests).
2. User pastes real Desktop `clientId`/`clientSecret` and completes consent-screen setup.
3. Verify E2E on desktop. OneDrive/web and keychain storage tracked as follow-ups.
