# OAuth Settings Panel — Design Spec

**Date:** 2026-06-30  
**Scope:** All platforms (web, desktop, mobile app)  
**Approach:** Approach A — new "Integrations" tab

---

## Overview

Add a shared "Integrations" settings tab that surfaces OAuth connection management (connect/disconnect) and admin credential configuration (Client ID / Secret) for three services: Azure DevOps OAuth, Microsoft/Entra ID, and GitHub OAuth App. The tab is added to all platforms via a shared component in `packages/ui`. The web app's existing "Connection" tab is merged into this new tab.

---

## Architecture

### New nav entry

A new nav item is added to the `NAV` array in each platform's `view-settings.jsx`:

```js
{ id: 'integrations', label: 'Integrations', icon: 'lock' }
```

- **Web:** replaces the existing `connection` tab entry; `GoogleConnectionCard` is rendered as a fourth card below the three shared service cards.
- **Desktop / App:** new addition alongside existing nav items.

### Shared component: `OAuthServiceCard`

Lives in `packages/ui/src/views/view-settings.jsx`, exported alongside `CloudSyncCard` etc.

Accepts a single `service` descriptor prop:

```js
{
  id: 'ado' | 'microsoft' | 'github',
  label: string,            // e.g. "Azure DevOps"
  icon: string,             // icon name from the shared icon set
  desc: string,             // one-line description shown in the card header
  isConnected: () => bool,
  connect: () => Promise<void>,
  disconnect: () => Promise<void>,
  credFields: [             // drives the admin credentials section
    { key: string, label: string, hint?: string, secret?: bool }
  ],
  loadCreds: () => Record<string, string>,
  saveCreds: (creds: Record<string, string>) => void,
  children?: ReactNode,     // service-specific sub-settings rows
}
```

### `IntegrationsView`

A thin wrapper component in `packages/ui/src/views/view-settings.jsx`, exported and rendered when `subPage === 'integrations'`. Accepts an `services` array of descriptor objects and renders one `OAuthServiceCard` per entry.

Each platform's `view-settings.jsx` constructs and passes the descriptor array.

---

## Components

### `OAuthServiceCard` visual layout

**Section 1 — App credentials** (collapsible)

- Collapsed by default when all `credFields` values are non-empty.
- Expanded state: one labeled input per `credFields` entry. `secret: true` → `type="password"`. "Save credentials" button calls `saveCreds()`.
- Hint text: "These credentials are shared across all users of this instance."
- Collapsed state: shows `pill success` "Configured" badge or muted "Not configured" badge.

**Section 2 — Connection** (always visible)

- Status pill: `pill success` "Connected" or plain "Disconnected".
- "Connect" button: calls `connect()`. If credentials are missing (any `credFields` value empty), shows inline callout "Enter Client ID and Secret first" instead of calling `connect()`.
- "Disconnect" button (ghost danger): calls `disconnect()`, visible only when connected.
- `children` slot: rendered as additional `VsRow` entries below the connection row. Concrete sub-settings per service:
  - **ADO OAuth:** no sub-settings initially (org/projects already managed via ADO Connection card).
  - **Microsoft/Entra ID:** no sub-settings initially.
  - **GitHub OAuth App:** "Repositories" — same comma-separated `owner/repo` input and "Browse repos…" button as the existing `GitHubConnectionTab`; migrated into the children slot.

### Existing components unchanged

`VsCard`, `VsRow`, `VsFullRow`, `VsSeg`, `PlToggle` — no changes. `OAuthServiceCard` is built from these primitives.

`GoogleConnectionCard` (web-only) — stays in `apps/web/src/view-settings.jsx`, rendered as a fourth card after the three shared ones.

---

## Data Flow

### Credential storage

`saveCreds()` writes `{ clientId, clientSecret }` (keyed per `credFields`) to localStorage under:

```
nexusmd.p.<profileId>.<serviceId>.oauthCreds
```

On desktop, the `clientSecret` field delegates to `window.electronAPI.secureStorage.set(key, value)` so it never lands on disk in plaintext. `loadCreds()` reads from the same source on mount.

### OAuth connect flow

Mirrors the existing `google-auth.js` / `cloud-auth.js` pattern:

1. `connect()` calls `GET /api/<service>/auth/url?redirectUri=…` (web/app) or fires a deep link (desktop).
2. User is redirected to the provider's consent screen.
3. On return, the platform's callback handler exchanges the code via `POST /api/<service>/auth/callback`, writes tokens to localStorage under `nexusmd.p.<id>.<service>.auth`, and dispatches `nexusmd:cloud-auth-changed`.
4. `OAuthServiceCard` listens for `nexusmd:cloud-auth-changed` and `window focus` to re-call `isConnected()` and re-render.

### Token storage

Access/refresh tokens stored per-profile:

```
nexusmd.p.<profileId>.<serviceId>.auth = { accessToken, refreshToken, email? }
```

Matches the existing `gdrive.auth` / `onedrive.auth` pattern — compatible with the cloud sync binding infrastructure.

### Platform binding objects

Each platform defines one binding object per service in its `view-settings.jsx`:

```js
const adoBinding = {
  id: 'ado',
  label: 'Azure DevOps',
  icon: 'inbox',
  desc: 'Work items, PRs, pipelines — OAuth 2.0',
  isConnected: () => Boolean(read('ado.auth')?.accessToken),
  connect: async () => { /* fetch /api/ado/auth/url, redirect */ },
  disconnect: async () => { clear('ado.auth') },
  credFields: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client Secret', secret: true },
  ],
  loadCreds: () => read('ado.oauthCreds') || {},
  saveCreds: (c) => write('ado.oauthCreds', c),
}
```

Three bindings (ADO, Microsoft, GitHub) per platform. Desktop's `saveCreds` for `clientSecret` uses `secureStorageAdapter` instead of localStorage.

---

## Error Handling

- All async operations in bindings (`connect`, `disconnect`, `saveCreds`) are wrapped in try/catch; failures call `toast('…', 'error')`.
- `OAuthServiceCard` has no local error state — errors are transient toasts only.
- Missing credentials before connect: inline `plm-callout err` below the credentials section, no fetch attempted.
- Callback exchange failure: toast on the existing pattern (`toast('Sign-in failed. Please try again.', 'error')`).

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `packages/ui/src/views/view-settings.jsx` | Add `OAuthServiceCard`, `IntegrationsView`; export both |
| `apps/web/src/view-settings.jsx` | Replace `connection` tab with `integrations`; add three binding objects; pass `GoogleConnectionCard` as fourth card |
| `apps/desktop/src/main.jsx` | Add `integrations` nav item; add three binding objects; render `IntegrationsView` in the settings panel |
| `apps/app/src/views/view-settings.jsx` | Add `integrations` nav item; add three binding objects; render `IntegrationsView` |

No new files. No backend changes in scope — this spec covers only the settings UI. Backend OAuth routes (`/api/ado/auth/*`, `/api/ms/auth/*`, `/api/github/auth/*`) are out of scope; the Connect button will surface a toast error if a route is missing, which is acceptable during incremental rollout.

---

## Out of Scope

- Backend OAuth route implementation for ADO and Microsoft (GitHub has a partial stub already).
- Google OAuth consolidation — `GoogleConnectionCard` stays as-is on web.
- Token refresh logic per service — follows existing pattern, wired at binding level.
- Multi-tenant / per-user credential isolation beyond the existing profile-scoped key pattern.
