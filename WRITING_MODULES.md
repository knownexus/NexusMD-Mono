# Writing new modules

How to add a new feature module to NexusMD, with desktop (`apps/desktop`,
Electron) as the priority target. This document is self-contained: it
includes the actual API surfaces you'll call (module registry, core, adapter
contracts), not just pointers to go read them. Web and Capacitor app support
are noted where they differ, but nothing here requires wiring them up in the
same change.

> **Desktop apps are installable units now.** A page of the desktop app (Git Workspace, Editor,
> Planner...) is an *app* in `modules/<id>`, not a view wired into `apps/desktop`. This guide covers the
> core/adapter layers underneath; for adding an app, read [Adding an app](#adding-an-app) first.

## Adding an app

An app is one folder, `modules/<id>/`, a workspace package named `@nexusmd/app-<id>`:

```
modules/<id>/
  app.manifest.json         id, label, productName, order, nav[{id,label,icon}], entries, ipc.preload, mainFiles?
  assets/icon.png, icon.ico its shortcut/window/tray icon when it is the only app (scripts/create-app-icons.cjs)
  src/renderer/index.js     default export { id, views, settingsCard?, provider?, topbar?, popout?, activate(host), ... }
  src/main/index.cjs        register(ctx) -> { dispose }   (optional)
```

- The preload builds `window.electronAPI.<namespace>` from the manifest's `ipc.preload`; a test per
  app checks every listed channel has a handler.
- Apps never import each other (`apps/desktop/src/module-boundaries.test.js`). They talk through
  capabilities on the host: `host.capabilities.has('editor.openPath')`, and hide the feature when
  the other app is not installed.
- Import shared code only from `@nexusmd/{core,ui,shell-sdk,web-adapters,editor-kit,main-kit}`.
- Screens that only your app uses may live in `packages/ui` (web and mobile import them from there);
  the split build (`apps/desktop/build/ui-split.mjs`) works out which app owns which file and builds
  it into that app's folder. A file two apps use stays in the shared UI.
- Strings only your app contains let `apps/desktop/e2e/split.spec.js` prove it is absent from an
  install without it: add one to `MARKERS`.
- Nothing else lists the app: the sidebar, Settings, the split build and the Windows installer's
  checklist (`installer/gen-apps-nsh.mjs`) all read the manifests.

How it ships: `npm -w apps/desktop run build:split` builds the shell and one folder per app; the
Windows installer (`apps/desktop/installer/README.md`) copies only the ticked ones. Mac, Linux and
dev runs still load every app from the one bundle. `NEXUSMD_APPS=git,editor npm start` runs a subset.

## 0. Repo layout and setup

This is an npm-workspaces monorepo (`node >= 20`):

```
package.json            workspaces: ["packages/*", "apps/*"]
packages/
  core/          @nexusmd/core         headless domain logic + adapter contracts (no React/DOM)
  ui/            @nexusmd/ui           shared React components, CSS tokens, shared views
  web-adapters/  @nexusmd/web-adapters  browser adapters shared by web/desktop/app
apps/
  desktop/       @nexusmd/desktop       Electron shell + Vite renderer      ← priority
  app/                                  Capacitor / Android
  web/                                  browser frontend + ASP.NET host
```

Each package/app is its own npm workspace with its own `package.json`,
`vitest.config.js`, and `test` script. Relevant scripts:

- Root `package.json`: `npm install` (installs and links every workspace),
  `npm test` (runs `vitest run` across all workspaces), `npm run build`
  (runs each workspace's `build` script if it has one).
- `packages/core/package.json`: `"type": "module"`, ESM only, no build step
  (`exports: "./src/index.js"` — consumed directly as source).
- `apps/desktop/package.json`: `npm run dev` (Vite dev server),
  `npm run start` (`electron .`), `npm test` (`vitest run`),
  `npm run build:renderer` (`vite build` → `../../dist/desktop/renderer`),
  `npm run e2e` (`vite build && playwright test`).

Package names used in imports: `@nexusmd/core`, `@nexusmd/ui`,
`@nexusmd/web-adapters`. Workspace `*` version ranges mean you don't need to
bump versions to consume a sibling package's changes locally.

Module type note: `packages/core`, `packages/ui`, `packages/web-adapters`,
and `apps/desktop`'s renderer code (`src/`) are all `"type": "module"` (ESM,
`import`/`export`, `.js`). Electron main-process files
(`apps/desktop/electron/**/*.cjs`) are CommonJS (`require`/`module.exports`,
`.cjs` extension) — Electron's main process in this app is not configured
for ESM, so **new files under `electron/` must be `.cjs`**, not `.js`.

Code style used throughout the codebase (follow it — enforced by review, not
a linter rule): no semicolons in `.js`/`.jsx` ESM files, semicolons *are*
used in `.cjs` Electron files (matches the existing files in that
directory); minimal comments — only explain the *why*, never restate what
the code obviously does; JSDoc-style comments on exported functions whose
parameters aren't self-evident from naming.

## 1. The four layers of a feature

1. **Core module** (`packages/core/src/modules/<name>/`) — pure logic, no
   DOM, no React. Registers itself with the module registry so `core` knows
   it exists, whether it's enabled, and what platform adapters it needs.
2. **Adapters** — the interfaces a module depends on (file, http, storage,
   scriptRunner, tray, …) are defined once, as contracts, in
   `packages/core/src/adapters/index.js`. Each app (desktop/web/app) supplies
   its own concrete implementation and wires it into `core` at startup.
   `packages/core` never imports from any app — this is a hard boundary.
3. **UI view** (`packages/ui/src/views/` or an app-local `src/views/`) — the
   React surface. Shared views live in `packages/ui` and are consumed by
   multiple apps; desktop-only views live directly in `apps/desktop/src`.
4. **App wiring** — `apps/desktop/src/main.jsx` assembles the adapters
   object, calls `initCore(adapters)`, and switches on the active nav item to
   render the right view. `apps/desktop/src/nav-config.js` lists sidebar
   entries.

Desktop-only capability (e.g. a scripted API client) is expressed by giving
a module a `requiredAdapters` entry that only the desktop adapters object
provides — see [§3 Gating a module to desktop](#3-gating-a-module-to-desktop).
There's no separate "desktop module" concept; gating is just adapter
presence, checked at runtime, not a build-time flag.

A worked example (`widget`) runs through every section below so the pieces
compose into one real, copy-pasteable feature.

## 2. Core module anatomy

### 2.1 The module registry API

`packages/core/src/features/module-registry.js` exports:

```js
registerModule(module)
// Push a module descriptor (see shape below) into the in-memory registry.
// Call this once, at import time, from the module's index.js.

getRegistry()
// Returns the array of every registered module descriptor.

clearRegistry()
// Empties the registry. Used by tests and by initCore-adjacent test setup
// to get a clean slate between test files/runs.

applyEnabledModules(profile)
// Sets each registered module's `_enabled` boolean from `profile.modules`.
// A module with no entry in `profile.modules` falls back to its own
// `defaultEnabled`. Passing a null/undefined profile applies
// `defaultEnabled` to every module (this is what happens on first run,
// before any profile exists).

hasRequiredAdapters(module, adapters)
// True if every adapter key in `module.requiredAdapters` is a non-null key
// on the `adapters` object. Empty `requiredAdapters` always passes.
```

A module descriptor passed to `registerModule` has this shape:

```ts
{
  id:               string,   // unique key — used in profile.modules, core.isEnabled(), etc.
  name:             string,   // human-readable label
  requiredAdapters: string[], // adapter keys this module can't function without, e.g. ['file']
  defaultEnabled:   boolean,  // enabled state when a profile has no explicit entry for `id`

  init(adapters, config) {},        // called once per initCore(), only if enabled + adapters present
  async load(adapters) { return {} }, // called on each core.load() cycle; return value becomes `data`
  dispose() {},                      // teardown hook (not currently auto-invoked by core, but modules
                                      // define it for symmetry/tests — null out module-level state here)
}
```

### 2.2 The `core` runtime API

`packages/core/src/core.js` exports `core` (a singleton object) and
`initCore(adapters)`:

```js
await initCore(adapters)
// 1. Stores `adapters` as the active adapters object (core.adapters getter).
// 2. Resolves the active profile via adapters.file + adapters.storage
//    (returns null if either adapter is missing, or no profile exists yet).
// 3. applyEnabledModules(profile) — sets _enabled on every registered module.
// 4. For every module that is enabled AND has its required adapters present,
//    calls module.init(adapters, profile?.modules?.[module.id]) — a per-module
//    init failure is caught and logged, not fatal to the rest of startup.
// 5. Emits 'profile:activated' (with the resolved profile) or 'profiles:none'.

core.adapters          // getter — the adapters object passed to the last initCore() call
core.isEnabled(id)      // true if a registered module with this id has _enabled === true
core.getEnabledModules() // string[] of enabled module ids
await core.load()
// For every enabled module with its required adapters present:
//   - if the module requires the 'network' adapter and adapters.network.isOnline() is
//     false, skip it (emits 'network:offline' once per call, not fatal)
//   - otherwise call module.load(adapters), emit 'data:updated' with { moduleId, data }
//   - on a thrown error, emit 'data:error' with { moduleId, error } and continue to the next module
// Returns the array of { moduleId, data } for modules that loaded successfully.

core.on(event, cb)   // subscribe to the event bus (see below)
core.off(event, cb)  // unsubscribe
```

The event bus (`packages/core/src/events.js`, re-exported through `core`) is
a plain `Map`-backed pub/sub — `emit(event, payload)` calls every subscriber
for `event`, catching and logging (not rethrowing) any handler that throws.
Events emitted by core itself: `'profile:activated'`, `'profiles:none'`,
`'data:updated'`, `'data:error'`, `'network:offline'`. Modules and the host
app can also emit/listen for their own custom events on the same bus.

### 2.3 Module enablement via profiles

Whether a module is enabled per-user comes from the active **profile**'s
`modules` map (`packages/core/src/profiles/profile-schema.js`):

```js
// A profile's modules field, e.g.:
{
  ado:      { enabled: false, org: '', projects: [], testProject: '', uatBranch: '', refreshSecs: 30 },
  planner:  { enabled: true },
  triage:   { enabled: true },
  team:     { enabled: true },
  calendar: { enabled: true },
  digest:   { enabled: false },
  audit:    { enabled: true },
}
```

`buildProfile(opts)` merges `opts.modules` over a `defaultModules()` baseline
when creating a new profile. If your module should be user-toggleable from
the Settings UI with its own config fields (not just on/off), add an entry
to `defaultModules()` in `profile-schema.js` and a matching form section in
the settings view. If it's a simple always-on internal module, you can skip
this — `defaultEnabled: true` on the module descriptor is sufficient and it
will run for every profile that doesn't explicitly disable it.

### 2.4 Writing the module

Every module lives at `packages/core/src/modules/<name>/index.js` (split
into more files in the same directory if it grows — see
`packages/core/src/modules/api-client/` for an example with 7 co-located
files) and ends with a call to `registerModule`.

Full example — a `widget` module:

```js
// packages/core/src/modules/widget/index.js
import { registerModule } from '../../features/module-registry.js'

/** Pure state transition — take state in, return new state out. */
export function doWidgetThing(state) {
  return { ...state, count: (state.count || 0) + 1 }
}

registerModule({
  id:               'widget',
  name:             'Widget',
  requiredAdapters: [],       // no adapters required → runs on every platform
  defaultEnabled:   true,

  init(_adapters, _config) {},
  async load(_adapters) { return {} },
  dispose() {},
})
```

```js
// packages/core/src/modules/widget/widget.test.js
import { describe, it, expect } from 'vitest'
import { doWidgetThing } from './index.js'

describe('widget', () => {
  it('increments count', () => {
    expect(doWidgetThing({ count: 1 })).toEqual({ count: 2 })
    expect(doWidgetThing({})).toEqual({ count: 1 })
  })
})
```

Then re-export the module's public functions from the package entry point so
apps can import them:

```js
// packages/core/src/index.js — add a line near the other module exports
export { doWidgetThing } from './modules/widget/index.js'
```

`packages/core/src/index.js` is a single flat file that re-exports
`core`/`initCore`, `registerModule`, every adapter interface, `createNoOpAdapters`,
the profile-store/profile-schema functions, and every module's public API.
Because ESM `export`s at the top of a file run their imports first, adding
your module's export line here is what actually causes `registerModule(...)`
to execute — nothing calls modules' `index.js` files except being imported,
directly or transitively, from this file.

Design notes drawn from existing modules (`timer`, `calendar`, `api-client`):

- Keep exported functions **pure** wherever possible (state in, state out).
  This is what makes a module trivially unit-testable without adapters or a
  DOM — see `packages/core/src/modules/timer/timer.test.js`, which tests an
  entire stopwatch/countdown state machine this way.
- If a module is action-oriented rather than part of the polling cycle (UI
  calls its functions on demand instead of `core` calling `load()`
  periodically), `init` can stash adapters in module-level variables and
  export a getter — see `getApiClientAdapters()` in
  `packages/core/src/modules/api-client/index.js` — and `load` can be a
  no-op whose only purpose is to make the module participate in
  adapter-gating (see `core.load()`'s behavior in §2.2).
- `dispose()` should null out anything `init()` set, so tests (which call
  `clearRegistry()` between runs) don't leak module-level state across test
  files.

## 3. Gating a module to desktop

Adapter presence — not a platform flag — is what makes a module effectively
desktop-only. `hasRequiredAdapters()` (§2.1) checks that every key in
`requiredAdapters` exists (is non-null) on the adapters object `core` was
initialized with:

```js
registerModule({
  id: 'widget',
  requiredAdapters: ['file', 'scriptRunner'], // scriptRunner: desktop-only
  ...
})
```

`packages/core/src/adapters/defaults.js`'s `createNoOpAdapters()` (full
listing in §4.2) deliberately **omits** desktop-only adapters like
`scriptRunner`/`apiHttp`. Every app spreads `createNoOpAdapters()` as the
base of its adapters object, and only desktop adds real implementations for
those two keys on top. That *absence* (not a rejecting no-op function) is
what keeps such a module from ever registering as enabled on web/app — if
`createNoOpAdapters()` included a rejecting no-op for `scriptRunner`, the key
would be *present* everywhere and the gate would never trigger. This is a
real example already in the codebase: `packages/core/src/modules/api-client/index.js`
requires `['file', 'scriptRunner']` specifically so the API-client module
only ever runs on desktop.

## 4. Adapters

### 4.1 What an adapter is

An adapter is a plain JS object implementing one platform capability (file
I/O, HTTP, secure storage, tray icon, …). `packages/core` only ever sees the
*shape* of an adapter (defined once as an interface constant) — it never
imports a concrete implementation. Each app builds its own `adapters` object
(a plain `{ file: ..., http: ..., storage: ..., ... }` map) and passes it to
`initCore(adapters)`. `core.load()` and every module's `init`/`load` receive
this same object.

### 4.2 Full adapter contract catalog

Everything below is exported from `packages/core/src/adapters/index.js`.
These are **documentation-contract objects** — every method rejects, throws,
or no-ops by default; they exist so you can see the exact shape an
implementation must match, not to be used for behavior directly.

```js
IFileAdapter = {
  read:              async (path) => {...},         // → string contents
  write:             async (path, text) => {...},
  exists:             async (path) => {...},         // → boolean
  list:              async (dirPath) => {...},       // → string[] entries
  delete:            async (path) => {...},
  mkdir:             async (dirPath) => {...},
  defaultProfileDir: async () => {...},               // → string path
}

IHttpAdapter = {
  fetch: async (url, options) => {...},               // scoped/authenticated HTTP (e.g. ADO)
}

IStorageAdapter = {
  get:    (key) => {...},        // sync key/value get
  set:    (key, value) => {...},
  remove: (key) => {...},
  keys:   () => {...},           // → string[]
}

INotificationAdapter = {
  // opts: { icon?: string, tag?: string, onClick?: () => void }
  send: (title, body, opts) => {},
}

IPickerAdapter = {
  pickFile:      async (filter) => {...},   // → path|null
  pickDirectory: async () => {...},         // → path|null
  saveFile:      async (name, text) => {},
}

IAuthAdapter = {
  isAvailable:     async () => false,
  promptBiometric: async (reason) => false,
}

IClipboardAdapter = {
  read:        async () => '',
  write:       async (text) => {},
  isAvailable: () => false,
}

ISecureStorageAdapter = {
  get:    async (key) => null,
  set:    async (key, value) => {},
  remove: async (key) => {},
}

INetworkAdapter = {
  isOnline: () => true,
  onChange: (callback) => () => {},   // returns an unsubscribe function
}

ILifecycleAdapter = {
  onForeground: (cb) => () => {},
  onBackground: (cb) => () => {},
}

IShareAdapter = {
  share:       async (title, text, url) => {},
  isAvailable: () => false,
}

// TrayMenuItem: { label: string, type?: 'normal'|'separator', enabled?: boolean, click?: () => void }
ITrayAdapter = {
  show:           () => {},
  hide:           () => {},
  setTooltip:     (text) => {},
  setContextMenu: (items) => {},
  onActivate:     (cb) => () => {},
  isAvailable:    () => false,
}

INavigationAdapter = {
  onBackButton:         (cb) => () => {},
  canGoBack:            () => false,
  goBack:               () => {},
  setBackButtonHandler: (cb) => () => {},
}

IThemeAdapter = {
  getColorScheme: () => 'light',    // 'light' | 'dark'
  onChange:       (cb) => () => {},
}

IUpdateAdapter = {
  checkForUpdate:    async () => ({ available: false }),
  installUpdate:     async () => {},
  onUpdateAvailable: (cb) => () => {},
}

IBadgeAdapter = {
  set:         (count) => {},
  clear:       () => {},
  isAvailable: () => false,
}

IDeepLinkAdapter = {
  onLink:      (cb) => () => {},
  isAvailable: () => false,
}

// Runs a JS snippet (pre-request/post-response scripts, test assertions).
// context: plain data the script can read/mutate (e.g. { vars, request }).
// Returns { context, logs, error } — `context` reflects mutations,
// `error` is set (and `context` null) if the script threw.
// SECURITY: this is for scripts the *user themselves* authored (same trust
// model as Postman/Bruno's own request scripts), NOT a sandbox boundary
// against untrusted/third-party code.
IScriptRunnerAdapter = {
  run: async (script, context) => {...},
}

// A plain, unscoped HTTP client for the api-client module — unlike
// IHttpAdapter (which apps may hard-scope to one backend, e.g. ADO, with
// forced auth), this must send exactly the request it's given, to any host.
IRawHttpAdapter = {
  fetch: async (url, options) => {...},
}
```

`createNoOpAdapters()` (`packages/core/src/adapters/defaults.js`) returns
fresh shallow copies of every interface **except** `IScriptRunnerAdapter` and
`IRawHttpAdapter`:

```js
export function createNoOpAdapters() {
  return {
    file: {...IFileAdapter}, http: {...IHttpAdapter}, storage: {...IStorageAdapter},
    notification: {...INotificationAdapter}, picker: {...IPickerAdapter},
    auth: {...IAuthAdapter}, clipboard: {...IClipboardAdapter},
    secureStorage: {...ISecureStorageAdapter}, network: {...INetworkAdapter},
    lifecycle: {...ILifecycleAdapter}, share: {...IShareAdapter},
    tray: {...ITrayAdapter}, navigation: {...INavigationAdapter},
    theme: {...IThemeAdapter}, update: {...IUpdateAdapter},
    badge: {...IBadgeAdapter}, deepLink: {...IDeepLinkAdapter},
    // scriptRunner / apiHttp deliberately absent — see §3.
  }
}
```

Every app builds its real adapters object as `{ ...createNoOpAdapters(), file: realFileAdapter, ... }`,
overriding only the keys it has a real implementation for.

### 4.3 Adding a brand-new adapter contract

Only do this if your module needs a genuinely new platform capability with
no existing match above:

1. Add the interface shape to `packages/core/src/adapters/index.js`,
   following the pattern above (every method rejects/throws/no-ops).
2. Export it from `packages/core/src/index.js` alongside the other
   `I*Adapter` exports.
3. Decide whether it belongs in `createNoOpAdapters()`:
   - **Yes** — every platform can "have" this adapter, even if inert on
     some (e.g. `tray.isAvailable()` just returns `false` on platforms with
     no tray). This is the common case.
   - **No** — the capability should only exist at all on one platform, and
     you want `requiredAdapters` gating (§3) to work. Only desktop's
     `apps/desktop/src/main.jsx` should add a real implementation for that
     key; leave it out of `createNoOpAdapters()` entirely.
4. Implement it for desktop (§4.4). Implement it for web/app only if/when
   that platform actually needs the module — nothing forces you to.

### 4.4 Desktop adapter wiring, end to end

Desktop adapters that need native OS access go through Electron IPC. The
full chain, using `widget` as a running example:

```
apps/desktop/electron/ipc/widget.cjs      Node-side ipcMain.handle(channel, ...) — real work
        ↓ registered in apps/desktop/electron/main.cjs's app.whenReady() block
apps/desktop/electron/preload.cjs         contextBridge: window.electronAPI.widget.<method>
        ↓
apps/desktop/src/adapters/widget.js       Renderer-side adapter object matching the
                                           core IWidgetAdapter shape, calling window.electronAPI
        ↓
apps/desktop/src/main.jsx                 spread into the `adapters` object passed to initCore()
```

**Step 1 — IPC handler** (`.cjs`, CommonJS — see §0):

```js
// apps/desktop/electron/ipc/widget.cjs
'use strict';

function register(ipcMain) {
  ipcMain.handle('widget:doThing', (_e, arg) => {
    // real native work goes here
    return { ok: true, arg };
  });
}

module.exports = { register };
```

If the handler can throw and you want the failure logged before it's
rethrown to the renderer, use `withLogging(ipcMain)` from
`apps/desktop/electron/ipc/withLogging.cjs` instead of calling
`ipcMain.handle` directly:

```js
'use strict';
const { withLogging } = require('./withLogging.cjs');

function register(ipcMain) {
  const handle = withLogging(ipcMain);
  handle('widget:doThing', async (_e, arg) => { /* ... */ });
}

module.exports = { register };
```

This logs the error under `electron-log`'s `.scope('widget:doThing')` before
rethrowing, which is what makes failures visible in the desktop app's Logs
view (see `apps/desktop/electron/ipc/oauth.cjs` for a real example of this
pattern).

**Step 2 — register in `main.cjs`.** Near the top, alongside the other IPC
module requires:

```js
const widgetIpc = require('./ipc/widget.cjs');
```

Inside the `app.whenReady().then(async () => { ... })` block, alongside the
other `*Ipc.register(ipcMain)` calls (this block also creates the main
window, tray, and registers the updater — your new line is one more
statement in that same sequence):

```js
widgetIpc.register(ipcMain);
```

**Step 3 — expose it on `window.electronAPI`** in
`apps/desktop/electron/preload.cjs`, inside the object passed to
`contextBridge.exposeInMainWorld('electronAPI', { ... })`:

```js
widget: {
  doThing: (arg) => ipcRenderer.invoke('widget:doThing', arg),
},
```

**Step 4 — renderer-side adapter** matching the core adapter shape:

```js
// apps/desktop/src/adapters/widget.js
export const widgetAdapter = {
  doThing(arg)  { return window.electronAPI?.widget.doThing(arg) },
  isAvailable() { return !!(window.electronAPI?.widget) },
}
```

**Step 5 — wire it into the adapters object** in `apps/desktop/src/main.jsx`:

```js
import { widgetAdapter } from './adapters/widget.js'

const adapters = {
  ...createNoOpAdapters(),
  // ...all the other real adapters (storage, file, http, tray, etc.)...
  widget: widgetAdapter,
}

await initCore(adapters)
```

`main.jsx` builds exactly one `adapters` object like this at module load
time and calls `initCore(adapters)` once; this is the single seam where
every platform capability the desktop app supports gets registered.

## 5. UI view

- Shared across platforms → add the view to `packages/ui/src/views/` and
  export it from `packages/ui/src/index.js` (a flat re-export file, same
  pattern as `packages/core/src/index.js`).
- Desktop-only → add it directly under `apps/desktop/src/` (or
  `apps/desktop/src/views/`), following the pattern of an existing
  desktop-only view (a `.jsx` component with a colocated `.test.jsx`).

To surface a new view in the desktop sidebar:

1. Add an entry to `NAV` in `apps/desktop/src/nav-config.js`:
   ```js
   export const NAV = [
     ...,
     { id: 'widget', label: 'Widget', icon: 'work' },
   ]
   ```
   `nav-config.js` is deliberately pure/side-effect-free (no rendering,
   no sync start) so it can be imported by tests; `SETTINGS_NAV` is kept
   separate and pinned at the bottom of the sidebar rather than living in
   `NAV`/the reorderable list.
2. In `apps/desktop/src/main.jsx`, find the `switch (view) { case 'dashboard': ... }`
   block that renders the active view, and add a matching case:
   ```js
   case 'widget':
     return <WidgetView />
   ```
3. If the view needs an icon not already defined, add it to the icon set in
   `packages/ui/src/icons.jsx` (a single file exporting an `Icon` component
   keyed by name).

## 6. Tests

Test runner: **Vitest**, per-workspace config (`vitest.config.js`):
`packages/core` uses `environment: 'node'` (no DOM); `apps/desktop` uses
`environment: 'jsdom'` with `@vitejs/plugin-react` for JSX, and excludes
`e2e/**` (Playwright tests are a separate runner, see §7).

- **Core modules**: colocate `<name>.test.js` next to `index.js`
  (e.g. `packages/core/src/modules/timer/timer.test.js`). Test the pure
  functions directly by importing from `./index.js` — no adapters, no
  mocking, no DOM needed.
- **Desktop IPC handlers**: colocate `*.test.js` next to the `.cjs` file
  (e.g. `apps/desktop/electron/ipc/oauth.test.js`,
  `apps/desktop/electron/preload.test.js`). These modules take `ipcMain`
  (and, for `withLogging`, a `logger`) as a parameter rather than reaching
  for a global, specifically so tests can pass a fake and assert on
  `ipcMain.handle` calls without spinning up real Electron.
- **UI components/views**: colocate `*.test.jsx` using
  `@testing-library/react` (already a devDependency in `packages/ui` and
  `apps/desktop`) — follow the pattern of any existing `*.test.jsx` in
  `apps/desktop/src/` or `packages/ui/src/views/`.

Run tests:

```
npm run test:affected           # only what your working-tree changes can affect
npm run test:affected -- --base master   # ...or what changed since master
npm run test:git                # one feature: its core logic + its module (also devenv, database, api-client, work)
npm run test:git:full           # ...plus Git's real-repository integration tests
npm -w apps/desktop test        # this workspace only
npm test                        # every workspace, from the repo root (CI runs this)
```

While working on a module, run `test:affected` or `test:<feature>`. Run the
whole suite before merging. `scripts/test-scope.mjs` chooses tests by path
rather than by import graph: every consumer imports the `@nexusmd/core`
barrel (the desktop shell shares one copy of it with every app through an
import map, so don't switch modules to deep imports), so to Vitest a change
to any core module touches every test. A change to a shared package (core
outside `src/modules`, `ui`, `shell-sdk`, `editor-kit`, `main-kit`,
`web-adapters`) runs everything. When you add a feature, add it to
`FEATURES` in that script.

Git's `*.integration.test.js` files drive real repositories and take most
of the suite's time (each git command is a process start, which is slow on
Windows). They are their own Vitest project, `git-integration`. Build a
fixture repository once and `fs.cpSync` it per test rather than rebuilding
it, as `git.conflicts.integration.test.js` does.

### Every test stands alone

Files and projects run in parallel, so a test must pass or fail on its own
merits, whatever runs before it or alongside it. `npx vitest run
--sequence.shuffle.files --sequence.shuffle.tests` must pass as reliably as a
plain run.

- **Shared settings.** Each project's `vitest.config.js` spreads `isolation`
  from the root `vitest.shared.js` and loads `test-isolation.setup.js` first.
  After every test that unmounts what Testing Library rendered, clears
  `localStorage`/`sessionStorage`, puts fake timers back to real ones, and
  restores spies, stubbed globals and env vars. A new project's config does
  the same.
- **Set up per test.** Stub globals (`vi.stubGlobal`) and spies in
  `beforeEach` or the test itself, never at the top of the file: they are
  undone after each test. Never rely on what an earlier test stored or left
  mounted.
- **No sleeps.** Don't `await new Promise(r => setTimeout(r, n))` and hope the
  work is done:
  - waiting for queued promise work: `flushPromises()`
    (`new Promise(r => setImmediate(r))`, wrapped in `act` for React), which
    runs after every callback already queued;
  - code under test that uses timers (polling, debounce, grace periods):
    `vi.useFakeTimers({ toFake: [...] })` and `vi.advanceTimersByTimeAsync`;
  - real I/O (processes, files): wait for the result itself with `waitFor`
    or `vi.waitFor`.

  A timer is fine only when it is the point of the test, such as a fake
  "slow" request in a test that counts requests in flight.
- **Timeouts catch hangs, never slowness.** The shared test and hook timeout
  is 5 minutes and Testing Library's `waitFor` gives up after 30 seconds.
  Don't pass a smaller timeout to a test or a `describe`: under a full
  parallel run a test can take many times longer than on its own.

## 7. Verifying on desktop

From `apps/desktop/`:

- `npm test` — fast, reliable, full component/unit suite. Run after any
  change.
- `npx vite build` (or `npm run build:renderer`) — builds the renderer to
  `../../dist/desktop/renderer`. Required before launching the actual
  Electron shell: `electron/main.cjs` falls back to
  `process.resourcesPath/renderer` when there's no Vite dev server URL, so
  without this build the shell has nothing to load.
- `npm run start` (`electron .`) — launches the real Electron shell against
  whatever's currently built.
- `npm run e2e` (`vite build && playwright test`, the `e2e/*.spec.js` suite
  using Playwright's `_electron.launch`) drives the real Electron window
  end-to-end. **Known limitation**: this fails in headless/sandboxed shells
  with no interactive window station or GPU access — symptom is
  `electron.launch: Target page, context or browser has been closed`, and
  manually launching the Electron binary shows it reaching
  `app ready; creating main window`, logging a harmless GPU disk-cache
  "Access is denied" warning, then exiting cleanly (exit code 0) because
  `ready-to-show`/`win.show()` never succeeds, which trips
  `window-all-closed` → `app.quit()`. If you hit this, confirm it's the
  environment (not your change) by running the unmodified
  `e2e/smoke.spec.js` — if that also fails the same way, report the GUI
  surface as **blocked**, not passed, and fall back to:
  1. Trace the exact prop-drilling / state-wiring path by hand (component
     tree, IPC channel names end to end) to confirm the chain is complete,
     not just that each piece exists in isolation.
  2. Run the full Vitest suite to catch regressions in adjacent logic.
  3. Report the GUI-surface verdict as blocked, plainly, rather than
     claiming it passed from unit tests alone.

## Checklist for a new desktop-first module

- [ ] `packages/core/src/modules/<name>/index.js` with `registerModule(...)`
      and pure, unit-tested logic (§2).
- [ ] Module's public functions re-exported from `packages/core/src/index.js`
      (§2.4) — without this, `registerModule` never runs.
- [ ] If user-toggleable: an entry added to `defaultModules()` in
      `packages/core/src/profiles/profile-schema.js` (§2.3).
- [ ] New adapter contract added to `adapters/index.js` (§4.3) only if a
      genuinely new platform capability is needed; decide `createNoOpAdapters()`
      inclusion based on whether every platform should have the adapter
      (inert) or only desktop should have it at all (gating, §3).
- [ ] Desktop IPC handler (`electron/ipc/<name>.cjs`) registered in
      `electron/main.cjs`'s `app.whenReady()` block (§4.4 step 1–2).
- [ ] `contextBridge` entry in `electron/preload.cjs` (§4.4 step 3).
- [ ] Renderer adapter in `apps/desktop/src/adapters/<name>.js` (§4.4 step 4).
- [ ] Adapter spread into the `adapters` object in `apps/desktop/src/main.jsx`
      (§4.4 step 5).
- [ ] View added to `packages/ui/src/views/` (shared) or `apps/desktop/src/`
      (desktop-only), wired into `nav-config.js` + the view switch (§5).
- [ ] Tests colocated at every layer touched (§6).
- [ ] `npm test` and `npx vite build` pass in `apps/desktop/`; e2e run or
      explicitly reported as blocked (§7).
