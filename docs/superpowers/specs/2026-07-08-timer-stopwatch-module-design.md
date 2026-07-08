# Timer / Stopwatch Module — Design

**Date:** 2026-07-08
**Status:** Approved (brainstorming)

## Summary

Add a timer/stopwatch capability to NexusMD in three layers that match the
existing `core → ui → views` split:

1. **Engine** — a pure, framework-agnostic timer state machine in
   `@nexusmd/core` (`packages/core/src/modules/timer/`).
2. **React binding + widget** — a `useTimer` hook and a `<TimerWidget>`
   standalone component in `@nexusmd/ui`.
3. **Team integration** — a stopwatch on the team-member card/profile that
   saves elapsed time as a note through the existing `addNote(dev, text)` path.

The engine supports **stopwatch (count-up)**, **lap/split times**,
**countdown**, and **resume-after-reload**.

## Motivation

Users want to track time against work (standalone) and, specifically, run a
stopwatch while working with a team member and log the result as a team note
(e.g. time spent pairing or in a 1:1). NexusMD already has a team-notes model
(`view-team.jsx` → `addNote`) and a profile-scoped persistence seam
(`usePersisted`); the timer builds on both.

## Layer 1 — Engine (`packages/core/src/modules/timer/index.js`)

Framework-agnostic, pure functions in the style of the existing `calendar` and
`planner` modules. No timers, no `setInterval`, no `Date.now()` captured
internally — the caller passes `now` so behaviour is deterministic and unit
tests need no fake clock.

### State shape

A plain JSON object (directly serializable, directly persistable):

```js
{
  mode: 'stopwatch' | 'countdown',
  status: 'idle' | 'running' | 'paused' | 'done',
  accumulatedMs: number,      // elapsed summed across completed run segments
  startedAt: number | null,   // wall-clock ms when the current run segment began; null when not running
  durationMs: number | null,  // countdown target; null for stopwatch
  laps: number[],             // elapsed-ms snapshots at each lap
}
```

**Why timestamp-based:** elapsed is always recomputed as
`accumulatedMs + (status === 'running' ? now - startedAt : 0)`. Because
`startedAt` is an absolute wall-clock timestamp, elapsed recomputes correctly
after an app reload/restart with zero drift — **resume-after-reload is free**:
persist the state object, rehydrate it, done. No background clock to keep alive.

### API

Transition functions — each takes `(state, now)` and returns a **new** state
(never mutates):

- `createTimer({ mode = 'stopwatch', durationMs = null } = {})` → initial state (`status: 'idle'`)
- `start(state, now)` — idle/done → running; sets `startedAt`
- `pause(state, now)` — running → paused; folds the current segment into `accumulatedMs`, clears `startedAt`
- `resume(state, now)` — paused → running; sets `startedAt` (alias-compatible with `start`)
- `stop(state, now)` — running/paused → done; folds elapsed, clears `startedAt`
- `reset(state)` — → idle; zeroes `accumulatedMs`, `laps`, `startedAt` (keeps `mode`/`durationMs`)
- `lap(state, now)` — pushes current `elapsedMs` onto `laps` (no-op unless running)

Derived reads (pure, no state change):

- `elapsedMs(state, now)` → number
- `remainingMs(state, now)` → countdown only: `max(0, durationMs - elapsedMs)`; `0` for stopwatch
- `isExpired(state, now)` → countdown reached zero (drives `status: 'done'` transition in the UI tick)
- `formatDuration(ms, { showMs = false } = {})` → `"1h 23m 04s"` style, plus a clock helper `formatClock(ms)` → `"HH:MM:SS"` / `"MM:SS"` for the widget display

Countdown reaching zero is surfaced via `isExpired`; the UI tick calls `stop`
and may fire an optional `onExpire` callback. The engine itself emits no events
and imports nothing beyond `registerModule` (consistent with sibling modules).

### Exports

Add a `export { ... } from './modules/timer/index.js'` block to
`packages/core/src/index.js`.

### Tests

`packages/core/src/modules/timer/timer.test.js` (vitest). Covers each
transition, elapsed math across pause/resume, lap capture, countdown
expiry, reset, and — critically — **serialize → rehydrate → elapsedMs with a
later `now`** to prove resume-after-reload. All deterministic via injected `now`.

## Layer 2 — React binding + widget (`@nexusmd/ui`)

### `useTimer` hook — `packages/ui/src/use-timer.js`

Wraps the engine and owns the **only** moving part: a `setInterval` tick
(~250ms while running, cleared when not) whose sole job is to trigger a
re-render so the displayed elapsed advances. The engine state remains the
source of truth; the tick reads `elapsedMs(state, Date.now())`.

Signature:

```js
const t = useTimer({ mode, durationMs, persistKey, onExpire })
// → { state, elapsedMs, remainingMs, laps, isRunning,
//     start, pause, resume, stop, reset, lap }
```

- When `persistKey` is provided, the hook stores engine state via the existing
  `usePersisted(persistKey, createTimer({ mode, durationMs }))` seam
  (profile-scoped localStorage, same mechanism as team notes). This satisfies
  the standalone widget's resume-after-reload requirement.
- When `persistKey` is omitted, state is in-memory (`useState`).
- On mount, if a persisted timer was `running`, it simply keeps running — the
  tick resumes and elapsed reflects real wall-clock time away.

### `<TimerWidget>` component — `packages/ui/src/timer-widget.jsx`

A self-contained stopwatch/countdown UI built on `useTimer`, styled with the
repo's existing CSS tokens and `btn`/`Icon` conventions (see `components.jsx`):

- Large monospace elapsed/remaining display (`formatClock`).
- Controls: Start / Pause / Resume / Lap / Reset — shown contextually by `status`.
- Optional lap list when laps exist.
- Props: `mode`, `durationMs`, `persistKey`, `compact`, `onExpire`, and an
  optional `onStop(elapsedMs, { startedAt, stoppedAt })` callback so hosts
  (like the team card) can capture the result.

Export `useTimer` and `TimerWidget` from `packages/ui/src/index.js`.

## Layer 3 — Team-member integration (`packages/ui/src/views/view-team.jsx`)

Add a stopwatch affordance to the team-member card/menu (near the existing
"Add note" action in `DevCard`). Behaviour:

1. Clicking **Start timer** begins a per-member stopwatch (persisted with key
   `nexusmd.timer.team.<devId>` so it survives reload and is scoped per member).
   A running member shows a small live elapsed badge on the card.
2. Clicking **Stop & save** stops the stopwatch and opens the existing
   `NoteModal` pre-filled with an optional label field; the note text is
   composed as:

   ```
   ⏱ 1h 23m (09:15–10:38) — <optional label>
   ```

   - duration via `formatDuration`
   - `(HH:MM–HH:MM)` clock range = **first** start → stop time. Because
     `startedAt` only tracks the current run segment (it resets on
     resume), the team-timer host records a separate `firstStartedAt`
     (captured on the initial `start`, cleared on `reset`) for the range's
     left edge; the right edge is the stop time.
   - ` — <label>` appended only when the user typed one.
3. Saving routes through the existing `addNote(dev, text)` path — no new
   persistence, no schema change. The note appears on the card like any other,
   and syncs via the existing `notesCollection`.

The `NoteModal` gains an optional `prefill`/`label` affordance; the timer state
lives in `TeamView` alongside `teamNotes` (or via the per-member persisted
timer key), keeping `DevCard` presentational.

## Data flow

```
User → TimerWidget / DevCard control
     → useTimer (React tick for render only)
     → core/timer pure transitions (source of truth)
     → usePersisted → profile-scoped storage   (resume-after-reload)

Team stop → format duration+range+label → addNote(dev, text)
          → existing team-notes storage + notesCollection sync
```

## Error handling & edge cases

- **Clock skew / system sleep:** elapsed is wall-clock based, so sleeping the
  machine counts as elapsed time (correct for time tracking). Documented, not
  "fixed".
- **Negative/NaN `now`:** transition functions guard against missing `now` by
  treating derived elapsed as `accumulatedMs` (never negative).
- **Countdown past zero:** `remainingMs` clamps at `0`; UI stops and calls
  `onExpire` once (guarded by `status: 'done'`).
- **Storage quota / private mode:** inherited from `usePersisted` (already
  swallows write failures); a non-persistable timer degrades to in-memory.
- **Multiple running team timers:** allowed and independent (separate persist
  keys). No global "one timer" constraint imposed.

## Scope / YAGNI

**In scope:** the four engine modes, the hook, the standalone widget, and the
team-member note integration.

**Out of scope (not building now):** work-item time tracking UI, timer history
/ aggregation reports, cross-device timer sync (only the *note* syncs), audio
alarms, and system notifications on countdown expiry (host can wire `onExpire`
later).

## Build order

1. Engine + tests in `@nexusmd/core`, export from core index. Run vitest from
   `packages/core`.
2. `useTimer` hook + `<TimerWidget>` in `@nexusmd/ui`, export from ui index.
3. Team-member integration in `view-team.jsx` (+ `NoteModal` label affordance).
4. Verify: engine unit tests, widget render, and a manual team-timer → note
   round-trip.
