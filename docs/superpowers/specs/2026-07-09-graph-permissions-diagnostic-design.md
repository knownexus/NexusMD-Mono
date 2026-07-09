# Graph API Permissions Diagnostic Design

**Date:** 2026-07-09
**Scope (changed/new):**
- `apps/desktop/src/cloud-auth.js` — generalize `jwtExpiryMs` into an exported `decodeJwtClaims(token)`
- `apps/desktop/src/desktop-settings.jsx` — extract shared preset-run logic out of `GraphApiTestCard` into a small hook (`useGraphPresetRunner` or similar); add new `GraphPermissionsCard`; wire it into the `integrations` tab
- `apps/desktop/src/desktop-settings.test.jsx` — new tests for `decodeJwtClaims` usage and `GraphPermissionsCard`

## Context

The user gets 403s on calendar and OneDrive Graph calls and wants a way to tell *why*:
is the scope simply missing from their token (needs re-consent), or is the scope present
but still forbidden (admin consent not granted tenant-wide, mailbox/OneDrive not
provisioned, conditional access, etc.)?

The desktop app already has most of the pieces:
- `apps/desktop/src/desktop-settings.jsx:423-454` (`GRAPH_TEST_PRESETS`) — presets for
  `/me`, calendar, and OneDrive, each pointing at the same Graph path the real feature uses.
- `apps/desktop/src/desktop-settings.jsx:491-532` (`GraphApiTestCard`) — runs a preset
  on demand via `graphJSON` and shows the raw result or error inline.
- `apps/desktop/src/cloud-auth.js:160-167` (`jwtExpiryMs`) — already decodes the JWT
  payload (for `exp`), just doesn't expose the rest of the claims.

What's missing is visibility into the token's **granted scopes** (the `scp` claim), shown
next to the live per-resource result, so a 403 can be attributed to "scope never granted"
vs. "scope granted but still forbidden" in one place.

This is entirely a desktop-app, client-side change — there's no backend Graph proxy to
touch (per `2026-07-03-microsoft-graph-client-design.md`); the app already holds the
access token needed to decode it.

## Decisions (from brainstorming)
- **Lives in the Integrations settings tab**, not the calendar/OneDrive error banners —
  a dedicated, always-available diagnostic rather than something that only appears
  mid-error.
- **Both static (token decode) and live (per-resource probe) checks**, not just one —
  decoding alone can't distinguish "granted but still forbidden," and probing alone can't
  distinguish "scope missing" from "scope present, other cause."
- **Reuses `GRAPH_TEST_PRESETS`/`graphJSON`** rather than inventing a second way to call
  Graph — the live-probe part of this card should call the exact same paths
  `GraphApiTestCard` already exercises, so results agree with what "Run" shows there.
- **Runs automatically on mount**, with a manual refresh button, so opening the tab
  immediately shows the diagnosis without an extra click.
- **No backend or server changes.** No new dependency (stays on raw `fetch`/manual JWT
  base64 decode, consistent with `jwtExpiryMs`'s existing approach).

---

## 1. `decodeJwtClaims` (`cloud-auth.js`)

Generalize the existing inline decode in `jwtExpiryMs`:

```js
// Best-effort decode of a JWT's payload claims. Returns null if the token
// isn't a decodable JWT.
export function decodeJwtClaims(token) {
  try {
    const payload = token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json)
  } catch { return null }
}

function jwtExpiryMs(token) {
  const claims = decodeJwtClaims(token)
  return Number.isFinite(claims?.exp) ? claims.exp * 1000 : null
}
```

`jwtExpiryMs`'s existing callers/behavior are unchanged. `decodeJwtClaims` is exported for
`GraphPermissionsCard` to read `scp`.

## 2. Shared preset-runner (`desktop-settings.jsx`)

`GraphApiTestCard`'s `run(preset)` (lines 495-504) becomes a small shared hook so
`GraphPermissionsCard` doesn't reimplement "resolve preset.path, call graphJSON, capture
result/error":

```js
function useGraphPresetRunner(getToken) {
  const [results, setResults] = React.useState({})
  const run = async (preset) => {
    setResults(r => ({ ...r, [preset.id]: { loading: true } }))
    try {
      const path = typeof preset.path === 'function' ? preset.path() : preset.path
      const data = await graphJSON(getToken, path)
      setResults(r => ({ ...r, [preset.id]: { data } }))
    } catch (e) {
      setResults(r => ({ ...r, [preset.id]: { error: e.message || 'Request failed' } }))
    }
  }
  return { results, run }
}
```

`GraphApiTestCard` is refactored to use this hook (behavior unchanged — still one "Run"
button per preset, still shows raw JSON or error). `GraphPermissionsCard` uses the same
hook and calls `run` for every preset on mount.

## 3. Scope-to-preset map

A small constant next to `GRAPH_TEST_PRESETS`, mapping each scope the app actually
requests (per `apps/desktop/electron/oauth/config.cjs`) to the preset that exercises it:

```js
const GRAPH_SCOPE_CHECKS = [
  { scope: 'User.Read',           label: 'Sign-in / profile', presetId: 'me' },
  { scope: 'Calendars.ReadWrite', label: 'Calendar',          presetId: 'calendar' },
  { scope: 'Files.ReadWrite',     label: 'OneDrive',          presetId: 'onedrive' },
]
```

`offline_access` is excluded — it's not a resource scope and has no corresponding Graph
call to probe.

## 4. `GraphPermissionsCard`

```js
function GraphPermissionsCard() {
  const { getToken } = React.useMemo(() => makeNativeMicrosoftBinding(), [])
  const { results, run } = useGraphPresetRunner(getToken)
  const [grantedScopes, setGrantedScopes] = React.useState(null) // null = not checked yet
  const [refreshing, setRefreshing] = React.useState(false)

  const diagnose = React.useCallback(async () => {
    setRefreshing(true)
    const token = await getToken()
    const claims = token ? decodeJwtClaims(token) : null
    setGrantedScopes(claims?.scp ? claims.scp.split(' ') : [])
    await Promise.all(GRAPH_TEST_PRESETS.map(p => run(p)))
    setRefreshing(false)
  }, [getToken])

  React.useEffect(() => { diagnose() }, [diagnose])

  return (
    <VsCard title="Permissions" icon="lock">
      <VsRow title="Diagnosis" desc="Checks the granted token scopes against a live call to each resource">
        <button className="btn sm ghost" onClick={diagnose} disabled={refreshing}>
          {refreshing ? 'Checking…' : 'Refresh'}
        </button>
      </VsRow>
      {GRAPH_SCOPE_CHECKS.map(({ scope, label, presetId }) => {
        const granted = grantedScopes?.includes(scope)
        const live = results[presetId]
        const liveStatus = live?.loading ? 'Checking…' : live?.error ? 'Failed' : live?.data ? 'OK' : '—'
        return (
          <VsFullRow key={scope} title={label} desc={scope}>
            <div style={{ display: 'flex', gap: 16, fontSize: 12.5 }}>
              <span>Granted in token: <b style={{ color: granted ? 'var(--success)' : 'var(--danger)' }}>{grantedScopes === null ? '—' : granted ? 'Yes' : 'No'}</b></span>
              <span>Live check: <b style={{ color: liveStatus === 'OK' ? 'var(--success)' : liveStatus === 'Failed' ? 'var(--danger)' : 'var(--text-muted)' }}>{liveStatus}</b></span>
            </div>
            {live?.error && <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--danger)' }}>{live.error}</div>}
          </VsFullRow>
        )
      })}
    </VsCard>
  )
}
```

Placed in `IntegrationsPanel` (line ~563) directly above `GraphApiTestCard`, so the
summary diagnosis appears first and the raw manual-run tool stays available below it for
deeper digging.

### Reading the four combinations
| Granted in token | Live check | Meaning |
|---|---|---|
| Yes | OK | Working as expected |
| Yes | Failed | Scope consented but Graph still refuses — check admin consent, licensing/mailbox provisioning, conditional access |
| No | Failed | Token was issued without this scope — reconnect Microsoft sign-in (Integrations → Microsoft → reconnect) to re-consent |
| No | OK | Inconsistent/stale data — token may have been refreshed between the decode and the probe; hit Refresh again |

No new error-handling abstraction is introduced — `live.error` is the same
`Error.message` string `GraphApiTestCard` already surfaces (`Graph request failed (403): /me/calendarView`), so the 403 status is visible directly in the diagnostic without extra parsing.

## 5. Testing
- **`cloud-auth.test.js`** (or wherever `jwtExpiryMs` is currently tested, if it is):
  add a case for `decodeJwtClaims` — valid JWT returns parsed claims including `scp`;
  malformed token returns `null`.
- **`desktop-settings.test.jsx`**:
  - `GraphPermissionsCard` renders "Granted in token: Yes" for a scope present in a mocked
    token's `scp` claim, "No" for one absent.
  - Live check column shows "OK" when the mocked `graphJSON` resolves, "Failed" plus the
    error text when it rejects (mock a 403 rejection for the calendar preset).
  - `GraphApiTestCard` still behaves identically after the `useGraphPresetRunner`
    extraction (existing manual "Run" behavior, if tests exist; if not, this refactor
    carries the same risk as before — no regression tests currently exist for that card).

## Out of scope
- Any change to the OAuth config/scopes themselves (`electron/oauth/config.cjs`) — this
  is a read-only diagnostic, not a re-consent flow. Reconnecting to add a missing scope
  is already possible via the existing "Microsoft / Entra ID" connect/disconnect in
  `IntegrationsView` (`IntegrationsPanel`, line ~552-557).
- Surfacing this in the calendar/OneDrive error banners — deferred; the settings tab is
  the only surface for now per the brainstorming decision.
- Admin-side diagnostics (e.g. querying tenant-wide app permission grants via
  `servicePrincipals/{id}/oauth2PermissionGrants`) — that requires admin-consent-only
  Graph permissions the app doesn't have and isn't a delegated-user scenario; out of
  scope for this client-side, per-user diagnostic.
