# Shared Microsoft Graph Client Design

**Date:** 2026-07-03
**Scope (changed/new):**
- `packages/ui/src/graph/graph-client.js` (new) — shared `graphFetch`/`graphJSON`/`graphList` helpers
- `packages/ui/src/graph/graph-client.test.js` (new)
- `apps/desktop/src/ms-graph-calendar.js` — refactor `fetchCalendarEvents`/`createCalendarEvent` to take `getToken` and call through the shared client
- `packages/ui/src/views/view-calendar.jsx` (`OutlookService`) — refactor to build a `getToken` adapter over MSAL and call through the shared client
- `apps/desktop/scripts/graph-smoke-test.js` (new) — manual/dev-only real-API check
- `apps/desktop/package.json` — new `graph:smoke` script
- Existing calendar tests updated to pass a `getToken` stub instead of a raw token/mocked MSAL calls

## Context

Microsoft Graph calls already exist in two independent, divergent forms:
- **Desktop** (`apps/desktop/src/ms-graph-calendar.js`): plain functions that take a raw
  Bearer token string per call, fetched from `makeDesktopOAuthService('microsoft')`
  (native PKCE loopback flow). No 401-retry.
- **Web** (`OutlookService` in `packages/ui/src/views/view-calendar.jsx`): fetches its own
  token via MSAL (`acquireTokenSilent`, falling back to `acquireTokenPopup`), then does
  raw `fetch` calls itself.

Both talk to `graph.microsoft.com/v1.0` but duplicate the request/error-handling logic,
and neither shares code with the other or with the existing `authedFetch` helper in
`packages/ui/src/cloud/providers.js` (used by `OneDriveProvider`/`GoogleDriveProvider`
for the profile-sync object store).

Goal: a single, shared, token-agnostic Graph client that both platforms funnel calls
through, so future features (Files browsing, Mail, Planner, etc.) can be built once
against a consistent API instead of re-deriving fetch/retry/pagination logic per
platform. New Graph scopes are added only when each concrete feature is built, not
speculatively.

## Decisions (from brainstorming)
- **No new dependency** — stays with raw `fetch`, consistent with the rest of the
  codebase, rather than adding `@microsoft/microsoft-graph-client`.
- **Token-agnostic**: the client takes a `getToken({force}) => Promise<string>`
  function, not a whole `authBinding` object, so both desktop's native binding and
  web's MSAL flow can supply one trivially.
- **Refactor both existing call sites** (`ms-graph-calendar.js`, `OutlookService`) onto
  the shared client for consistency, rather than leaving them as a third/fourth
  pattern alongside the new one.
- **`OneDriveProvider` is untouched** — it already goes through its own `authedFetch`
  in `providers.js` for the profile-sync object store; not in scope here.
- **Scopes stay minimal** — no new scopes (Mail.Read, Tasks.ReadWrite) requested until
  a feature that needs them is actually implemented.

---

## 1. Shared client (`packages/ui/src/graph/graph-client.js`)

```js
const BASE = 'https://graph.microsoft.com/v1.0'

// Run a Graph request; on 401 refresh the token once and retry.
export async function graphFetch(getToken, path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const run = async (token) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  })
  let token = await getToken()
  let res = await run(token)
  if (res.status === 401) {
    token = await getToken({ force: true })
    res = await run(token)
  }
  if (!res.ok) throw new Error(`Graph request failed (${res.status}): ${path}`)
  return res
}

export async function graphJSON(getToken, path, opts = {}) {
  const res = await graphFetch(getToken, path, opts)
  return res.json()
}

// Follows @odata.nextLink, concatenating each page's `value` array.
export async function graphList(getToken, path, opts = {}) {
  let out = []
  let next = path
  while (next) {
    const page = await graphJSON(getToken, next, opts)
    out = out.concat(page.value || [])
    next = page['@odata.nextLink'] || null
  }
  return out
}
```

- Mirrors `authedFetch`'s shape in `providers.js` (single 401-retry) for consistency
  across the codebase's two Graph-adjacent helpers, without merging them — `providers.js`
  stays scoped to the profile-sync object-store providers.
- `graphFetch`/`graphJSON` are for single-resource calls (e.g. `/me`, POST `/me/events`);
  `graphList` is for paginated collections (e.g. `/me/messages`, `/me/calendarView`).
- Errors embed the status in a `(404)`-style substring so callers can pattern-match
  the same way `OneDriveProvider` already does (`String(e.message).includes('(404)')`);
  404-as-empty handling is each caller's responsibility, not baked into the client,
  since not every endpoint treats 404 as "empty."
- No retry/backoff beyond the single 401 retry — no speculative rate-limit handling;
  add it if a real feature hits 429s.

## 2. Desktop integration (`ms-graph-calendar.js`)

- `fetchCalendarEvents(getToken, startISO, endISO)` and
  `createCalendarEvent(getToken, { title, start, end, description })` replace their
  `token` parameter with `getToken`, and call `graphJSON`/`graphFetch` instead of
  `fetch` directly. This is a net behavior gain: they currently have no 401-retry.
- The caller that currently resolves a token from `makeDesktopOAuthService('microsoft')`
  and passes it in passes `authBinding.getToken` instead (already the correct shape:
  `({force}) => Promise<string>`).
- Future desktop features (Files, Mail, Planner) call `graphJSON`/`graphList` directly
  with the same `authBinding.getToken` — no new plumbing needed.

## 3. Web integration (`OutlookService`)

- Replace the direct `acquireTokenSilent`/`acquireTokenPopup` + raw `fetch` calls with
  a small local adapter:
  ```js
  const getToken = async ({ force } = {}) => {
    if (!force) {
      try { return (await _app.acquireTokenSilent({ scopes: SCOPES, account: _account })).accessToken }
      catch (_) { /* fall through to popup */ }
    }
    const r = await _app.acquireTokenPopup({ scopes: SCOPES })
    _account = r.account
    return r.accessToken
  }
  ```
- `OutlookService`'s calendar methods call `graphJSON`/`graphFetch(getToken, ...)`
  instead of building requests by hand.
- Future web features reuse the same `getToken` adapter shape.

## 4. Manual/dev-only smoke check

- `apps/desktop/scripts/graph-smoke-test.js` (matches the existing
  `apps/desktop/scripts/create-icons.js` convention): reads an access token from
  `process.env.GRAPH_TOKEN`, calls `graphJSON(() => token, '/me')`, and prints the
  result.
- New `apps/desktop/package.json` script: `"graph:smoke": "node scripts/graph-smoke-test.js"`.
- Run manually during development (`GRAPH_TOKEN=... npm run graph:smoke`, token
  copied from a debug log during a real sign-in) to confirm real OAuth + Graph wiring
  end-to-end. Not part of the automated test suite or CI — `/me` only requires
  `User.Read`, already granted on both platforms, making it the lowest-permission
  real-world check available.

## 5. Testing

- **`graph-client.test.js`** (mocked `fetch`):
  - `graphFetch`/`graphJSON` prefix the base URL correctly for a relative path.
  - `graphJSON(getToken, '/me')` issues `GET https://graph.microsoft.com/v1.0/me` and
    returns the parsed JSON body (the minimal-permission example case, `User.Read` only).
  - A 401 response triggers exactly one `getToken({ force: true })` call and one retry;
    a second 401 throws.
  - A non-2xx (non-401) response throws `Error` containing `(<status>)` in the message.
  - `graphList` concatenates `value` across two pages linked by `@odata.nextLink` and
    stops when it's absent.
- **`ms-graph-calendar.test.js`** (existing, updated): pass a `getToken` stub instead of
  a raw token string; assert the same request shapes/results as before the refactor.
- **`OutlookService`/calendar view tests** (existing, updated): mock the `getToken`
  adapter's underlying MSAL calls instead of asserting on raw `fetch` calls directly;
  behavior (event list mapping, create-event body) stays identical.

## Out of scope
- Building any new feature on top of the client (Files browsing, Mail, Planner) — this
  spec only lands the shared client and the two refactors. New scopes and features are
  separate follow-ups, added one at a time as each is actually built.
- Touching `OneDriveProvider`/`GoogleDriveProvider` or `packages/ui/src/cloud/providers.js`
  — that `authedFetch` helper stays as-is for the profile-sync object store.
- Adding `@microsoft/microsoft-graph-client` or any other Graph SDK dependency.
