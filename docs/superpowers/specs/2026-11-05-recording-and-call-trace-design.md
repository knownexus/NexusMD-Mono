# Recording and the call trace

## Intent

When something goes wrong in NexusMD, the person fixing it needs to see exactly what happened and when. Today the
logs show what the app chose to say. They do not show what it did.

The moment this is for: start a recording, use the app (open the PR page, merge a PR), the action gives an
unexpected result, go back and stop the recording, open it and find the point where the PR was merged. There the
person reads, in order, every function that ran, with the values passed in and what each returned or threw, the
network requests with what was sent and what came back, and the log lines written along the way. From that they
find the cause and then the place in the code to fix it.

The PR merge is the example. This is for anything in the app: a git operation, a dev environment check, a database
query, an API client request, a planner edit.

## Goals

- A **Record** control in the log viewer (next to Go live). While recording, everything is captured in full detail
  across the whole app (windows and main process, every module). Stop ends it and saves it.
- A saved **recording** that can be reopened later, listed in the viewer, and deleted.
- **Export**: a recording can be saved out as a single file (and a file like it opened again), complete and unaltered,
  for the person's own use.
- The recording opens as a **tree**. The top level is the person's actions ("Clicked Merge on PR 4411"). Under an
  action, in order: the functions it caused, each expandable to the functions it called in turn. A function node
  shows its arguments, its return value (or the error it threw), how long it took, and where it is in the source
  (file and line).
- **Network requests** are nodes in the tree, with the request (method, URL, headers, body) and the response
  (status, headers, body), placed under the function that made them.
- **Calls between a window and the main process** (and between modules) are nodes in the tree, with arguments and
  result, so one action can be followed from a click in a window through the main process and back.
- **Log lines** (including debug, which is normally off) appear in the tree at the point they were written, under
  the function that wrote them.
- Time is visible: each node has when it started and how long it took.
- Work that continues after an `await` appears under the function that was waiting, not as a separate root.

## Non-goals

- Not a profiler. No sampling, flame graphs or performance analysis. Duration is shown only because "when" matters.
- Not a debugger. No pausing, no breakpoints, no stepping, and no way to change anything.
- No sending or sharing of recordings by the app. Export writes a file the person keeps; the app does not upload
  it, attach it anywhere, or strip or warn about its contents (it is for the person's own use).
- Third-party library internals are not traced (React, the editor, the markdown library and the like). Calls from our
  code into them are visible as calls, and their results as return values.
- Local variables that are not an argument, a return value, a thrown error, a request, a response or a log field are
  not captured. If a value is not one of those, the way to see it is to log it.

## Anti-goals (a failure even if it technically works)

- Slowing the app down when nobody is recording. The cost when not recording must be negligible.
- A recording that leaks secrets it could have recognised. Tokens, passwords, keys, authorization headers and the like
  must be hidden the way the existing logs hide them, in arguments, return values, requests and responses alike.
  (An unusual secret that matches no rule is shown; that is accepted.)
- A recording that grinds the app to a halt or fills the disk. It must stop cleanly at a size limit and say so.
- A tree that is unreadable because of noise. React's render and hook functions, and other functions that fire
  constantly without meaning, must not bury the action the person is looking for.
- Tracing that changes behaviour. A traced function must return, throw and resolve exactly as it did. A failure in the
  tracing itself must never break the app.

## Decided with the person who asked

- Tracing is **always built in** to the shipped app. Recording works on a normal installed copy with no special
  build. (They chose this over a build used only for tracing, accepting the larger app and the small cost per call.)
- Function arguments and return values are required, in a nested call tree, in order. A flat list is not enough.
- The main process is **in scope**, not a later extra: "anything in the app" includes git, devenv, database and the
  API client, whose work happens there.
- Secrets are hidden as in the existing logs (their stated expectation, and an anti-goal above). A value that cannot be
  recognised as a secret is **shown**: a recording keeps request and response bodies by default, because the person
  needs them to find a cause. There is no switch that hides bodies.
- Recordings are for the person's own use only. Export keeps everything, with no warning and no data-minimising mode.

## The builder's calls that the person has not seen (change them if wrong)

- Function reporting is added to our own source code **at build time**, in the window code and in the main-process
  code. Third-party code and React render/hook functions are left out by default, with a way to list further
  functions or files to leave out.
- When not recording, each function's reporting is one cheap check that the recording is off.
- Values are cut to a depth and length limit before they are stored, so a huge object becomes a readable summary
  that says it was cut. Secret hiding runs on the cut value.
- A recording has a size cap. At the cap it stops and the tree says where it stopped.
- The recording is stored as a file per recording under the existing logs folder, separate from the daily logs, and
  deleted by the same retention rules or by the person.
- Clicks (and key presses that submit or trigger something) are caught at the window level and named from the
  control's label or accessible name, with the page it was on. Each starts a new top-level node.

## Constraints from how the app is built

- Window code is bundled by Vite: `apps/desktop/vite.config.js` for the all-in-one build, and, for the split layout,
  `apps/desktop/build/build-split.mjs`, which builds the shell and then each app's window code and its main-process
  code (main is bundled there with rolldown). A build plugin fits both.
- In the all-in-one build the main-process code is **not bundled**: `electron/**/*` and the `modules/*/src/main`
  packages are shipped as plain CommonJS files. Reporting must be added to those somewhere in packaging, and the
  same must work when running from source.
- Window code reaches the main process through the preload bridge (`window.electronAPI`, `apps/desktop/electron/preload.cjs`).
  Calls go through the logged IPC wrapper (`packages/main-kit/src/logging/ipc.cjs`).
- The main process already carries a correlation id (`cid`) and the list of modules a call passed through
  (`packages/main-kit/src/logging/context.cjs`, using AsyncLocalStorage). The window has no equivalent across `await`.
- The PR merge, as an example, runs in the window: the Merge button's handler calls
  `packages/core/src/modules/github/pr-actions.js` (and the Azure DevOps code), which call `window.fetch`.
- The logging that exists: the hub (`packages/main-kit/src/logging`), the window logger (`packages/core/src/log.js`),
  the viewer (`apps/desktop/src/log-viewer.jsx`, shown under Settings, Data & sync, Application Logs).
- Android and the web app are out of scope: they have no log hub and no viewer.

## What is left to the builder

- How reporting is added to main-process code in the all-in-one build and when running from source.
- How work after an `await` is kept under its function, in the window and in the main process.
- How a window action, the call it makes to the main process, and what happens there are joined into one tree.
- The recording file format, and how the viewer loads a large recording without freezing.
- How the tree is laid out, searched and filtered, within the viewer's existing look.
- The default size limits, the depth and length of cut values, and the default list of functions to leave out.
- What the Record control looks like while a recording is running (it must be obvious that it is running), and how
  the person is told a recording hit its cap.

## More builder's calls, made after a read-through (change them if wrong)

- **Hiding secrets** goes beyond the existing key-name redaction, because a recording holds arbitrary values. Three
  layers: the existing redactor (key names); value patterns (bearer and basic credentials, token-shaped strings, and
  secrets in URL query strings and in the user-info part of a URL); and a built-in list of requests and functions
  whose arguments, bodies and results are replaced outright (sign-in, token exchange, secret storage). A value that
  none of these recognise is shown. This is best effort, not a guarantee, and the viewer says so on a recording.
- **Cost when not recording** is held to: no measurable change in startup time, and no measurable change in a
  scripted interaction on a large screen (the PR list). A micro-benchmark of an instrumented hot function checks the
  per-call cost, and the exclusion list is built from profiling the busiest functions.
- **Platforms:** the reporting is added only in the desktop builds. The web and Android builds of shared packages
  (`packages/core`, `packages/ui`) are built without it, and a test fails if reporting code reaches them.
- **Window to main process:** one recording per app instance, owned by the main process; windows are told to start
  and stop, and a window opened mid-recording joins it. Calls through the preload bridge carry the id of the
  window-side call that made them, added in the one place the bridge is built (not per channel), so each call is
  attributed exactly; a call that arrives without one becomes its own root. Clocks are the main process's.
- **Language forms:** plain functions, arrow functions, methods, async functions and generators are traced.
  Getters, setters and class constructors are left untraced at first (the call into them is still visible from the
  caller's side). A traced function must behave identically (return, throw, resolve, `this`, `name`, `length`); this
  is tested for every form above, including async.
- **Format:** each recording carries a format version. An older or newer one that cannot be read says so and is
  kept, not deleted or migrated.

## Measured (Task 12, with nothing recording)

Measured on the development machine, the real app, window code built with and without the reports (`NEXUSMD_TRACE=0`),
interleaved runs with the folder copied fresh before each (`apps/desktop/scripts/trace-cost.mjs`, 6 rounds each, medians):

| | plain | with the reports |
|---|---|---|
| Window bundle | 3.17 MB | 4.35 MB (x1.37) |
| Start-up to the first screen | 2.07 s | 2.12 s (x1.03); 2.33 s (x1.12) when run from source, where the main process's files are changed as they load |
| 20 screen changes | 1.59 s | 1.48 s (x0.93) |

- Plain's own start-ups ranged from 1.55 s to 2.30 s, so the start-up and screen-change differences are inside the run-to-run noise.
- Per call, a traced function costs about 1 ns more than a plain one (up to x1.13 on the tightest loops): `packages/trace/bench/overhead.bench.mjs`;
  `packages/trace/src/overhead.test.js` checks that with nothing recording a traced function never calls the recorder (a test that measured time
  was flaky under a full run).
- Run from source, changing the main process's files with Babel on every launch cost about 1.5 s at start-up. They are now kept in a cache
  (`node_modules/.cache/nexusmd-trace` in the checkout, private to the user and never used through a link; keyed by file size, time and the
  transform), so only the first launch after a change pays it. The
  installed app does not do this: its main-process files are changed when it is staged.
- Profiling a session of clicking through screens, `getProfileKey`, `getActiveProfileId`, `getActiveId` and `storeOf` were 40% of all calls and
  said nothing, so they are left out by default (`packages/trace/src/exclude.json`): 10,081 calls in 8.3 s became 6,012.
- The bundle is bigger by more than the "small cost" hoped for. Shorter report ids (the file path is repeated in each) would give back a few
  percent of it; not done.
