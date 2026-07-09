# Graph API Permissions Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Permissions" diagnostic card to the desktop app's Settings → Integrations tab that shows, per Graph scope (User.Read / Calendars.ReadWrite / Files.ReadWrite), whether the current Microsoft token was granted that scope and whether a live call to the matching resource actually succeeds — so a 403 on calendar/OneDrive can be attributed to "scope never granted" vs. "scope granted but still forbidden."

**Architecture:** Client-side only, inside `apps/desktop`. A new `decodeJwtClaims` export in `cloud-auth.js` decodes the JWT payload (generalizing the existing `jwtExpiryMs` inline decode). A new `useGraphPresetRunner` hook in `desktop-settings.jsx` extracts the existing "call a Graph preset, capture result/error" logic out of `GraphApiTestCard` so both it and the new `GraphPermissionsCard` share one code path. `GraphPermissionsCard` combines the decoded `scp` claim with a live probe of each existing `GRAPH_TEST_PRESETS` entry and renders a per-scope Yes/No + OK/Failed table, running automatically on mount with a manual refresh button.

**Tech Stack:** React (no new dependency), Vitest + @testing-library/react for tests, existing `graphJSON` from `@nexusmd/ui`.

## Global Constraints
- No backend/server changes — this is 100% client-side in `apps/desktop`.
- No new npm dependency — JWT decoding stays manual base64 (`atob` + string replace), matching the existing `jwtExpiryMs` approach.
- Reuse `GRAPH_TEST_PRESETS` (`apps/desktop/src/desktop-settings.jsx:425-454`) as the single source of truth for which Graph path each scope maps to — do not add a second/duplicate preset list.
- `offline_access` is excluded from the scope table (not a resource scope, no Graph call to probe).
- Run tests from `apps/desktop` (its own `vitest run`), not the repo root — this workspace's vitest config doesn't resolve from root per prior project notes.

---

### Task 1: `decodeJwtClaims` in `cloud-auth.js`

**Files:**
- Modify: `apps/desktop/src/cloud-auth.js:157-167` (the `jwtExpiryMs` function)
- Test: `apps/desktop/src/cloud-auth.test.js`

**Interfaces:**
- Consumes: nothing new (pure refactor of existing inline decode logic).
- Produces: `export function decodeJwtClaims(token: string): object | null` — decodes a JWT's payload segment and returns the parsed claims object, or `null` if the token isn't a decodable JWT. Later tasks (`GraphPermissionsCard`) import this from `./cloud-auth.js` and read `claims.scp`.

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/src/cloud-auth.test.js`, after the existing `b64url`/`jwtWithExp` helpers (around line 14):

```js
const jwtWithClaims = (claims) => `eyJhbGciOiJub25lIn0.${b64url(claims)}.sig`
```

Add a new `describe` block at the end of the file (after the `setManualMicrosoftToken` block, i.e. after line 102):

```js
describe('decodeJwtClaims', () => {
  it('decodes claims from a valid JWT', () => {
    const token = jwtWithClaims({ scp: 'User.Read Calendars.ReadWrite', exp: 123 })
    expect(decodeJwtClaims(token)).toEqual({ scp: 'User.Read Calendars.ReadWrite', exp: 123 })
  })

  it('returns null for a malformed token', () => {
    expect(decodeJwtClaims('not-a-jwt')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(decodeJwtClaims('')).toBeNull()
  })
})
```

Add `decodeJwtClaims` to the existing import line (line 10):

```js
import { makeNativeGoogleBinding, makeNativeMicrosoftBinding, setManualMicrosoftToken, decodeJwtClaims } from './cloud-auth.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/desktop`): `npx vitest run src/cloud-auth.test.js`
Expected: FAIL — `decodeJwtClaims is not a function` (or `undefined`), since it isn't exported yet.

- [ ] **Step 3: Write minimal implementation**

Replace `jwtExpiryMs` in `apps/desktop/src/cloud-auth.js` (lines 157-167):

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

// Best-effort read of a JWT's `exp` (seconds since epoch) so a pasted token
// expires locally when Graph would actually reject it. Returns null if the
// token isn't a decodable JWT (getToken then falls back to a short TTL).
function jwtExpiryMs(token) {
  const claims = decodeJwtClaims(token)
  return Number.isFinite(claims?.exp) ? claims.exp * 1000 : null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `apps/desktop`): `npx vitest run src/cloud-auth.test.js`
Expected: PASS — all tests in the file, including the existing `setManualMicrosoftToken` JWT-expiry tests (unaffected by the refactor) and the three new `decodeJwtClaims` tests.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/cloud-auth.js apps/desktop/src/cloud-auth.test.js
git commit -m "refactor(desktop): extract decodeJwtClaims from jwtExpiryMs"
```

---

### Task 2: Extract `useGraphPresetRunner` hook and refactor `GraphApiTestCard`

**Files:**
- Modify: `apps/desktop/src/desktop-settings.jsx:491-532` (`GraphApiTestCard`)
- Test: `apps/desktop/src/desktop-settings.test.jsx`

**Interfaces:**
- Consumes: `graphJSON(getToken, path)` from `@nexusmd/ui` (already imported at the top of `desktop-settings.jsx`); `GRAPH_TEST_PRESETS` (already defined at line 425-454, each entry `{ id, label, help, path }` where `path` is a string or a zero-arg function returning a string).
- Produces: `function useGraphPresetRunner(getToken)` returning `{ results, run }` where `results` is `{ [presetId]: { loading?: true } | { data: object } | { error: string } }` and `run` is `async (preset) => void`. Task 3 (`GraphPermissionsCard`) imports and calls this hook directly (same file, no new export needed since both live in `desktop-settings.jsx`).

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/src/desktop-settings.test.jsx`. First, extend the `@nexusmd/ui` mock (around line 20-37) to include `graphJSON`:

```js
vi.mock('@nexusmd/ui', () => ({
  // ...existing entries stay unchanged...
  graphJSON: vi.fn(),
}))
```

(Insert `graphJSON: vi.fn(),` as a new line inside the existing mock object — do not remove any existing entries.)

Then add a new `describe` block at the end of the test file:

```js
describe('GraphApiTestCard (Integrations tab)', () => {
  it('runs a preset and shows the JSON result', async () => {
    const { graphJSON } = await import('@nexusmd/ui')
    graphJSON.mockResolvedValueOnce({ displayName: 'Test User' })
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }))
    const runButtons = screen.getAllByRole('button', { name: /Run/i })
    fireEvent.click(runButtons[0])
    expect(await screen.findByText(/Test User/)).toBeTruthy()
  })

  it('shows an error message when the preset call fails', async () => {
    const { graphJSON } = await import('@nexusmd/ui')
    graphJSON.mockRejectedValueOnce(new Error('Graph request failed (403): /me'))
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }))
    const runButtons = screen.getAllByRole('button', { name: /Run/i })
    fireEvent.click(runButtons[0])
    expect(await screen.findByText(/Graph request failed \(403\)/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/desktop`): `npx vitest run src/desktop-settings.test.jsx -t "GraphApiTestCard"`
Expected: FAIL — `graphJSON.mockResolvedValueOnce is not a function` (since `graphJSON` isn't in the mock yet) until Step 1's mock edit is in place; after adding the mock, this should actually PASS against the *current* unrefactored `GraphApiTestCard`, confirming the hook extraction in Step 3 is a pure refactor. Run it once before Step 3 to confirm it passes against existing code, so Step 3's refactor is verified not to change behavior.

- [ ] **Step 3: Extract the hook (refactor, no behavior change)**

Replace `GraphApiTestCard` (lines 491-532) in `apps/desktop/src/desktop-settings.jsx`:

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

function GraphApiTestCard() {
  const { getToken } = React.useMemo(() => makeNativeMicrosoftBinding(), [])
  const { results, run } = useGraphPresetRunner(getToken)

  return (
    <VsCard title="Graph API Test" icon="build">
      {GRAPH_TEST_PRESETS.map(preset => {
        const result = results[preset.id]
        return (
          <VsFullRow key={preset.id} title={preset.label} desc={preset.help}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn sm" onClick={() => run(preset)} disabled={result?.loading}>
                <Icon name="play" size={11} /> {result?.loading ? 'Running…' : 'Run'}
              </button>
            </div>
            {result && !result.loading && (
              <pre style={{
                marginTop: 8, padding: '8px 10px', borderRadius: 8,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                fontSize: 11.5, lineHeight: 1.5, overflowX: 'auto', maxHeight: 240,
                color: result.error ? 'var(--danger)' : 'var(--text)',
              }}>
                {result.error || JSON.stringify(result.data, null, 2)}
              </pre>
            )}
          </VsFullRow>
        )
      })}
    </VsCard>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `apps/desktop`): `npx vitest run src/desktop-settings.test.jsx`
Expected: PASS — all tests in the file, including the two new `GraphApiTestCard` tests and the existing `shows Integrations tab content when clicked` test.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/desktop-settings.jsx apps/desktop/src/desktop-settings.test.jsx
git commit -m "refactor(desktop): extract useGraphPresetRunner hook from GraphApiTestCard"
```

---

### Task 3: `GraphPermissionsCard` — scope-to-preset map and combined diagnosis

**Files:**
- Modify: `apps/desktop/src/desktop-settings.jsx` (add new constant + component near `GRAPH_TEST_PRESETS`/`GraphApiTestCard`; wire into `IntegrationsPanel`)
- Modify: import line at top of `apps/desktop/src/desktop-settings.jsx:17` to add `decodeJwtClaims`
- Test: `apps/desktop/src/desktop-settings.test.jsx`

**Interfaces:**
- Consumes: `decodeJwtClaims(token)` from `./cloud-auth.js` (Task 1); `useGraphPresetRunner(getToken)` returning `{ results, run }` (Task 2); `GRAPH_TEST_PRESETS` (existing, `{ id, label, help, path }` entries with ids `'me'`, `'calendar'`, `'onedrive'`); `makeNativeMicrosoftBinding()` returning `{ getToken }`.
- Produces: `GRAPH_SCOPE_CHECKS` constant and `GraphPermissionsCard` component, rendered inside `IntegrationsPanel` above `GraphApiTestCard`. Nothing outside this file consumes them.

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/src/desktop-settings.test.jsx`. First, update the `./cloud-auth.js` mock (lines 6-11) to include `decodeJwtClaims` and a controllable `getToken`:

```js
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
  makeNativeGoogleBinding: () => ({ isConnected: () => false, connect: vi.fn(), disconnect: vi.fn() }),
  makeNativeMicrosoftBinding: () => ({ isConnected: () => false, connect: vi.fn(), disconnect: vi.fn(), getToken: vi.fn(() => Promise.resolve('fake.token.value')) }),
  decodeJwtClaims: vi.fn(),
}))
```

Then add a new `describe` block at the end of the test file:

```js
describe('GraphPermissionsCard', () => {
  it('shows granted/not-granted per scope from the decoded token, and live check results', async () => {
    const { graphJSON } = await import('@nexusmd/ui')
    const { decodeJwtClaims } = await import('./cloud-auth.js')
    decodeJwtClaims.mockReturnValue({ scp: 'User.Read Calendars.ReadWrite' })
    graphJSON.mockImplementation((getToken, path) => {
      if (path.includes('/me/drive')) return Promise.reject(new Error('Graph request failed (403): /me/drive'))
      return Promise.resolve({ ok: true })
    })

    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }))

    // User.Read and Calendars.ReadWrite are granted; Files.ReadWrite is not.
    expect(await screen.findAllByText('Yes')).toHaveLength(2)
    expect(screen.getAllByText('No')).toHaveLength(1)

    // Live check: me + calendar succeed, onedrive fails with the 403 message surfaced.
    expect(await screen.findAllByText('OK')).toHaveLength(2)
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText(/Graph request failed \(403\): \/me\/drive/)).toBeTruthy()
  })

  it('re-runs the diagnosis when Refresh is clicked', async () => {
    const { graphJSON } = await import('@nexusmd/ui')
    const { decodeJwtClaims } = await import('./cloud-auth.js')
    decodeJwtClaims.mockReturnValue({ scp: '' })
    graphJSON.mockResolvedValue({ ok: true })

    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }))
    await screen.findAllByText('No') // initial auto-run completes

    const callsBefore = graphJSON.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findAllByText('OK')
    expect(graphJSON.mock.calls.length).toBeGreaterThan(callsBefore)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/desktop`): `npx vitest run src/desktop-settings.test.jsx -t "GraphPermissionsCard"`
Expected: FAIL — no "Refresh" button / no "Yes"/"No"/"OK"/"Failed" text exists yet, since `GraphPermissionsCard` doesn't exist.

- [ ] **Step 3: Implement `GRAPH_SCOPE_CHECKS` and `GraphPermissionsCard`**

Add `decodeJwtClaims` to the `./cloud-auth.js` import at the top of `apps/desktop/src/desktop-settings.jsx` (line 17):

```js
import { desktopCloudProviders, makeNativeGoogleBinding, makeNativeMicrosoftBinding, setManualMicrosoftToken, decodeJwtClaims } from './cloud-auth.js'
```

Add the following directly after the `GRAPH_TEST_PRESETS` constant (after line 454, before `GraphManualTokenCard`):

```js
// Maps each Graph scope the desktop app actually requests (see
// apps/desktop/electron/oauth/config.cjs) to the GRAPH_TEST_PRESETS entry
// that exercises it. offline_access is excluded — it isn't a resource scope
// and has no corresponding Graph call to probe.
const GRAPH_SCOPE_CHECKS = [
  { scope: 'User.Read', label: 'Sign-in / profile', presetId: 'me' },
  { scope: 'Calendars.ReadWrite', label: 'Calendar', presetId: 'calendar' },
  { scope: 'Files.ReadWrite', label: 'OneDrive', presetId: 'onedrive' },
]

// Cross-references the token's granted scopes (from decodeJwtClaims) against
// a live call to each resource, so a 403 can be attributed to "scope never
// granted" vs. "scope granted but still forbidden" (admin consent, licensing,
// conditional access, etc).
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

Wire it into `IntegrationsPanel` — in `apps/desktop/src/desktop-settings.jsx`, find:

```js
      <IntegrationsView services={oauthServices} />
      <GraphManualTokenCard />
      <GraphApiTestCard />
```

Replace with:

```js
      <IntegrationsView services={oauthServices} />
      <GraphManualTokenCard />
      <GraphPermissionsCard />
      <GraphApiTestCard />
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `apps/desktop`): `npx vitest run src/desktop-settings.test.jsx`
Expected: PASS — all tests in the file, including both new `GraphPermissionsCard` tests and every previously-passing test (Task 2's `GraphApiTestCard` tests, the `shows Integrations tab content when clicked` test, and all other existing suites in the file).

- [ ] **Step 5: Run the full desktop test suite**

Run (from `apps/desktop`): `npx vitest run`
Expected: PASS — no regressions elsewhere in `apps/desktop` from the `cloud-auth.js` export change or the `desktop-settings.jsx` edits.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/desktop-settings.jsx apps/desktop/src/desktop-settings.test.jsx
git commit -m "feat(desktop): add Graph permissions diagnostic to Integrations settings"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 covers §1 (`decodeJwtClaims`); Task 2 covers §2 (shared preset runner, refactor `GraphApiTestCard` with no behavior change — verified via the pre-existing-code-passes check in Task 2 Step 2); Task 3 covers §3 (scope-to-preset map) and §4 (`GraphPermissionsCard`, auto-run on mount + manual refresh, wired above `GraphApiTestCard` in `IntegrationsPanel`). §5 (testing) is folded into each task's own test steps rather than a separate task, since each piece's tests are only meaningful once that piece exists.
- **Placeholder scan:** no TBD/TODO; every step has literal code or exact commands.
- **Type consistency:** `useGraphPresetRunner(getToken)` → `{ results, run }` used identically in Task 2's `GraphApiTestCard` and Task 3's `GraphPermissionsCard`. `GRAPH_TEST_PRESETS` entry shape `{ id, label, help, path }` and preset ids (`'me'`, `'calendar'`, `'onedrive'`) match `GRAPH_SCOPE_CHECKS`'s `presetId` values. `decodeJwtClaims(token) => object | null` signature matches both its Task 1 test and its Task 3 usage (`claims?.scp`).
