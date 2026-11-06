# Recording and the call trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the person press Record, use anything in the desktop app, stop, and open a saved tree of what ran: their actions, every function with its arguments and return value, network requests, IPC calls and log lines, in order and timed.

**Architecture:** A build-time Babel transform adds a start/end report to every function in our own code (window code through Vite, main-process code through a load hook when running from source and a packaging step when packaged). The reports call a tiny runtime, `globalThis.__nxt`, which costs one flag check per call when off. Window events are shipped to the main process, which owns the single recording, redacts it, and writes it to a file; the viewer loads that file as a tree.

**Tech Stack:** Babel (`@babel/core`, already hoisted), Vite 8 plugin, Electron 43 main (CommonJS), React 18 viewer, Vitest 4, Playwright for the end-to-end check.

**Spec:** `docs/superpowers/specs/2026-11-05-recording-and-call-trace-design.md`

## Global Constraints

- Tracing is always built in to the shipped desktop app; recording works on a normal installed copy.
- Android and the web app get no reporting code; a test fails if `__nxt` reaches their builds.
- Function arguments and return values are captured in a nested call tree, in order. Window and main process are both in scope.
- A traced function must return, throw and resolve exactly as before (`this`, `name`, `length`, async). A failure in tracing must never break the app.
- Cost when not recording: no measurable change in startup time, and none in a scripted interaction on the PR list.
- Secrets matching a rule (key names, value patterns, URL query strings, built-in sign-in/token list) are hidden; a value no rule recognises is shown. Request and response bodies are kept; there is no switch to hide them.
- Export writes the recording unaltered, for the person's own use; no warning, no stripping, no upload.
- Third-party code and React render/hook functions are not traced. Getters, setters and class constructors are not traced at first.
- One recording per app instance, owned by the main process. A recording has a size cap and says where it stopped. Each file carries a format version; an unreadable version is kept and flagged.
- Recordings live in `<userData>/logs/_recordings/` (a name `isModuleId` rejects, so the log reader never lists it as a module).

## Review Focus

- **Odd values as arguments** (circular objects, Proxies, a getter that throws, BigInt, Symbol, DOM nodes, typed arrays): recording must cut them to a marker and never throw. Pinned in Task 1.
- **App quits, or a window closes, mid-recording:** the file written so far must be kept and marked as unfinished. Pinned in Task 6.
- **Stopping while async work is still running:** events arriving after Stop are dropped, not appended to a closed recording. Pinned in Task 1.
- **Very large or binary response bodies:** cut to a marker with the size, not stored whole and not crashing the viewer. Pinned in Task 9.
- **A function named or called like a secret, and a token in a URL or raw string:** hidden by the value and deny rules, not only by key names. Pinned in Task 2.

---

## File Structure

- `packages/trace/` (new workspace `@nexusmd/trace`): `src/runtime.js` (the `__nxt` runtime, an IIFE with no import/export so it loads as a script, as a Vite module and with `require`), `src/instrument.mjs` (Babel transform), `src/vite-plugin.mjs`, `src/exclude.json` (functions and files to leave out), tests alongside.
- `packages/main-kit/src/trace/`: `redact-trace.cjs` (recording redaction), `recorder.cjs` (owns the recording), `store.cjs` (files: list, read, delete, export, import, retention).
- `packages/main-kit/src/logging/ipc.cjs` (modify): IPC calls become nodes and link to the window call that made them.
- `packages/main-kit/src/logging/redact.cjs` (modify): add the missing query-string and token patterns.
- `apps/desktop/electron/trace-hook.cjs` (new): load hook for running from source. `apps/desktop/electron/ipc/recordings.cjs` (new): IPC. `apps/desktop/electron/preload.cjs` (modify): `recording` API, the `trace:ctx` side channel.
- `apps/desktop/build/trace-main.mjs` (new): packaging transform for main-process files.
- `packages/core/src/trace/` (new, window side): `clicks.js`, `fetch-capture.js`, `shipper.js`.
- `apps/desktop/src/`: `recording-tree.jsx`, `recording-model.js` (new), `log-viewer.jsx` (modify: Record control and Recordings list), `adapters/recordings.js` (new).

---

### Task 1: The `__nxt` runtime and its event schema

**Files:**
- Create: `packages/trace/package.json` (name `@nexusmd/trace`, no `"type"`), `packages/trace/src/runtime.js`, `packages/trace/vitest.config.js`
- Modify: `vitest.config.js` (add `'packages/trace'` to `projects`)
- Test: `packages/trace/src/runtime.test.js`

**Interfaces:**
- Produces (the global the transform's output calls; also `module.exports` when `module` exists). Installing must `Object.assign` onto an existing `globalThis.__nxt` so a stub captured earlier stays valid:
  ```
  __nxt.on: boolean
  __nxt.start(opts?: { proc?: 'main'|'renderer', win?: number, maxEvents?: number, maxBytes?: number }): void
  __nxt.stop(): void                       // on=false; later events are dropped
  __nxt.drain(): TraceEvent[]              // returns and clears the buffer
  __nxt.enter(fn: string, thisArg: any, args: ArrayLike<any>): Frame | null   // null when not recording
  __nxt.ret<T>(frame: Frame | null, value: T): T
  __nxt.err(frame: Frame | null, error: unknown): void
  __nxt.aw<T>(frame: Frame | null, value: T): T       // wraps the awaited value: leaves the frame while it waits
  __nxt.resume<T>(frame: Frame | null, value: T): T   // wraps the awaited result: re-enters the frame
  __nxt.current(): string | null           // id of the running frame
  __nxt.run<T>(parentId: string | null, fn: () => T): T   // run fn with parentId as the current frame
  __nxt.emit(kind: 'log' | 'net' | 'click' | 'ipc', d: object, parent?: string | null): string
  __nxt.cut(value: unknown, limits?: { depth?: number, str?: number, items?: number }): unknown
  __nxt.onCap: ((reason: string) => void) | null
  ```
- Event shapes (all carry `t` epoch ms, `proc`, optional `win`):
  `{ k:'enter', id, p, fn, a }`, `{ k:'ret', id, v, ms }`, `{ k:'err', id, e:{name,message,stack}, ms }`, `{ k:kind, id, p, d }` for `emit`, `{ k:'cap', reason }`. `id` is `${proc[0]}${win ?? process.pid}-${n}`; `fn` is `"relative/path.js:line:col:name"`; `a` and `v` are `cut` values.
- Context: in Node the current frame is kept with `AsyncLocalStorage` (so concurrent calls nest correctly); with no `async_hooks` (a window) a global stack is used and `aw`/`resume` pop and push it.

- [ ] **Step 1: Write the failing tests** in `runtime.test.js` (load with `createRequire`; call `__nxt.start()`/`stop()` around each test):
  - `enter/ret nest: a frame entered inside another has p = the outer id`
  - `err records name, message and stack and rethrow is the caller's job (ret/err return nothing)`
  - `not recording: enter returns null, ret returns its value, no events`
  - `events after stop() are dropped` (call `enter` then `stop()` then `ret`; `drain()` has no `ret`)
  - `async: after aw(f, p) and resume(f, v) a child enters under f, not under the caller` (simulate with a promise)
  - `concurrent async calls nest under their own frames` (two interleaved awaits, Node ALS)
  - `cut: circular, Proxy, throwing getter, BigInt, Symbol, typed array, a 1 MB string, 10 000-item array each become a JSON-safe marker and never throw` (assert `JSON.stringify(cut(x))` works and a marker like `{"$cut":"circular"}` or a `"…(+N chars)"` suffix is present)
  - `cap: past maxEvents the buffer gets one {k:'cap'} event, onCap fires once, later enters return null`
  - `install keeps an existing stub valid` (set `globalThis.__nxt = {on:false}` first, load runtime, same object now has `enter`)
- [ ] **Step 2: Run** `npx vitest run --project trace` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `runtime.js` to the interface above. Never throw out of any method (wrap internals; on an internal failure set `on=false`). `cut` defaults: depth 4, string 2000 chars, 50 items/keys.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(trace): the __nxt runtime and event schema`.

---

### Task 2: Redaction for recordings

**Files:**
- Create: `packages/main-kit/src/trace/redact-trace.cjs`, `packages/main-kit/src/trace/deny.json`
- Modify: `packages/main-kit/src/logging/redact.cjs` (query-string and `access_token`/`refresh_token`/`id_token`/`client_secret` patterns; today `\btoken` misses `access_token=` because `_` is a word character)
- Test: `packages/main-kit/src/trace/redact-trace.test.js`, add cases to the existing redact test

**Interfaces:**
- Consumes: `redactString`, `redactValue` from `../logging/redact.cjs`.
- Produces: `redactEvent(event: TraceEvent, rules?: DenyRules): TraceEvent` (new object; input untouched) and `DEFAULT_DENY: { urls: RegExp[], functions: RegExp[], channels: RegExp[] }` loaded from `deny.json`. A denied event's `a`, `v`, `d` become `{ "$redacted": "<rule name>" }`.
- Layers, in order: deny rules (urls: sign-in/token exchange endpoints such as `/oauth`, `/token`, `login.microsoftonline.com`, `github.com/login`; functions: names matching `/sign-?in|token|secret|password|credential/i`; channels: `oauth:*`, secure-storage channels); then `redactValue` on every value; then URL strings: credentials in user-info and sensitive query parameters blanked; header objects: `authorization`, `cookie`, `set-cookie`, `x-api-key` blanked.

- [ ] **Step 1: Write the failing tests:**
  - `a bearer token in an argument string is hidden`
  - `a token in a URL query (?access_token=abc) and a URL with user:pass@ are hidden`
  - `request headers authorization and cookie are hidden; other headers are kept`
  - `a function named signInWithToken has its args and return replaced outright`
  - `a body from a /oauth/token url is replaced outright`
  - `a value no rule recognises is kept as is` (a PR title, a plain 20-char string)
  - `the input event is not mutated`
- [ ] **Step 2: Run** `npx vitest run --project main-kit redact-trace` — Expected: FAIL.
- [ ] **Step 3: Implement** `redactEvent` and extend `redact.cjs` (add a test there for `access_token=`).
- [ ] **Step 4: Run** — Expected: PASS, including the existing `redact` suite.
- [ ] **Step 5: Commit** `feat(trace): redact recordings`.

---

### Task 3: The instrumenting transform

**Files:**
- Create: `packages/trace/src/instrument.mjs`, `packages/trace/src/exclude.json`
- Test: `packages/trace/src/instrument.test.js`

**Interfaces:**
- Produces: `instrument(code: string, opts: { filename: string, root?: string, exclude?: { files?: string[], functions?: string[] } }): { code: string, map: object } | null` (null: nothing to change, or file excluded). `filename` shown in `fn` ids is relative to `root`.
- Output shape for each traced function (names pinned so tests and later tasks agree):
  ```js
  // once per file, first statement:
  var __nxt = globalThis.__nxt || (globalThis.__nxt = { on: false, enter() { return null }, ret(f, v) { return v }, err() {}, aw() {}, resume() {} });
  // per function:
  const __f = __nxt.on ? __nxt.enter("rel/path.js:L:C:name", this, arguments) : null;
  try { …body, every `return e` → `return __nxt.ret(__f, e)`, every `await e` → `__nxt.resume(__f, await __nxt.aw(__f, e))` … }
  catch (e) { __nxt.err(__f, e); throw e }
  ```
  (`aw` and `resume` take and return the value, as Task 1 defines them; arrows use their own parameter list in place of `arguments`; a `yield` is wrapped the same way as an `await`.)
- Skipped by default: `node_modules`; files matching `*.test.*`; functions containing JSX, functions named `/^use[A-Z]/`, getters/setters/constructors; arrow callbacks passed directly to `map filter reduce some every find findIndex flatMap forEach sort`; anything listed in `exclude.json`.

- [ ] **Step 1: Write the failing tests.** Behaviour identity is tested by evaluating transformed code against a real `__nxt` (Task 1) with recording on and off:
  - for each of: plain function, arrow with expression body, method, async function, generator, async generator: `same return value, same thrown error, same resolved value, with recording on and off`
  - `this and arguments are preserved in functions; name and length are unchanged`
  - `an async function's child call after an await nests under it` (events from the runtime)
  - `a function with JSX, a useThing hook, a getter, a constructor and a .map callback are left alone`
  - `a file with nothing to trace returns null`; `a syntax error returns null and does not throw`
  - `source map maps a traced function back to its original line`
  - `an exclude.json function name is left alone`
- [ ] **Step 2: Run** `npx vitest run --project trace instrument` — Expected: FAIL.
- [ ] **Step 3: Implement** with `@babel/core` `transformSync` and a visitor plugin; parse with the `jsx` parser plugin enabled for `.jsx`/`.js`. Default `exclude.json` starts empty (Task 12 fills it from profiling).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(trace): the instrumenting transform`.

---

### Task 4: Window code: Vite plugin, runtime install, and no leak into web/Android

**Files:**
- Create: `packages/trace/src/vite-plugin.mjs`
- Modify: `apps/desktop/vite.config.js`, `apps/desktop/vite.split.config.js`, `apps/desktop/build/build-split.mjs` (each app's renderer build), `apps/desktop/src/main.jsx` (first import: `import '@nexusmd/trace/runtime'`)
- Test: `packages/trace/src/vite-plugin.test.js`, `apps/desktop/build/trace-leak.test.js`

**Interfaces:**
- Consumes: `instrument` (Task 3).
- Produces: `traceCalls(opts?: { root?: string, exclude?: object }): import('vite').Plugin` — `enforce: 'pre'`, transforms only `.js .jsx .mjs .cjs` files whose real path is inside the repo and not in `node_modules`; `@nexusmd/trace` re-exports the runtime at `@nexusmd/trace/runtime`.

- [ ] **Step 1: Write the failing tests:**
  - `the plugin transforms a repo file and skips node_modules and the trace package itself`
  - `trace-leak: building apps/web and apps/app (or their config's plugin list) contains no traceCalls plugin` — assert by reading each config's plugins, and by grepping their built output for `__nxt` when a build exists
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the plugin and add it to the three desktop build paths only.
- [ ] **Step 4: Run** the tests, then `cd apps/desktop && npx vite build` — Expected: PASS and build succeeds; `grep -c "__nxt.enter" dist/desktop/renderer/assets/*.js` is greater than 0.
- [ ] **Step 5: Commit** `feat(trace): instrument window code in the desktop build`.

---

### Task 5: Main-process code: load hook and packaging

**Files:**
- Create: `apps/desktop/electron/trace-hook.cjs`, `apps/desktop/build/trace-main.mjs`
- Modify: `apps/desktop/electron/main.cjs` (first lines: install the runtime, then the hook when `!app.isPackaged`), `apps/desktop/package.json` (packaging uses the transformed tree), `apps/desktop/build/build-split.mjs` (per-app main bundle through a rolldown plugin that calls `instrument`)
- Test: `apps/desktop/electron/trace-hook.test.js`, `apps/desktop/build/trace-main.test.js`

**Interfaces:**
- Consumes: `instrument`, the runtime.
- Produces: `installTraceHook(opts: { roots: string[], exclude?: string[] }): () => void` (returns an uninstall). Files under `roots` (`apps/desktop/electron`, `packages/main-kit/src`, `modules/*/src/main`) are transformed on load; `packages/trace/**`, `packages/main-kit/src/logging/**` and `packages/main-kit/src/trace/**` are never traced (the logger and recorder must not trace themselves). `traceMainTree(srcDir: string, outDir: string, opts?: { root?: string }): Promise<{ files: number, traced: number }>` writes transformed copies for packaging.
- Packaging: electron-builder `files` takes the transformed copy of `electron/**` from `dist/desktop/main-traced` (a `FileSet` with `from`), and the workspace packages that ship in `node_modules` are transformed copies too. Start with a spike that proves a built, unpacked app contains `__nxt.enter` in a main file before wiring everything.

- [ ] **Step 1: Write the failing tests:**
  - `hook: requiring a fixture .cjs under a root runs it traced (events recorded) and under an excluded root runs it untouched`
  - `hook: uninstall restores plain loading`
  - `traceMainTree: writes a transformed copy, leaves the source tree unchanged, and skips the never-traced paths`
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** both; wire `main.cjs`; do the packaging spike, then the packaging wiring.
- [ ] **Step 4: Run** the tests, then a packaged build (`npm -w apps/desktop run build:win` or the unpacked `electron-builder --dir`) and grep its `app.asar` extract for `__nxt.enter` — Expected: present in `electron/main.cjs` and one module's main file.
- [ ] **Step 5: Commit** `feat(trace): instrument main-process code, from source and packaged`.

---

### Task 6: The recorder and the recording files

**Files:**
- Create: `packages/main-kit/src/trace/recorder.cjs`, `packages/main-kit/src/trace/store.cjs`
- Modify: `packages/main-kit/package.json` (`"./trace": "./src/trace/index.cjs"`), create `packages/main-kit/src/trace/index.cjs`
- Test: `packages/main-kit/src/trace/recorder.test.js`, `packages/main-kit/src/trace/store.test.js`

**Interfaces:**
- Consumes: `redactEvent` (Task 2), the runtime (Task 1) for the main process's own events.
- Produces:
  ```
  createRecorder({ dir: string, now?: () => number, maxBytes?: number, maxEvents?: number }): Recorder
  Recorder.start(label?: string): { id: string }          // throws if already recording
  Recorder.stop(): Promise<RecordingInfo>                 // flushes the file, marks it finished
  Recorder.status(): { recording: boolean, id?: string, startedAt?: number, events?: number, capped?: boolean }
  Recorder.add(events: TraceEvent[], source: { win?: number }): void   // windows push here; redacted before they are stored
  Recorder.onState(cb: (status) => void): () => void
  createStore({ dir }): { list(): RecordingInfo[], read(id: string): Promise<{ header: Header, events: TraceEvent[] }>, remove(id: string): Promise<void>, exportTo(id: string, file: string): Promise<void>, importFrom(file: string): Promise<RecordingInfo> }
  RecordingInfo = { id, label, startedAt, endedAt?, events, bytes, status: 'finished'|'unfinished'|'capped', version: 1 }
  ```
- File: `<dir>/<id>.nxrec`, JSON lines: the first line `{ "nxrec": 1, "id", "label", "startedAt", "app": <version> }`, then one event per line, a last line `{ "end": true, "status": … }` when finished. A file with a version this build cannot read is listed with `status: 'unreadable'` and never deleted or rewritten.

- [ ] **Step 1: Write the failing tests:**
  - `start then stop writes a header, the events in time order across two sources, and an end line`
  - `events from a window are redacted before they are written` (a bearer token in an arg)
  - `starting twice throws; stopping when idle throws`
  - `events after stop are dropped`
  - `past maxBytes the recording stops itself, writes a cap event and is listed as capped`
  - `a recording whose process died (no end line) is listed as unfinished and still reads`
  - `an unreadable version is listed and kept`
  - `export writes the bytes unchanged; import of that file lists the same recording; import of garbage fails with a clear error and writes nothing`
  - `retention: removing recordings older than the log retention days keeps newer ones`
- [ ] **Step 2: Run** `npx vitest run --project main-kit trace` — Expected: FAIL.
- [ ] **Step 3: Implement.** The recorder writes with the same buffered-append approach as `logging/writer.cjs`; on `Recorder.start` it starts the main runtime (`__nxt.start({ proc: 'main' })`) and on a timer drains it into `add`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(trace): the recorder and recording files`.

---

### Task 7: IPC, the preload bridge, and joining a window call to the main process

**Files:**
- Create: `apps/desktop/electron/ipc/recordings.cjs`
- Modify: `apps/desktop/electron/preload.cjs`, `apps/desktop/electron/main.cjs` (register), `packages/main-kit/src/logging/ipc.cjs` (`wrap`), `apps/desktop/src/adapters/recordings.js` (new)
- Test: `apps/desktop/electron/ipc/recordings.test.js`, add to `packages/main-kit/src/logging/ipc.test.js`

**Interfaces:**
- Produces (preload `window.electronAPI.recording`):
  ```
  start(label?: string): Promise<{ id: string }>      stop(): Promise<RecordingInfo>
  status(): Promise<Status>                           onState(cb: (Status) => void): () => void
  list(): Promise<RecordingInfo[]>                    read(id): Promise<{ header, events }>
  remove(id): Promise<void>
  exportTo(id): Promise<{ saved: boolean }>           importFile(): Promise<RecordingInfo | null>   // the main process shows the save/open dialogs
  ```
  and `ipcRenderer.send('trace:push', events)` (batches from a window) and `ipcRenderer.send('trace:ctx', { callId, channel })`. Main broadcasts `trace:state` (the Status plus that window's own `win` id) to every window on change; a window created mid-recording is sent the current state when it finishes loading.
- Joining: while the window recording flag is on, the preload sends `trace:ctx` immediately before each `ipcRenderer.invoke` and `send` (done once, by wrapping `ipcRenderer.invoke`/`send` at the top of `preload.cjs`, not per channel). IPC messages from one window arrive in order, so `createLoggedIpc.wrap` takes the pending `{callId, channel}` for `event.sender.id` and `channel`, emits an `ipc` event (`d: { channel, args, result|error, ms }`) as a child of `callId`, and runs the handler inside `__nxt.run(thatEventId, …)` so main-process frames nest under it. No pending context: the `ipc` node is its own root.

- [ ] **Step 1: Write the failing tests:**
  - `start/stop/status/list/remove go through the recorder; a second start returns a clear error`
  - `state changes are broadcast to every window, and a window opened mid-recording is told`
  - `window events pushed with trace:push are added with the sender's window id`
  - `ipc.wrap: with a pending trace:ctx the ipc node's parent is the window frame id, and a frame entered inside the handler is its child`
  - `ipc.wrap: with none, the ipc node is a root; a handler that throws still rethrows and its error is on the node`
  - `ipc.wrap: not recording, no event and no extra work` (assert `__nxt.on` false path emits nothing)
  - `export and import use the dialogs the test injects; a cancelled dialog resolves { saved: false } / null`
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new tests and the existing `ipc.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(trace): recording IPC and window-to-main joining`.

---

### Task 8: Verbose capture while recording, and log lines in the tree

**Files:**
- Modify: `packages/main-kit/src/logging/hub.cjs` (accept a `trace` hook), `packages/core/src/log.js` (verbose gate), `apps/desktop/electron/main.cjs`
- Test: `packages/main-kit/src/logging/logging.test.js` (add), `packages/core/src/log.test.js` (add)

**Interfaces:**
- Produces: `hub.setVerbose(on: boolean): void` — while on, `write` accepts every level (debug included) regardless of `minRank`, without changing the configured level afterwards, and passes each entry to `hub.setTraceSink(fn: (entry, parentFrameId: string|null) => void)`; the sink emits a `log` event (`d: { lvl, mod, scope, msg, err, data }`) under `__nxt.current()`. In a window, `rendererLog` calls send `debug` entries and emit a `log` event when `__nxt.on`, and send nothing extra otherwise.

- [ ] **Step 1: Write the failing tests:**
  - `setVerbose(true) writes debug entries that the level would drop; setVerbose(false) restores the old level`
  - `a log line written inside a frame becomes a log event whose parent is that frame`
  - `window: rendererLog.debug sends nothing when not recording, and a log event when recording`
  - `verbose entries are still redacted`
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** and have the recorder (Task 6) call `setVerbose` on start/stop.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(trace): verbose capture and log lines while recording`.

---

### Task 9: Window actions and network requests

**Files:**
- Create: `packages/core/src/trace/clicks.js`, `packages/core/src/trace/fetch-capture.js`, `packages/core/src/trace/shipper.js`
- Modify: `apps/desktop/src/main.jsx` (install all three), `packages/core/src/index.js` (export), `packages/core/tests/public-api.test.js`
- Test: `packages/core/src/trace/*.test.js`

**Interfaces:**
- Produces:
  ```
  installClickCapture(doc?: Document, getPage?: () => string): () => void   // capture-phase click and submit/Enter listener
  installFetchCapture(w?: Window): () => void                                // wraps w.fetch while __nxt.on
  startShipper(opts: { send: (events: TraceEvent[]) => void, everyMs?: number }): () => void
  accessibleName(el: Element): string                                        // aria-label, labelledby, visible text, title, in that order; max 80 chars
  ```
  A click emits a `click` event (`d: { name, page, tag }`) and runs the handler's synchronous work inside `__nxt.run(thatEventId, …)` by being the first capture listener and setting the current frame until the event finishes dispatching; frames the handler enters nest under it. The fetch wrapper emits a `net` event (`d: { method, url, headers, body, status, responseHeaders, responseBody, ms, error? }`) under the current frame; bodies over 64 KB (or binary) become `{ "$cut": "body", bytes: N }`. The shipper drains `__nxt` in the window every `everyMs` (default 500) and on stop, and sends to `window.electronAPI.trace.push`.

- [ ] **Step 1: Write the failing tests (jsdom):**
  - `a click on a labelled button emits a click event named from its accessible name, with the page`
  - `a function called by the click handler is a child of the click node`
  - `two quick clicks make two separate roots`
  - `fetch: a recorded request has method, url, request headers and body, status, response body and duration; the response still reads normally for the caller`
  - `fetch: a failing request records the error and rethrows it`
  - `fetch: a 5 MB body and a binary body are cut to a marker with their size`
  - `fetch: not recording, the original fetch is called untouched`
  - `shipper: batches are sent every interval, a last batch on stop, and nothing when empty`
- [ ] **Step 2: Run** `npx vitest run --project core trace` — Expected: FAIL.
- [ ] **Step 3: Implement**; when the window receives `trace:state` with `recording: true` it calls `__nxt.start({ proc: 'renderer', win })` and starts the shipper; on `recording: false` it stops both after a last drain.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(trace): window clicks, fetch capture and shipping`.

---

### Task 10: The recording model and tree view

**Files:**
- Create: `apps/desktop/src/recording-model.js`, `apps/desktop/src/recording-tree.jsx`
- Test: `apps/desktop/src/recording-model.test.js`, `apps/desktop/src/RecordingTree.test.jsx`

**Interfaces:**
- Produces:
  ```
  buildTree(events: TraceEvent[]): { roots: Node[], byId: Map<string, Node>, unfinished: Node[], capped: boolean }
  Node = { id, parent: string|null, kind: 'click'|'call'|'ipc'|'net'|'log'|'action', title: string, start: number, ms?: number, args?, value?, error?, file?: string, line?: number, children: Node[], proc, win? }
  searchTree(tree, text: string): Set<string>       // ids of matching nodes and their ancestors
  firstError(tree): Node | null
  <RecordingTree recording={{ header, events }} />
  ```
  Roots are `click` nodes; calls with no known parent (a timer, a push from main) are `action` roots titled by the function. The view: expandable rows (lazily rendered for large recordings), `+12 ms` offsets from the recording start, a detail panel with arguments, return value or error with stack, request and response for `net`, and source `file:line` that can be copied; search box; "Errors only"; opens on the first error; a banner for unfinished or capped recordings stating where it stopped; a note that secrets matching a rule are hidden.

- [ ] **Step 1: Write the failing tests:**
  - `buildTree nests enter/ret by parent and attaches ret value and ms`
  - `an enter with no ret is listed as unfinished`
  - `ipc events whose parent is a window frame appear under that frame, across processes`
  - `buildTree handles 50 000 events in under a second` (timing with a generous bound)
  - `searchTree returns matches with their ancestors`
  - `the view: expanding a click shows its calls in order with offsets; selecting a call shows args and return value; a thrown error shows its stack; Errors only hides the rest; opens on the first error`
  - `the view: a capped recording shows where it stopped`
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, using the viewer's tokens and the `lv-` styles' look (Application Logs card), keyboard-navigable (arrow keys expand/collapse).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(trace): the recording tree view`.

---

### Task 11: Record control, recordings list, export and import in the viewer

**Files:**
- Modify: `apps/desktop/src/log-viewer.jsx`, `apps/desktop/src/logs-card.jsx`
- Create: `apps/desktop/src/recordings-panel.jsx`
- Test: `apps/desktop/src/LogViewer.test.jsx` (add), `apps/desktop/src/RecordingsPanel.test.jsx`

**Interfaces:**
- Consumes: `recordingsAdapter` (`apps/desktop/src/adapters/recordings.js`, wraps `window.electronAPI.recording`, resolving `undefined` outside Electron), `<RecordingTree>`.
- Produces: a **Record** button beside Go live that becomes a clearly running state (accent dot, elapsed time, event count) with **Stop**; stopping opens the recording in the tree. A Recordings list (newest first: label, time, size, status) with Open, Export, Delete (confirmed), and Import. The control stays visible when the person leaves the Logs card (the sidebar shows a small recording indicator in `sidebar-nav.jsx`) so a recording started here can be stopped from anywhere.

- [ ] **Step 1: Write the failing tests:**
  - `Record starts a recording and shows elapsed time and event count; Stop ends it and opens the tree`
  - `a second Record click while recording does nothing; an error from start is shown in words`
  - `the list shows finished, unfinished and capped recordings; an unreadable one says so and has no Open`
  - `Delete asks first; Export and Import call the adapter; a cancelled export shows nothing`
  - `recording state set elsewhere (state broadcast) updates the button`
  - `the sidebar indicator shows while recording and goes away after Stop`
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(trace): record, list, export and import in the viewer`.

---

### Task 12: Cost budget

**Files:**
- Create: `packages/trace/bench/overhead.bench.mjs`, `apps/desktop/scripts/trace-startup.mjs`, `apps/desktop/e2e/trace-overhead.spec.js`
- Modify: `packages/trace/src/exclude.json` (filled from profiling)
- Test: `packages/trace/src/overhead.test.js`

**Interfaces:**
- Produces: a micro-benchmark of a hot function plain vs transformed with recording off; a script that launches the app N times with and without the transform (using the e2e launcher) and prints median startup; an e2e spec that runs a scripted interaction on a large screen (the PR list with seeded work) with and without.

- [ ] **Step 1: Write the failing test** `overhead.test.js`: `a transformed function with recording off costs under 3x a plain function in a tight loop of 1e6 calls` (a loose bound that catches a regression, not a benchmark).
- [ ] **Step 2: Run** — Expected: FAIL only if the transform is slow; if it passes, tighten the bound until it can fail, then proceed.
- [ ] **Step 3: Profile** the busiest functions (run the e2e interaction with recording on and count `enter` events per function), add any that fire more than 1 000 times a second without meaning to `exclude.json`; record the before/after numbers in `docs/superpowers/specs/2026-11-05-recording-and-call-trace-design.md` under a new "Measured" heading.
- [ ] **Step 4: Run** the startup script and the e2e overhead spec — Expected: median startup and the scripted interaction within noise (say so with the numbers, and if not, fix by excluding more before continuing).
- [ ] **Step 5: Commit** `perf(trace): hold the cost of tracing when off, with measurements`.

---

### Task 13: End to end in the real app

**Files:**
- Create: `apps/desktop/e2e/recording.spec.js`
- Modify: none other.

**Interfaces:**
- Consumes: the e2e launcher `apps/desktop/e2e/launch.js` (`launchApp`), a seeded profile, a stubbed network.

- [ ] **Step 1: Write the spec:** launch the app; open Settings, Data & sync, press Record; navigate to Pull Requests; click a control that makes a (stubbed) request carrying a seeded token; return and press Stop; open the recording; assert:
  - a click root named from the control exists;
  - under it a call chain reaches a `net` node with the request URL and response body;
  - an `ipc` node from the window's call has main-process frames beneath it;
  - the seeded token appears nowhere in the saved `.nxrec` file or on screen, while an unrecognised value does;
  - the app's behaviour during recording was normal (the control's visible result);
  - Export then Import round-trips the file byte for byte.
- [ ] **Step 2: Run** `cd apps/desktop && npx vite build && npx playwright test e2e/recording.spec.js` — Expected: PASS.
- [ ] **Step 3: Run** the whole suite `npm test` and the existing e2e smoke spec — Expected: PASS.
- [ ] **Step 4: Commit** `test(trace): record and read back a real action end to end`.
