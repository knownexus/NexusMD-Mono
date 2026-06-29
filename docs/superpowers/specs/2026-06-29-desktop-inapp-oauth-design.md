# Desktop in-app OAuth (Google Drive + OneDrive) — Design

**Date:** 2026-06-29
**Status:** Draft (awaiting review)
**Scope:** `apps/desktop` only. Mobile (Capacitor) and web are out of scope.

## Problem

Clicking **Connect Google Drive** (or OneDrive) in the desktop app does nothing.

Root cause, confirmed by reproduction:

1. The desktop renderer brokers OAuth through a remote backend. `apps/desktop/src/cloud-auth.js:8`
   defaults `API_BASE` to `https://nexusmd.app` because no `.env` sets `VITE_API_BASE`.
2. **`nexusmd.app` does not resolve** (`DNS name does not exist`). The first
   `fetch(`${API_BASE}/api/google/auth/native-url…`)` throws.
3. `connect()` swallows the error in an empty `catch {}` and returns, so the
   failure is invisible — "nothing happens".

Even if a backend were reachable, two further gaps exist: the backend has no
`OAuth:NativeReturnPrefixes` (so it rejects `nexusmd://` return URIs), and the
current desktop flow relies on a **custom URI scheme** (`nexusmd://`), which
**Google no longer supports** for native OAuth ("risk of app impersonation").

## Goal

The desktop app performs OAuth **itself**, with **no external backend** and **no
server-held client secret**, for both Google Drive and OneDrive. Sign-in works
offline of `nexusmd.app`.

## Approach: PKCE + loopback redirect, in the Electron main process

This is the method both providers explicitly recommend for installed/desktop apps:

- **Google:** loopback IP (`http://127.0.0.1:<port>`) is the recommended redirect;
  no port is pre-registered; PKCE replaces the secret; "Desktop app" client type.
- **Microsoft (Entra):** authorization code + PKCE as a **public client**;
  redirect platform "Mobile and desktop applications" → `http://localhost`
  (loopback exception allows arbitrary runtime ports); "Allow public client
  flows" = Yes; no secret.

Sign-in flow (per provider):

1. Main generates a PKCE `code_verifier`, `code_challenge` (`S256`), and a random `state`.
2. Main starts a single-use `http` listener on the loopback interface, port `0`
   (OS-assigned free port); reads the actual port.
3. Main opens the **system browser** (`shell.openExternal`) to the provider's
   authorize endpoint with `client_id`, `redirect_uri`, `response_type=code`,
   `scope`, `code_challenge`, `code_challenge_method=S256`, `state` (+ provider
   extras: Google `access_type=offline&prompt=consent`).
4. The provider redirects the browser to the loopback URL with `?code&state`.
   The listener validates `state`, serves a small "you can return to NexusMD"
   HTML page, then closes.
5. Main exchanges the code at the token endpoint (`grant_type=authorization_code`,
   `code`, `redirect_uri`, `client_id`, `code_verifier` — **no secret**) and
   reads `access_token`, `refresh_token`, and `email` (decoded from `id_token`).
6. Main returns `{ accessToken, refreshToken, email }` to the renderer over IPC.

Token refresh runs the same way: main POSTs `grant_type=refresh_token` to the
token endpoint and returns the new access token (and rotated refresh token if the
provider returns one — Microsoft rotates, Google does not).

### Why not the alternatives

- **Reuse the `nexusmd://` custom scheme + deep link:** Google no longer supports
  custom schemes for native OAuth. Rejected.
- **Bundle / ship the ASP.NET backend with the app:** heavy; the loopback flow
  removes the need for any broker at all. Rejected.
- **Use MSAL-Node (Microsoft) + google-auth-library (Google):** official and
  robust, but each brings its own token-cache model that diverges from the app's
  existing per-profile token storage, and adds two dependencies for two different
  shapes. A single generic PKCE helper keeps both providers uniform, integrates
  with existing storage, and needs **no new dependencies** (Node `crypto`/`http`/
  global `fetch` from Electron 29 / Node 20). Chosen. MSAL-Node remains a
  fallback if Microsoft-specific edge cases (e.g. conditional access) appear.

## Components

### New: `apps/desktop/electron/ipc/oauth.cjs` (main process)

A generic PKCE loopback OAuth helper plus a small provider registry. Registers
two IPC handlers via the project's existing ipc-registration pattern:

- `oauth:signIn` → `(provider: 'google' | 'microsoft')` → `{ accessToken, refreshToken, email }`
- `oauth:refresh` → `({ provider, refreshToken })` → `{ accessToken, refreshToken? }`

Provider registry (client IDs are **public** for desktop public clients):

```
google: {
  authEndpoint:  'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  clientId: <Google "Desktop app" client id>,
  scope: 'openid email https://www.googleapis.com/auth/drive.file',
  redirectHost: '127.0.0.1',
  authParams: { access_type: 'offline', prompt: 'consent' },
}
microsoft: {
  authEndpoint:  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  clientId: <Azure app (client) id>,
  scope: 'openid email offline_access Files.ReadWrite',
  redirectHost: 'localhost',
}
```

Pure, unit-testable pieces are extracted from the I/O:
- `makePkce()` → `{ verifier, challenge }`
- `buildAuthUrl(providerCfg, { redirectUri, challenge, state })`
- `parseTokenResponse(json)` → `{ accessToken, refreshToken, email }` (email decoded from `id_token`)

The loopback server, browser launch, and `fetch` token calls are the impure shell.

### Changed: `apps/desktop/electron/preload.cjs`

Expose:
```
oauth: {
  signIn:  (provider)               => ipcRenderer.invoke('oauth:signIn', provider),
  refresh: (provider, refreshToken) => ipcRenderer.invoke('oauth:refresh', { provider, refreshToken }),
}
```

### Changed: `apps/desktop/src/cloud-auth.js` (renderer)

- Map provider key → flow id: `gdrive → google`, `onedrive → microsoft`.
- `connect()`: call `window.electronAPI.oauth.signIn(flowId)`; on success
  `write({ accessToken, refreshToken, email })`, dispatch
  `nexusmd:cloud-auth-changed`, toast success; on error **toast the failure**
  (no more silent `catch {}`).
- `getToken({ force })`: on `force`, call `window.electronAPI.oauth.refresh(...)`,
  persist the returned tokens.
- Remove `API_BASE`/`nexusmd.app`, the `native-url`/`exchange` fetches, and the
  `nexusmd://` `redeem`/`registerCloudDeepLink` cloud path. Per-profile token
  storage (localStorage via `profile-keys`) is unchanged.

Shared provider code (`packages/ui/src/cloud/providers.js`) and the settings UI
are **unchanged** — only the desktop `authBinding` is rewired.

### Client-ID configuration

Main process reads client IDs from environment with committed non-secret
fallbacks, documented in the README:
- `NEXUSMD_GOOGLE_DESKTOP_CLIENT_ID`
- `NEXUSMD_MS_DESKTOP_CLIENT_ID`

(They are public client IDs, so committing defaults is acceptable; env allows
per-developer override.)

## External configuration (done by the developer, not in code)

**Google Cloud Console:** create an OAuth client of type **Desktop app**; copy
its client ID. Ensure the Drive API is enabled and the OAuth consent screen lists
the `drive.file`/`email`/`openid` scopes (add test users if the app is in Testing).

**Azure Portal:** register an app; add platform **Mobile and desktop
applications** with redirect `http://localhost`; set **Allow public client
flows = Yes**; supported account types must include **personal Microsoft
accounts** (OneDrive consumer); add delegated Microsoft Graph permissions
`Files.ReadWrite`, `offline_access`, `openid`, `email`; copy the client ID.

## Error handling

- Loopback wait times out (default 5 min) → reject → renderer toast "Sign-in timed out".
- `state` mismatch on the redirect → reject (CSRF guard).
- Token endpoint non-2xx → surface the provider error message in a toast.
- Port-bind uses `:0` so the OS assigns a free port; failure rejects with a clear message.

## Security

- PKCE `S256` protects the authorization code; `state` prevents CSRF.
- Loopback server binds to the loopback interface only, handles one request, then closes.
- System browser only (never an embedded webview) — required by both providers.
- Public client IDs only; no secret in the app.

## Testing

- **Unit (vitest):** `makePkce` (length/charset, challenge = base64url(SHA-256(verifier))),
  `buildAuthUrl` (params, encoding, per-provider extras), `parseTokenResponse`
  (token mapping, `id_token` email decode, missing-field handling).
- **Existing:** `packages/ui` provider/cloud tests remain green (unchanged code).
- **Manual end-to-end:** connect Google and OneDrive in a dev desktop build;
  confirm token persistence, a sync round-trip, and refresh-on-401.

## Out of scope

- Mobile (Capacitor) OAuth — same `nexusmd.app` dependency, different mechanics; separate effort.
- Web flow — works once its backend is deployed/configured; tracked separately.
- Migrating any previously stored desktop tokens — none exist in practice; users sign in once.
- Removing the now-unused backend `native-url`/`exchange` endpoints — left for web/other consumers.
