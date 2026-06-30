# OAuth Settings Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared "Integrations" settings tab with `OAuthServiceCard` and `IntegrationsView` to all three platforms (web, desktop, app), covering ADO OAuth, Microsoft/Entra ID, and GitHub OAuth App — each with admin credential config and user connect/disconnect.

**Architecture:** `OAuthServiceCard` and `IntegrationsView` live in `packages/ui/src/views/view-settings.jsx` and are driven entirely by a per-platform service descriptor object injected as props — no platform glue inside the shared component. Each platform's `cloud-auth.js` is extended with the three new service bindings and callback handlers, then wired into each platform's settings view.

**Tech Stack:** React 18, Vitest + @testing-library/react, localStorage for token/credential storage per-profile, `getProfileKey()` for profile-scoped keys.

## Global Constraints

- All localStorage keys are profile-scoped via `getProfileKey('nexusmd.<suffix>')` (web/desktop) or `getProfileKey('helm.<suffix>')` (app).
- New shared components follow the `React.useState` / `React.useEffect` style used in `CloudSyncCard` — not the aliased `useStateVS` style used in older components in the same file.
- `toast?.('message', 'type')` — always optional-chain; `toast` may be undefined in test environments.
- Tests run with `npx vitest run` from `packages/ui/`.
- No backend route changes are in scope. `connect()` will toast an error if `/api/<service>/auth/url` returns non-OK.

---

### Task 1: `OAuthServiceCard` + `IntegrationsView` in shared package

**Files:**
- Modify: `packages/ui/src/views/view-settings.jsx` — add `OAuthServiceCard`, `IntegrationsView` at the bottom before the exports block
- Modify: `packages/ui/src/index.js` — add `IntegrationsView` and `OAuthServiceCard` to the settings exports line
- Modify: `packages/ui/tests/settings.test.jsx` — add tests for the new components

**Interfaces:**
- Produces:
  - `OAuthServiceCard({ service })` where `service` is `{ id, label, icon, desc, isConnected, connect, disconnect, credFields, loadCreds, saveCreds, children? }`
  - `IntegrationsView({ services })` — renders one `OAuthServiceCard` per entry in the array
  - `credFields` shape: `[{ key: string, label: string, hint?: string, secret?: boolean }]`
  - `loadCreds()` returns `Record<string, string>` (e.g. `{ clientId: '...', clientSecret: '...' }`)
  - `saveCreds(creds: Record<string, string>)` — may be sync or async; always called with `await`

- [ ] **Step 1: Write failing tests**

Add this block at the bottom of `packages/ui/tests/settings.test.jsx`, inside the existing `describe` block:

```jsx
describe('OAuthServiceCard', () => {
  function makeService(overrides = {}) {
    return {
      id: 'github',
      label: 'GitHub',
      icon: 'pr',
      desc: 'GitHub OAuth App',
      isConnected: vi.fn(() => false),
      connect: vi.fn(),
      disconnect: vi.fn(),
      credFields: [
        { key: 'clientId', label: 'Client ID' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
      loadCreds: vi.fn(() => ({})),
      saveCreds: vi.fn(),
      ...overrides,
    }
  }

  it('shows "Not configured" badge when credentials are empty', () => {
    const { container } = render(<OAuthServiceCard service={makeService()} />)
    expect(container.textContent).toContain('Not configured')
    expect(container.textContent).not.toContain('Configured')
  })

  it('shows "Configured" badge when all credential fields are filled', () => {
    const { container } = render(
      <OAuthServiceCard service={makeService({
        loadCreds: vi.fn(() => ({ clientId: 'abc', clientSecret: 'xyz' })),
      })} />,
    )
    expect(container.textContent).toContain('Configured')
  })

  it('shows service label and Connect button when disconnected', () => {
    const { container } = render(<OAuthServiceCard service={makeService()} />)
    expect(container.textContent).toContain('GitHub')
    expect(container.textContent).toContain('Connect GitHub')
  })

  it('shows Connected pill and Disconnect button when connected', () => {
    const { container } = render(
      <OAuthServiceCard service={makeService({ isConnected: vi.fn(() => true) })} />,
    )
    expect(container.textContent).toContain('Connected')
    const disco = [...container.querySelectorAll('button')].find(b => b.textContent === 'Disconnect')
    expect(disco).toBeTruthy()
  })

  it('clicking Connect with missing creds opens credentials form and shows error', () => {
    const { container } = render(<OAuthServiceCard service={makeService()} />)
    const connectBtn = [...container.querySelectorAll('button')].find(b => b.textContent === 'Connect GitHub')
    connectBtn.click()
    expect(container.textContent).toContain('Enter Client ID and Secret first')
  })

  it('clicking Connect with creds filled calls connect()', () => {
    const connect = vi.fn()
    const { container } = render(
      <OAuthServiceCard service={makeService({
        connect,
        loadCreds: vi.fn(() => ({ clientId: 'abc', clientSecret: 'xyz' })),
      })} />,
    )
    const connectBtn = [...container.querySelectorAll('button')].find(b => b.textContent === 'Connect GitHub')
    connectBtn.click()
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('clicking Disconnect calls disconnect()', () => {
    const disconnect = vi.fn()
    const { container } = render(
      <OAuthServiceCard service={makeService({ isConnected: vi.fn(() => true), disconnect })} />,
    )
    const disco = [...container.querySelectorAll('button')].find(b => b.textContent === 'Disconnect')
    disco.click()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('renders children inside the card', () => {
    const service = { ...makeService(), children: <div>custom-child</div> }
    const { container } = render(<OAuthServiceCard service={service} />)
    expect(container.textContent).toContain('custom-child')
  })
})

describe('IntegrationsView', () => {
  it('renders one OAuthServiceCard per service', () => {
    const makeS = (id, label) => ({
      id, label, icon: 'pr', desc: '', isConnected: () => false,
      connect: vi.fn(), disconnect: vi.fn(),
      credFields: [], loadCreds: () => ({}), saveCreds: vi.fn(),
    })
    const { container } = render(
      <IntegrationsView services={[makeS('ado', 'Azure DevOps'), makeS('github', 'GitHub')]} />,
    )
    expect(container.textContent).toContain('Azure DevOps')
    expect(container.textContent).toContain('GitHub')
  })
})
```

Also add `OAuthServiceCard, IntegrationsView` to the import at the top of the test file:

```js
import {
  NexusDataProvider, PlToggle, VsRow, VsSeg, VsProfileEditor, VsProfiles, PROFILE_COLORS,
  OAuthServiceCard, IntegrationsView,
} from '../src/index.js'
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/ui && npx vitest run tests/settings.test.jsx
```

Expected: multiple FAIL lines — `OAuthServiceCard is not a function` / `IntegrationsView is not a function`.

- [ ] **Step 3: Implement `OAuthServiceCard` and `IntegrationsView`**

In `packages/ui/src/views/view-settings.jsx`, add these two functions **before** the `export {` block at the bottom:

```jsx
// ── OAuth integration card ────────────────────────────────────────
// service: { id, label, icon, desc, isConnected, connect, disconnect,
//            credFields, loadCreds, saveCreds, children? }
function OAuthServiceCard({ service }) {
  const {
    label, icon, desc,
    isConnected, connect, disconnect,
    credFields, loadCreds, saveCreds,
    children,
  } = service;

  const [connected, setConnected] = React.useState(() => isConnected());
  const [credsOpen, setCredsOpen] = React.useState(false);
  const [creds, setCreds] = React.useState(() => loadCreds());
  const [saving, setSaving] = React.useState(false);
  const [credErr, setCredErr] = React.useState('');

  React.useEffect(() => {
    const refresh = () => setConnected(isConnected());
    window.addEventListener('focus', refresh);
    window.addEventListener('nexusmd:cloud-auth-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('nexusmd:cloud-auth-changed', refresh);
    };
  }, [isConnected]);

  const allCredsFilled = credFields.every(f => (creds[f.key] || '').trim());

  const handleConnect = async () => {
    if (!allCredsFilled) {
      setCredErr('Enter Client ID and Secret first.');
      setCredsOpen(true);
      return;
    }
    setCredErr('');
    try { await connect(); setConnected(isConnected()); } catch (_) {}
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      setConnected(false);
      toast?.(`${label} disconnected.`, 'success');
    } catch (_) {}
  };

  const handleSaveCreds = async () => {
    setSaving(true);
    try {
      await saveCreds(creds);
      toast?.('Credentials saved.', 'success');
      setCredsOpen(false);
      setCredErr('');
    } catch (_) {
      toast?.('Could not save credentials.', 'error');
    } finally { setSaving(false); }
  };

  const inputStyle = {
    width: '100%', padding: '6px 10px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--surface-2)',
    font: 'inherit', fontSize: 13, color: 'var(--text)',
  };

  return (
    <VsCard title={label} icon={icon}>
      <div className="set-row" style={{ cursor: 'pointer' }} onClick={() => setCredsOpen(o => !o)}>
        <div className="info">
          <div className="t">App credentials</div>
          <div className="d">{desc}</div>
        </div>
        {allCredsFilled
          ? <span className="pill success"><span className="dot"></span>Configured</span>
          : <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Not configured</span>}
        <button className="btn sm ghost" onClick={e => { e.stopPropagation(); setCredsOpen(o => !o); }}>
          {credsOpen ? 'Hide' : 'Edit'}
        </button>
      </div>
      {credsOpen && (
        <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {credFields.map(f => (
            <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>
                {f.label}
              </label>
              <input
                type={f.secret ? 'password' : 'text'}
                value={creds[f.key] || ''}
                onChange={e => setCreds(c => ({ ...c, [f.key]: e.target.value }))}
                style={inputStyle}
              />
              {f.hint && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{f.hint}</span>}
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
            These credentials are shared across all users of this instance.
          </div>
          {credErr && <div className="plm-callout err">{credErr}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn sm primary" onClick={handleSaveCreds} disabled={saving}>
              {saving ? 'Saving…' : 'Save credentials'}
            </button>
          </div>
        </div>
      )}
      <VsRow
        title="Connection"
        desc={connected ? `Connected to ${label}` : `Not connected to ${label}`}>
        {connected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="pill success"><span className="dot"></span>Connected</span>
            <button className="btn sm ghost danger" onClick={handleDisconnect}>Disconnect</button>
          </div>
        ) : (
          <button className="btn sm ghost" onClick={handleConnect}>Connect {label}</button>
        )}
      </VsRow>
      {children}
    </VsCard>
  );
}

function IntegrationsView({ services }) {
  return (
    <React.Fragment>
      {services.map(s => <OAuthServiceCard key={s.id} service={s} />)}
    </React.Fragment>
  );
}
```

- [ ] **Step 4: Add to exports in `packages/ui/src/views/view-settings.jsx`**

Find the existing export block at the bottom of the file:

```js
export {
  PROFILE_COLORS,
  PlToggle, VsRow, VsCard, VsFullRow, ThemeChipPicker, VsSeg,
  VsPasswordModal, VsProfileEditor, VsProfiles,
  BundlePasswordModal, BackupRestoreCard, CloudPickerModal, CloudSyncCard,
};
```

Replace with:

```js
export {
  PROFILE_COLORS,
  PlToggle, VsRow, VsCard, VsFullRow, ThemeChipPicker, VsSeg,
  VsPasswordModal, VsProfileEditor, VsProfiles,
  BundlePasswordModal, BackupRestoreCard, CloudPickerModal, CloudSyncCard,
  OAuthServiceCard, IntegrationsView,
};
```

- [ ] **Step 5: Export from `packages/ui/src/index.js`**

Find this line in `packages/ui/src/index.js`:

```js
  BundlePasswordModal, BackupRestoreCard, CloudPickerModal, CloudSyncCard,
} from './views/view-settings.jsx'
```

Replace with:

```js
  BundlePasswordModal, BackupRestoreCard, CloudPickerModal, CloudSyncCard,
  OAuthServiceCard, IntegrationsView,
} from './views/view-settings.jsx'
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd packages/ui && npx vitest run tests/settings.test.jsx
```

Expected: all tests pass, including the 8 new ones.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/views/view-settings.jsx packages/ui/src/index.js packages/ui/tests/settings.test.jsx
git commit -m "feat(ui): add OAuthServiceCard and IntegrationsView shared components"
```

---

### Task 2: Wire `IntegrationsView` into the web app

**Files:**
- Modify: `apps/web/src/cloud-auth.js` — extend `PROVIDERS` + `handleCloudOAuthCallback` with ADO, Microsoft, GitHub
- Modify: `apps/web/src/view-settings.jsx` — replace `connection` tab with `integrations`, add three service descriptors, import `IntegrationsView`

**Interfaces:**
- Consumes: `IntegrationsView` from `@nexusmd/ui`; `getProfileKey` from `./profile-keys.js`; `toast` from `./toast.jsx`; `GitHubClient` from `./github-client.js` (already imported)

- [ ] **Step 1: Extend `apps/web/src/cloud-auth.js`**

Replace the `PROVIDERS` constant (currently lines with `gdrive` and `onedrive` only):

```js
const PROVIDERS = {
  gdrive:    { keySuffix: 'gdrive.auth',    api: '/api/google/auth', from: 'gdrive' },
  onedrive:  { keySuffix: 'onedrive.auth',  api: '/api/ms/auth',     from: 'onedrive' },
  ado:       { keySuffix: 'ado.auth',       api: '/api/ado/auth',    from: 'ado' },
  microsoft: { keySuffix: 'microsoft.auth', api: '/api/ms/auth',     from: 'microsoft' },
  github:    { keySuffix: 'github.auth',    api: '/api/github/auth', from: 'github' },
}
```

Then add three exported binding factory calls after the existing `webCloudProviders` export, at the bottom of the file (before the DOMContentLoaded guard):

```js
export function makeWebOAuthService(from) {
  const cfg = PROVIDERS[from]
  return {
    isConnected: () => Boolean(read(cfg.keySuffix)?.accessToken),
    async connect() {
      try {
        const redirectUri = window.location.origin + '/?from=' + cfg.from
        const res = await fetch(`${cfg.api}/url?redirectUri=${encodeURIComponent(redirectUri)}`,
          { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) { toast?.(`${from} sign-in is not configured on the server.`, 'error'); return }
        const { url } = await res.json()
        window.location.href = url
      } catch { toast?.(`Could not reach ${from} sign-in.`, 'error') }
    },
    async disconnect() {
      clear(cfg.keySuffix)
      document.dispatchEvent(new CustomEvent('nexusmd:cloud-auth-changed'))
    },
    loadCreds() {
      try { const k = getProfileKey('nexusmd.' + from + '.oauthCreds'); return k ? JSON.parse(localStorage.getItem(k) || '{}') : {} }
      catch { return {} }
    },
    saveCreds(c) {
      try { const k = getProfileKey('nexusmd.' + from + '.oauthCreds'); if (k) localStorage.setItem(k, JSON.stringify(c)) } catch {}
    },
  }
}
```

The existing `handleCloudOAuthCallback` already handles any `from` key in `PROVIDERS` — no change needed to it because extending `PROVIDERS` automatically makes `gdrive`, `onedrive`, `ado`, `microsoft`, `github` all handled.

- [ ] **Step 2: Import `IntegrationsView` in the web settings file**

In `apps/web/src/view-settings.jsx`, find the existing import from `@nexusmd/ui`:

```js
import {
  PlToggle, VsRow, VsCard, VsFullRow, ThemeChipPicker, VsSeg, VsPasswordModal, VsProfiles, BackupRestoreCard, CloudSyncCard,
} from '@nexusmd/ui'
```

Replace with:

```js
import {
  PlToggle, VsRow, VsCard, VsFullRow, ThemeChipPicker, VsSeg, VsPasswordModal, VsProfiles, BackupRestoreCard, CloudSyncCard,
  IntegrationsView,
} from '@nexusmd/ui'
```

- [ ] **Step 3: Import `makeWebOAuthService` in the web settings file**

At the top of `apps/web/src/view-settings.jsx`, find:

```js
import { webFileIO } from './file-io.js'
import { webCloudProviders } from './cloud-auth.js'
import { webSync } from './sync.js'
```

Replace with:

```js
import { webFileIO } from './file-io.js'
import { webCloudProviders, makeWebOAuthService } from './cloud-auth.js'
import { webSync } from './sync.js'
```

- [ ] **Step 4: Build the three service descriptors in the web settings file**

In `apps/web/src/view-settings.jsx`, add this block of constants directly inside `SettingsView`, after the existing state declarations and before the `NAV` array (around line 362):

```js
  // OAuth integration service descriptors — one per service, passed to IntegrationsView.
  const adoOAuth = useStateVS(() => makeWebOAuthService('ado'))[0];
  const msOAuth  = useStateVS(() => makeWebOAuthService('microsoft'))[0];
  const ghOAuth  = useStateVS(() => ({
    ...makeWebOAuthService('github'),
  }))[0];

  const [ghRepos, setGhRepos] = useStateVS(() => {
    try { return JSON.parse(localStorage.getItem(`nexusmd.p.${localStorage.getItem('nexusmd.activeProfileId') || ''}.github.config`) || '{}').repos?.join(', ') || ''; }
    catch (_) { return ''; }
  });
  const [ghRepoBrowse, setGhRepoBrowse] = useStateVS([]);

  const saveGhRepos = () => {
    const activeId = localStorage.getItem('nexusmd.activeProfileId') || '';
    const key = `nexusmd.p.${activeId}.github.config`;
    const existing = (() => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } })();
    const repoList = ghRepos.split(',').map(s => s.trim()).filter(Boolean);
    localStorage.setItem(key, JSON.stringify({ ...existing, repos: repoList }));
    toast?.('GitHub repos saved.', 'success');
  };

  const browseGhRepos = async () => {
    try { const list = await GitHubClient?.getRepos(); setGhRepoBrowse(list || []); }
    catch (_) { toast?.('Could not fetch repos. Check your connection.', 'error'); }
  };

  const oauthServices = [
    {
      id: 'ado',
      label: 'Azure DevOps',
      icon: 'inbox',
      desc: 'OAuth 2.0 — work items, PRs, pipelines',
      ...adoOAuth,
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From your Azure DevOps OAuth application' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
    {
      id: 'microsoft',
      label: 'Microsoft / Entra ID',
      icon: 'mail',
      desc: 'Sign in with Microsoft — OneDrive, Teams, Calendar',
      ...msOAuth,
      credFields: [
        { key: 'clientId', label: 'Client ID (Application ID)', hint: 'From Azure portal → App registrations' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
    {
      id: 'github',
      label: 'GitHub',
      icon: 'pr',
      desc: 'GitHub OAuth App — pull requests and repo access',
      ...ghOAuth,
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From GitHub → Settings → Developer settings → OAuth Apps' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
      children: (
        <React.Fragment>
          <VsRow title="Repositories" desc="owner/repo pairs, comma-separated">
            <input
              value={ghRepos}
              onChange={e => setGhRepos(e.target.value)}
              placeholder="myorg/backend, myorg/frontend"
              style={{ width: 240, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }}
            />
          </VsRow>
          {ghRepoBrowse.length > 0 && (
            <VsRow title="Select from your repos" desc="">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ghRepoBrowse.map(r => (
                  <button key={r} type="button" className="pill" style={{ cursor: 'pointer' }}
                    onClick={() => setGhRepos(v => v.trim() ? v.trim() + ', ' + r : r)}>
                    {r}
                  </button>
                ))}
              </div>
            </VsRow>
          )}
          <div className="set-row" style={{ gap: 8 }}>
            <button className="btn sm ghost" onClick={browseGhRepos}>Browse repos…</button>
            <span style={{ flex: 1 }}/>
            <button className="btn sm primary" onClick={saveGhRepos}>Save repos</button>
          </div>
        </React.Fragment>
      ),
    },
  ];
```

- [ ] **Step 5: Update the NAV array and render block in `apps/web/src/view-settings.jsx`**

Find the NAV array (around line 362 in the original):

```js
  const NAV = [
    { id: 'profile', label: 'Profile', icon: 'team' },
    { id: 'appearance', label: 'Appearance', icon: 'sun' },
    { id: 'planner', label: 'Planner', icon: 'planner' },
    { id: 'profiles', label: 'Profiles', icon: 'more' },
    { id: 'privacy', label: 'Confidential', icon: 'lock' },
    { id: 'data', label: 'Data & sync', icon: 'inbox' },
    ...(!isManual ? [{ id: 'connection', label: 'Connection', icon: 'inbox' }] : []),
    ...(window.electronAPI ? [{ id: 'desktop', label: 'Desktop app', icon: 'more' }] : []),
  ];
```

Replace with:

```js
  const NAV = [
    { id: 'profile', label: 'Profile', icon: 'team' },
    { id: 'appearance', label: 'Appearance', icon: 'sun' },
    { id: 'planner', label: 'Planner', icon: 'planner' },
    { id: 'profiles', label: 'Profiles', icon: 'more' },
    { id: 'privacy', label: 'Confidential', icon: 'lock' },
    { id: 'data', label: 'Data & sync', icon: 'inbox' },
    { id: 'integrations', label: 'Integrations', icon: 'lock' },
    ...(window.electronAPI ? [{ id: 'desktop', label: 'Desktop app', icon: 'more' }] : []),
  ];
```

Then find the `connection` subpage render block at the bottom of the JSX:

```jsx
          {subPage === 'connection' && !isManual && (<>
            {useProfile?.()?.activeProfile?.type === 'github'
              ? <GitHubConnectionTab activeProfile={useProfile().activeProfile} />
              : (
                <VsCard title="Azure DevOps Connection" icon="inbox">
                  <VsRow title="Connection settings" desc="Org, PAT, projects, and email digest">
                    <button className="btn sm ghost" onClick={onOpenConnection}>Manage connection</button>
                  </VsRow>
                </VsCard>
              )
            }
            <GoogleConnectionCard />
          </>)}
```

Replace with:

```jsx
          {subPage === 'integrations' && (
            <>
              <IntegrationsView services={oauthServices} />
              <GoogleConnectionCard />
            </>
          )}
```

- [ ] **Step 6: Run the web dev server and verify manually**

```bash
cd apps/web && npm run dev
```

Navigate to Settings → Integrations. Confirm:
- Three cards appear: Azure DevOps, Microsoft / Entra ID, GitHub
- Each card shows "Not configured" / "Edit" in the credentials row
- Clicking "Edit" opens the credentials form
- Entering Client ID + Secret and clicking "Save credentials" saves and collapses the form, showing "Configured"
- Google Workspace card appears below the three cards
- Clicking "Connect Azure DevOps" with credentials shows a toast about server not configured (expected since backend route doesn't exist yet)
- Clicking "Connect Azure DevOps" *without* credentials shows the inline error

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/cloud-auth.js apps/web/src/view-settings.jsx
git commit -m "feat(web): add Integrations settings tab with ADO, Microsoft, GitHub OAuth cards"
```

---

### Task 3: Wire `IntegrationsView` into the desktop app

**Files:**
- Modify: `apps/desktop/src/cloud-auth.js` — extend `PROVIDERS` + `BY_FROM` + `redeem` for ADO, Microsoft, GitHub
- Modify: `apps/desktop/src/main.jsx` — add `integrations` nav item, build service descriptors, import + render `IntegrationsView`

**Interfaces:**
- Consumes: `IntegrationsView` from `@nexusmd/ui`; `VsRow` from `@nexusmd/ui`; `getProfileKey` from `./profile-keys.js`; `toast` from the toast module

- [ ] **Step 1: Extend `apps/desktop/src/cloud-auth.js`**

Replace the `PROVIDERS` constant:

```js
const PROVIDERS = {
  gdrive:    { keySuffix: 'gdrive.auth',    api: '/api/google/auth', from: 'gdrive' },
  onedrive:  { keySuffix: 'onedrive.auth',  api: '/api/ms/auth',     from: 'onedrive' },
  ado:       { keySuffix: 'ado.auth',       api: '/api/ado/auth',    from: 'ado' },
  microsoft: { keySuffix: 'microsoft.auth', api: '/api/ms/auth',     from: 'microsoft' },
  github:    { keySuffix: 'github.auth',    api: '/api/github/auth', from: 'github' },
}
```

Replace the `BY_FROM` constant:

```js
const BY_FROM = {
  gdrive:    PROVIDERS.gdrive,
  onedrive:  PROVIDERS.onedrive,
  ado:       PROVIDERS.ado,
  microsoft: PROVIDERS.microsoft,
  github:    PROVIDERS.github,
}
```

Add this exported function at the bottom of the file, before the closing of the module:

```js
export function makeDesktopOAuthService(from) {
  const cfg = PROVIDERS[from]
  return {
    isConnected: () => Boolean(read(cfg.keySuffix)?.accessToken),
    async connect() {
      try {
        const returnUri = `nexusmd://oauth/${cfg.from}`
        const res = await fetch(`${API_BASE}${cfg.api}/native-url?returnUri=${encodeURIComponent(returnUri)}`)
        if (!res.ok) { return }
        const { url } = await res.json()
        await window.electronAPI.openExternal(url)
      } catch {}
    },
    async disconnect() {
      clear(cfg.keySuffix)
      window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
    },
    loadCreds() {
      try { const k = getProfileKey('nexusmd.' + from + '.oauthCreds'); return k ? JSON.parse(localStorage.getItem(k) || '{}') : {} }
      catch { return {} }
    },
    saveCreds(c) {
      try { const k = getProfileKey('nexusmd.' + from + '.oauthCreds'); if (k) localStorage.setItem(k, JSON.stringify(c)) } catch {}
    },
  }
}
```

- [ ] **Step 2: Import `IntegrationsView`, `VsRow`, and `makeDesktopOAuthService` in `apps/desktop/src/main.jsx`**

Find the `@nexusmd/ui` import block in `apps/desktop/src/main.jsx`:

```js
import {
  Icon, CardFrame,
  NexusDataProvider, useNexusData, ToastHost,
  PRView, BuildsView, TestsView, TeamView, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
  VsProfiles, BackupRestoreCard, CloudSyncCard,
  PlannerView, MarkdownViewer, plannerExportDocx,
} from '@nexusmd/ui'
```

Replace with:

```js
import {
  Icon, CardFrame,
  NexusDataProvider, useNexusData, ToastHost,
  PRView, BuildsView, TestsView, TeamView, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
  VsProfiles, BackupRestoreCard, CloudSyncCard,
  IntegrationsView, VsRow,
  PlannerView, MarkdownViewer, plannerExportDocx,
} from '@nexusmd/ui'
```

Find the `cloud-auth.js` import:

```js
import { desktopCloudProviders, registerCloudDeepLink } from './cloud-auth.js'
```

Replace with:

```js
import { desktopCloudProviders, registerCloudDeepLink, makeDesktopOAuthService } from './cloud-auth.js'
```

- [ ] **Step 3: Add `integrations` to the desktop NAV array**

Find the `NAV` constant in `apps/desktop/src/main.jsx`:

```js
const NAV = [
  { id: 'dashboard', label: 'Dashboard',     icon: 'dashboard' },
  { id: 'work',      label: 'Work Items',     icon: 'work' },
  { id: 'prs',       label: 'Pull Requests',  icon: 'pr' },
  { id: 'builds',    label: 'Builds',         icon: 'build' },
  { id: 'tests',     label: 'Tests',          icon: 'check' },
  { id: 'team',      label: 'Team',           icon: 'team' },
  { id: 'triage',    label: 'Triage',         icon: 'work' },
  { id: 'planner',   label: 'Planner',        icon: 'planner' },
  { id: 'markdown',  label: 'Notes',          icon: 'pin' },
  { id: 'settings',  label: 'Settings',       icon: 'settings' },
]
```

Replace with:

```js
const NAV = [
  { id: 'dashboard',     label: 'Dashboard',     icon: 'dashboard' },
  { id: 'work',          label: 'Work Items',     icon: 'work' },
  { id: 'prs',           label: 'Pull Requests',  icon: 'pr' },
  { id: 'builds',        label: 'Builds',         icon: 'build' },
  { id: 'tests',         label: 'Tests',          icon: 'check' },
  { id: 'team',          label: 'Team',           icon: 'team' },
  { id: 'triage',        label: 'Triage',         icon: 'work' },
  { id: 'planner',       label: 'Planner',        icon: 'planner' },
  { id: 'markdown',      label: 'Notes',          icon: 'pin' },
  { id: 'integrations',  label: 'Integrations',   icon: 'lock' },
  { id: 'settings',      label: 'Settings',       icon: 'settings' },
]
```

- [ ] **Step 4: Add `IntegrationsPanel` function in `apps/desktop/src/main.jsx`**

Add this component function right before the main `App` function in `main.jsx`:

```jsx
function IntegrationsPanel() {
  const [ghRepos, setGhRepos] = React.useState(() => {
    try {
      const activeId = localStorage.getItem('nexusmd.activeProfileId') || ''
      const k = getProfileKey('nexusmd.github.repos')
      return k ? (localStorage.getItem(k) || '') : ''
    } catch { return '' }
  })

  const saveGhRepos = () => {
    try {
      const k = getProfileKey('nexusmd.github.repos')
      if (k) localStorage.setItem(k, ghRepos)
    } catch {}
  }

  const oauthServices = React.useMemo(() => [
    {
      id: 'ado',
      label: 'Azure DevOps',
      icon: 'inbox',
      desc: 'OAuth 2.0 — work items, PRs, pipelines',
      ...makeDesktopOAuthService('ado'),
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From your Azure DevOps OAuth application' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
    {
      id: 'microsoft',
      label: 'Microsoft / Entra ID',
      icon: 'mail',
      desc: 'Sign in with Microsoft — OneDrive, Teams, Calendar',
      ...makeDesktopOAuthService('microsoft'),
      credFields: [
        { key: 'clientId', label: 'Client ID (Application ID)', hint: 'From Azure portal → App registrations' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
    {
      id: 'github',
      label: 'GitHub',
      icon: 'pr',
      desc: 'GitHub OAuth App — pull requests and repo access',
      ...makeDesktopOAuthService('github'),
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From GitHub → Settings → Developer settings → OAuth Apps' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
      children: (
        <VsRow title="Repositories" desc="owner/repo pairs, comma-separated">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={ghRepos}
              onChange={e => setGhRepos(e.target.value)}
              placeholder="myorg/backend, myorg/frontend"
              style={{ width: 200, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }}
            />
            <button className="btn sm" onClick={saveGhRepos}>Save</button>
          </div>
        </VsRow>
      ),
    },
  ], [ghRepos])

  return (
    <div style={{ padding: '24px 0' }}>
      <IntegrationsView services={oauthServices} />
    </div>
  )
}
```

- [ ] **Step 5: Add the `integrations` render case in the desktop App component**

In `apps/desktop/src/main.jsx`, find where the `settings` view is rendered in the main App component. It will be in a block that renders views based on `activeView`. Look for the settings panel render — it likely renders `AdoConnectionCard` and profile cards. Find the section that handles different `activeView` values.

After the `settings` case block, add:

```jsx
{activeView === 'integrations' && <IntegrationsPanel />}
```

(Place it adjacent to the other view conditionals in the render tree.)

- [ ] **Step 6: Run the desktop app and verify manually**

```bash
cd apps/desktop && npm run dev
```

Click "Integrations" in the sidebar. Confirm three OAuth service cards appear, credentials can be saved, and the GitHub repos field works.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/cloud-auth.js apps/desktop/src/main.jsx
git commit -m "feat(desktop): add Integrations nav item and OAuth service cards"
```

---

### Task 4: Wire `IntegrationsView` into the mobile app

**Files:**
- Modify: `apps/app/src/cloud-auth.js` — extend `PROVIDERS` + `BY_FROM` for ADO, Microsoft, GitHub
- Modify: `apps/app/src/views/view-settings.jsx` — add `integrations` nav item, build service descriptors, import + render `IntegrationsView`

**Interfaces:**
- Consumes: `IntegrationsView` from `@nexusmd/ui`; `deepLinkAdapter` from `../adapters/deepLink.js`; `secureStorageAdapter` from `../adapters/secureStorage.js`; `getProfileKey` from `../profile-keys.js`

Note: the app uses `helm.*` key namespace and `secureStorageAdapter` for token storage (not plain localStorage). Credentials (`oauthCreds`) use `secureStorageAdapter` as well for consistency.

- [ ] **Step 1: Extend `apps/app/src/cloud-auth.js`**

Replace the `PROVIDERS` constant:

```js
const PROVIDERS = {
  gdrive:    { keySuffix: 'gdrive.auth',    api: '/api/google/auth', from: 'gdrive' },
  onedrive:  { keySuffix: 'onedrive.auth',  api: '/api/ms/auth',     from: 'onedrive' },
  ado:       { keySuffix: 'ado.auth',       api: '/api/ado/auth',    from: 'ado' },
  microsoft: { keySuffix: 'microsoft.auth', api: '/api/ms/auth',     from: 'microsoft' },
  github:    { keySuffix: 'github.auth',    api: '/api/github/auth', from: 'github' },
}
```

Replace the `BY_FROM` constant:

```js
const BY_FROM = {
  gdrive:    PROVIDERS.gdrive,
  onedrive:  PROVIDERS.onedrive,
  ado:       PROVIDERS.ado,
  microsoft: PROVIDERS.microsoft,
  github:    PROVIDERS.github,
}
```

Add this exported function at the bottom of the file:

```js
export function makeAppOAuthService(from) {
  const cfg = PROVIDERS[from]
  return {
    isConnected: () => Boolean(readAuth(cfg.keySuffix)?.accessToken),
    async connect() {
      try {
        const returnUri = `nexusmd://oauth/${cfg.from}`
        const res = await fetch(`${API_BASE}${cfg.api}/native-url?returnUri=${encodeURIComponent(returnUri)}`)
        if (!res.ok) return
        const { url } = await res.json()
        openBrowser(url)
      } catch {}
    },
    async disconnect() {
      await clearAuth(cfg.keySuffix)
      window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
    },
    async loadCreds() {
      try {
        const k = resolveKey(from + '.oauthCreds')
        if (!k) return {}
        const raw = await secureStorageAdapter.get(k)
        return raw ? JSON.parse(raw) : {}
      } catch { return {} }
    },
    async saveCreds(c) {
      try {
        const k = resolveKey(from + '.oauthCreds')
        if (k) await secureStorageAdapter.set(k, JSON.stringify(c))
      } catch {}
    },
  }
}
```

Note: `loadCreds` is async here because `secureStorageAdapter.get` is async. `OAuthServiceCard` calls `loadCreds()` in a `React.useState` initializer — since the initializer runs synchronously, the async result won't be available on first render. To handle this, the app settings component must await `loadCreds()` and pass the result as a pre-loaded `initialCreds` override. See Step 3.

- [ ] **Step 2: Import `IntegrationsView` in the app settings file**

In `apps/app/src/views/view-settings.jsx`, find the `@nexusmd/ui` import:

```js
import {
  PlToggle, VsRow, VsCard, VsFullRow, ThemeChipPicker, VsSeg, VsPasswordModal, VsProfiles, BackupRestoreCard, CloudSyncCard,
} from '@nexusmd/ui';
```

Replace with:

```js
import {
  PlToggle, VsRow, VsCard, VsFullRow, ThemeChipPicker, VsSeg, VsPasswordModal, VsProfiles, BackupRestoreCard, CloudSyncCard,
  IntegrationsView,
} from '@nexusmd/ui';
```

Find the cloud-auth import at the top of the app settings file. If not present, add:

```js
import { makeAppOAuthService } from '../cloud-auth.js';
```

- [ ] **Step 3: Build service descriptors and add the nav item in the app settings file**

In `apps/app/src/views/view-settings.jsx`, find the `NAV` array:

```js
  const NAV = [
    { id: 'profile', label: 'Profile', icon: 'team' },
    { id: 'appearance', label: 'Appearance', icon: 'sun' },
    { id: 'planner', label: 'Planner', icon: 'planner' },
    { id: 'profiles', label: 'Profiles', icon: 'more' },
    { id: 'privacy', label: 'Confidential', icon: 'lock' },
    { id: 'data', label: 'Data & sync', icon: 'inbox' },
  ];
```

Replace with:

```js
  const NAV = [
    { id: 'profile',      label: 'Profile',      icon: 'team' },
    { id: 'appearance',   label: 'Appearance',   icon: 'sun' },
    { id: 'planner',      label: 'Planner',      icon: 'planner' },
    { id: 'profiles',     label: 'Profiles',     icon: 'more' },
    { id: 'privacy',      label: 'Confidential', icon: 'lock' },
    { id: 'data',         label: 'Data & sync',  icon: 'inbox' },
    { id: 'integrations', label: 'Integrations', icon: 'lock' },
  ];
```

Add these state hooks near the top of `SettingsView`, after the existing state hooks:

```js
  const [appOAuthServices] = useStateVS(() => [
    {
      id: 'ado',
      label: 'Azure DevOps',
      icon: 'inbox',
      desc: 'OAuth 2.0 — work items, PRs, pipelines',
      ...makeAppOAuthService('ado'),
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From your Azure DevOps OAuth application' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
    {
      id: 'microsoft',
      label: 'Microsoft / Entra ID',
      icon: 'mail',
      desc: 'Sign in with Microsoft — OneDrive, Teams, Calendar',
      ...makeAppOAuthService('microsoft'),
      credFields: [
        { key: 'clientId', label: 'Client ID (Application ID)', hint: 'From Azure portal → App registrations' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
    {
      id: 'github',
      label: 'GitHub',
      icon: 'pr',
      desc: 'GitHub OAuth App — pull requests and repo access',
      ...makeAppOAuthService('github'),
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From GitHub → Settings → Developer settings → OAuth Apps' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
  ]);
```

- [ ] **Step 4: Add the `integrations` render block in the app settings JSX**

In `apps/app/src/views/view-settings.jsx`, find the last `{subPage === 'data' && ...}` block inside the `<div style={{ minWidth: 0 }}>` section. After it, add:

```jsx
          {subPage === 'integrations' && (
            <IntegrationsView services={appOAuthServices} />
          )}
```

- [ ] **Step 5: Run the app and verify manually**

```bash
cd apps/app && npm run dev
```

Navigate to Settings → Integrations. Confirm all three service cards appear and the credentials form works.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/cloud-auth.js apps/app/src/views/view-settings.jsx
git commit -m "feat(app): add Integrations settings tab with OAuth service cards"
```

---

## Self-Review

**Spec coverage:**
- ✅ New "Integrations" nav tab on all three platforms
- ✅ `OAuthServiceCard` with admin credentials section (Client ID/Secret) and user connect/disconnect
- ✅ ADO OAuth, Microsoft/Entra ID, GitHub OAuth App services
- ✅ Credentials stored in localStorage (desktop/web) / secureStorage (app)
- ✅ Connection status refreshes on `focus` + `nexusmd:cloud-auth-changed`
- ✅ Missing-credentials guard before connect
- ✅ GitHub sub-settings (repo list) in `children` slot
- ✅ Google card preserved on web
- ✅ Web's `handleCloudOAuthCallback` extended via `PROVIDERS` map (no code change needed — adding to the map is sufficient)
- ✅ Desktop and app `redeem`/`BY_FROM` extended for new services

**Placeholder scan:** No TBD or TODO present.

**Type consistency:**
- `service.loadCreds()` — sync on web/desktop, async on app. `OAuthServiceCard` calls it in `React.useState(() => loadCreds())` which expects a sync value. The app's async `loadCreds` will return a Promise object on first render, not the creds. This is a real issue — see fix note below.

**Fix:** In `OAuthServiceCard`, change the creds initializer from `React.useState(() => loadCreds())` to `React.useState({})` and add a `useEffect` to load creds async:

```js
  const [creds, setCreds] = React.useState({});

  React.useEffect(() => {
    Promise.resolve(loadCreds()).then(c => setCreds(c || {}));
  }, []);
```

This handles both sync (web/desktop) and async (app) `loadCreds` correctly. Apply this fix in Step 3 of Task 1 when implementing `OAuthServiceCard`.
