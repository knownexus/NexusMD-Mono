# Integrations Native OAuth — Google reuse + Microsoft/Entra + ADO/GitHub cleanup — Design

**Date:** 2026-07-01
**Status:** Approved (pending spec review)
**Scope:** `apps/desktop` (+ `packages/ui` provider wiring). Builds on the native Google OAuth
work (`feat/desktop-google-oauth`, see [design](2026-07-01-desktop-google-oauth-and-logging-design.md)).

## Context

The desktop app has two "Connect Google" entry points that went through different code paths:
cloud sync's Drive connect was rewired to the native PKCE loopback flow, but the **Integrations
panel** (`IntegrationsPanel` in `desktop-settings.jsx`) still connects every provider via
`makeDesktopOAuthService(from)` → `fetch('https://nexusmd.app/api/<p>/auth/native-url')` → the
non-existent backend → "Failed to fetch". So Integrations' Google (and Microsoft) connect are broken.

Investigation also found that **ADO and GitHub already have working, backend-free auth via
Personal Access Tokens** in the same panel (ADO: org+PAT → `dev.azure.com`; GitHub:
`nexusmd.github.pat` → `api.github.com`). Their OAuth "Connect" buttons are therefore redundant.
And **OneDrive cloud sync** still uses the dead backend (`makeBinding('onedrive')`).

`IntegrationsPanel` is a single shared component rendered from **Settings** (kept) and previously
from a **navbar route** (being removed via a separate, already-in-progress `main.jsx` change).
This work targets the shared component, which survives in Settings — no conflict.

### Goals
1. Integrations' **Google** connect uses the existing native flow, sharing one `google.auth` connection.
2. New native **Microsoft/Entra** PKCE loopback flow — one `microsoft.auth` connection granting
   OneDrive + Calendar via Microsoft Graph — used by both Integrations *and* OneDrive cloud sync.
3. Remove the redundant broken **ADO/GitHub** OAuth buttons; keep their PAT paths.
4. OAuth client credentials for Google + Microsoft live in `config.cjs`; remove the per-provider
   credential-entry UI.

### Non-goals
- ADO/GitHub native OAuth (PAT already works; GitHub OAuth Apps lack PKCE anyway).
- Web platform; OS-keychain token storage (still a documented follow-up).
- The navbar-integrations removal itself (separate in-progress change; this design is compatible with it).

## Decisions (from brainstorming)
- ADO/GitHub → **remove OAuth buttons, keep PAT**.
- Credentials → **hardcoded in `config.cjs`**; **remove** per-provider cred-entry UI.
- Microsoft → **build native flow**; no Entra registration yet (setup steps included).
- OneDrive → **share the one `microsoft.auth` connection** (fixes OneDrive sync).

## Architecture

Reuse the entire native OAuth engine from the Google feature. It is already provider-generic
(the `oauth:start`/`oauth:refresh` IPC handlers take a `provider` param and look up
`config[provider]`). Only two things need generalizing for a public (secret-less) provider:

1. **Secret-optional token requests.** Entra desktop/public clients use PKCE **instead of** a
   client secret. `exchangeCode`/`refreshAccessToken` must send `client_secret` only when
   `cfg.clientSecret` is truthy.
2. **Rotated refresh tokens.** Microsoft returns a **new** refresh token on each refresh; Google
   does not. `refreshAccessToken` must return `refreshToken` **only when present** (never
   `undefined`), so the binding's `write(suffix, {...auth, ...next})` merge can't clobber a good
   token. The binding persists the rotated token.

`pkce.cjs`, `loopback.cjs`, `ipc/oauth.cjs`, `preload.cjs`, and `main.cjs` need **no changes**.

## Components

### Main process
- **`electron/oauth/config.cjs`** — add a `microsoft` provider:
  ```js
  microsoft: {
    clientId:     process.env.MS_DESKTOP_CLIENT_ID || '<PASTE_ENTRA_CLIENT_ID>',
    clientSecret: '',                                   // public client — PKCE, no secret
    authUrl:  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'Files.ReadWrite', 'Calendars.ReadWrite', 'User.Read'],
    authParams: {},                                     // no Google-style access_type/prompt
  }
  ```
  (`google` provider unchanged.)
- **`electron/oauth/google.cjs` → rename to `electron/oauth/endpoints.cjs`** (it is provider-agnostic;
  update the `require` in `ipc/oauth.cjs`). Changes:
  - Build the token-request body with `client_secret` **only if** `cfg.clientSecret`.
  - `refreshAccessToken` returns `{ accessToken, expiresAt, ...(refresh_token ? { refreshToken: refresh_token } : {}) }`.
  - `buildAuthUrl` already spreads `cfg.authParams` and joins scopes with spaces — works for both
    (Microsoft accepts space-delimited scopes incl. `offline_access`). `redirect_uri` stays
    `http://127.0.0.1:<port>` — **Entra loopback caveat:** Microsoft prefers `http://localhost`
    and matches any port for a registered loopback URI. `127.0.0.1` is also accepted by Entra, but
    the registered redirect must match the host used. Mitigation: register **both**
    `http://localhost` and `http://127.0.0.1` in the Entra app (loopback host, any port), and keep
    the server on `127.0.0.1`. If Entra rejects `127.0.0.1` in practice, the fallback is to have the
    loopback bind/redirect via `localhost` — decide during planning if E2E surfaces it.

### Renderer — `src/cloud-auth.js`
- Generalize `makeNativeGoogleBinding()` → **`makeNativeBinding({ provider, suffix })`** with the
  same connect/getToken/refresh logic; `getToken` persists a rotated `refreshToken` when the
  refresh response includes one. Export convenience bindings:
  - `makeNativeGoogleBinding()` → `makeNativeBinding({ provider: 'google', suffix: 'google.auth' })`
  - `makeNativeMicrosoftBinding()` → `makeNativeBinding({ provider: 'microsoft', suffix: 'microsoft.auth' })`
- `desktopCloudProviders`: Drive → native google (unchanged); **OneDrive → `makeOneDriveProvider(makeNativeMicrosoftBinding())`**.
- Remove the backend `makeDesktopOAuthService` OAuth path. Keep `loadCreds`/`saveCreds` **only** if
  still referenced after the panel change; otherwise delete. (Check `main.jsx:121` `ghService` — it
  used `makeDesktopOAuthService('github')` for a github-401 re-auth banner; since GitHub is
  PAT-based, remove that dead wiring too or leave the export if still imported — resolve during planning.)

### Integrations panel — `src/desktop-settings.jsx`
- **Google** entry → native google binding (shared `google.auth`).
- **Microsoft/Entra** entry → native microsoft binding (`microsoft.auth`).
- **Remove** the `ado` and `github` OAuth service entries from `oauthServices`; keep their PAT
  children (`DesktopGitHubPATRow`; ADO connection card).
- **Remove** the `credFields` UI for all entries (credentials come from `config.cjs`). The panel
  shows Connect/Disconnect + provider-specific children (PAT rows, repo list).

## Data flow & storage
- `google.auth` and `microsoft.auth` in localStorage (per-profile), shape
  `{ accessToken, refreshToken, expiresAt }`. Proactive refresh within 60s of `expiresAt`.
- One Google connection (Drive + Gmail + Calendar). One Microsoft connection (OneDrive + Calendar),
  shared by cloud sync and Integrations.

## Error handling & logging
Same discipline as the Google feature: full-error renderer logging, `[oauth]` scoped main logs,
no silent failure sites in touched code.

## Testing
- **`endpoints.test`** (renamed): existing Google cases + new — secret omitted when `clientSecret`
  falsy; `client_secret` present when set; refresh returns rotated `refreshToken` when the response
  includes one, and omits the key when it doesn't.
- **`cloud-auth.test`**: `makeNativeBinding` works for a non-google provider/suffix; a rotated
  refresh token is persisted (Microsoft case); Drive uses google binding, OneDrive uses microsoft binding.
- **Panel**: a lightweight test/assertion that Integrations Google + Microsoft entries invoke the
  native bridge (not the backend), and that ADO/GitHub OAuth entries are gone while PAT rows remain.
- **Manual E2E**: Integrations → Connect Microsoft → Entra consent (OneDrive + Calendar) → tokens
  stored under `microsoft.auth` → OneDrive cloud sync works; Connect Google shares the Drive connection.

## External prerequisites (you)
- **Entra app registration** (Azure portal → App registrations): platform **Mobile and desktop
  applications**, redirect URIs **`http://localhost` and `http://127.0.0.1`** (register both for the
  loopback; Entra matches any port); supported account types per need
  (personal + work = "common"). Add Microsoft Graph **delegated** permissions: `Files.ReadWrite`,
  `Calendars.ReadWrite`, `User.Read`, `offline_access`. Paste the Application (client) ID into
  `config.cjs` (`<PASTE_ENTRA_CLIENT_ID>`). No client secret.
- Google already configured.

## Rollout
1. Generalize endpoints (secret-optional, rotated refresh) + add microsoft config; tests.
2. Renderer binding generalization + provider wiring; tests.
3. Panel: native Google/Microsoft, remove ADO/GitHub OAuth + cred UI; tests.
4. You: register the Entra app, paste client ID, E2E Microsoft + OneDrive.
