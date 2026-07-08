# Timer / Stopwatch Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a timer/stopwatch capability to NexusMD — a pure engine in `@nexusmd/core`, a `useTimer` hook and `<TimerWidget>` in `@nexusmd/ui`, and a team-member stopwatch that saves elapsed time as a note.

**Architecture:** A pure, timestamp-based state machine holds truth (elapsed is recomputed from an absolute `startedAt`, so resume-after-reload is free). A thin React hook owns the render tick and optional persistence via the existing `usePersisted` seam. The team view mounts one `useTimer` per member card and routes the stop result into the existing `addNote` path.

**Tech Stack:** ES modules (no TypeScript), React 18, vitest + @testing-library/react. Matches existing `packages/core/src/modules/*` and `packages/ui/src/*` conventions.

## Global Constraints

- No TypeScript — plain `.js`/`.jsx` with JSDoc, matching sibling files.
- Engine functions are **pure**: never mutate input state, never call `Date.now()` internally — the caller passes `now` (a number, ms).
- Core module registers via `registerModule({ id, name, requiredAdapters, defaultEnabled, init, load, dispose })` like `calendar/index.js`.
- Run core tests from `packages/core` and ui tests from `packages/ui` (never repo root) — workspace/jsdom split. Commands below already `cd` into the right package.
- Styling uses existing CSS tokens (`var(--surface)`, `var(--border)`, `var(--text)`, etc.) and `btn`/`Icon` conventions from `components.jsx`; no new CSS files.
- Commit after every task.

---

### Task 1: Timer engine — stopwatch state machine

**Files:**
- Create: `packages/core/src/modules/timer/index.js`
- Test: `packages/core/src/modules/timer/timer.test.js`

**Interfaces:**
- Consumes: `registerModule` from `../../features/module-registry.js`.
- Produces:
  - `createTimer({ mode = 'stopwatch', durationMs = null } = {}) => State`
  - `elapsedMs(state, now) => number`
  - `start(state, now) => State`
  - `pause(state, now) => State`
  - `resume(state, now) => State`
  - `stop(state, now) => State`
  - `reset(state) => State`
  - State shape: `{ mode, status: 'idle'|'running'|'paused'|'done', accumulatedMs, startedAt|null, durationMs|null, laps: number[] }`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/modules/timer/timer.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  createTimer, elapsedMs, start, pause, resume, stop, reset,
} from './index.js'

describe('timer engine — stopwatch', () => {
  it('createTimer returns an idle stopwatch with zero elapsed', () => {
    const t = createTimer()
    expect(t.mode).toBe('stopwatch')
    expect(t.status).toBe('idle')
    expect(elapsedMs(t, 1000)).toBe(0)
  })

  it('start begins running and elapsed grows with now', () => {
    const t = start(createTimer(), 1000)
    expect(t.status).toBe('running')
    expect(elapsedMs(t, 1000)).toBe(0)
    expect(elapsedMs(t, 4000)).toBe(3000)
  })

  it('pause folds elapsed into accumulatedMs and freezes it', () => {
    let t = start(createTimer(), 1000)
    t = pause(t, 4000)
    expect(t.status).toBe('paused')
    expect(t.accumulatedMs).toBe(3000)
    expect(elapsedMs(t, 9999)).toBe(3000)
  })

  it('resume continues from accumulated elapsed', () => {
    let t = start(createTimer(), 1000)
    t = pause(t, 4000)      // 3000 accumulated
    t = resume(t, 10000)
    expect(t.status).toBe('running')
    expect(elapsedMs(t, 12000)).toBe(5000)  // 3000 + 2000
  })

  it('stop marks done and freezes total elapsed', () => {
    let t = start(createTimer(), 1000)
    t = stop(t, 6000)
    expect(t.status).toBe('done')
    expect(elapsedMs(t, 99999)).toBe(5000)
  })

  it('reset returns to idle with zero elapsed', () => {
    let t = start(createTimer(), 1000)
    t = stop(t, 6000)
    t = reset(t)
    expect(t.status).toBe('idle')
    expect(elapsedMs(t, 99999)).toBe(0)
  })

  it('functions never mutate the input state', () => {
    const t0 = createTimer()
    start(t0, 1000)
    expect(t0.status).toBe('idle')
  })

  it('survives serialize → rehydrate and keeps counting from real time', () => {
    const running = start(createTimer(), 1000)
    const rehydrated = JSON.parse(JSON.stringify(running))
    // 10s of wall-clock passed while the app was closed
    expect(elapsedMs(rehydrated, 11000)).toBe(10000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/modules/timer/timer.test.js`
Expected: FAIL — cannot resolve `./index.js` / functions not defined.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/modules/timer/index.js`:

```js
import { registerModule } from '../../features/module-registry.js'

/**
 * Create a fresh timer state.
 * @param {{ mode?: 'stopwatch'|'countdown', durationMs?: number|null }} [opts]
 */
export function createTimer({ mode = 'stopwatch', durationMs = null } = {}) {
  return {
    mode,
    status: 'idle',
    accumulatedMs: 0,
    startedAt: null,
    durationMs: mode === 'countdown' ? durationMs : null,
    laps: [],
  }
}

/**
 * Elapsed milliseconds = accumulated + the live segment if running.
 * @param {object} state
 * @param {number} now  Wall-clock ms.
 */
export function elapsedMs(state, now) {
  const base = state.accumulatedMs || 0
  if (state.status === 'running' && typeof state.startedAt === 'number' && typeof now === 'number') {
    const delta = now - state.startedAt
    return delta > 0 ? base + delta : base
  }
  return base
}

/** idle/done → fresh running run; paused → resume. */
export function start(state, now) {
  if (state.status === 'running') return state
  if (state.status === 'paused') return resume(state, now)
  return { ...state, status: 'running', startedAt: now, accumulatedMs: 0, laps: [] }
}

/** paused → running, continuing from accumulated elapsed. */
export function resume(state, now) {
  if (state.status !== 'paused') return state
  return { ...state, status: 'running', startedAt: now }
}

/** running → paused, folding the live segment into accumulatedMs. */
export function pause(state, now) {
  if (state.status !== 'running') return state
  return { ...state, status: 'paused', accumulatedMs: elapsedMs(state, now), startedAt: null }
}

/** running/paused → done, freezing total elapsed. */
export function stop(state, now) {
  if (state.status === 'idle' || state.status === 'done') return state
  return { ...state, status: 'done', accumulatedMs: elapsedMs(state, now), startedAt: null }
}

/** any → idle, zeroing elapsed and laps (keeps mode/durationMs). */
export function reset(state) {
  return { ...state, status: 'idle', accumulatedMs: 0, startedAt: null, laps: [] }
}

registerModule({
  id:               'timer',
  name:             'Timer',
  requiredAdapters: [],
  defaultEnabled:   true,

  init(_adapters, _config) {},
  async load(_adapters) { return {} },
  dispose() {},
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/modules/timer/timer.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/timer/index.js packages/core/src/modules/timer/timer.test.js
git commit -m "feat(core): add pure timer engine — stopwatch state machine"
```

---

### Task 2: Timer engine — laps, countdown, formatting + core export

**Files:**
- Modify: `packages/core/src/modules/timer/index.js`
- Modify: `packages/core/src/modules/timer/timer.test.js`
- Modify: `packages/core/src/index.js` (add export block)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `lap(state, now) => State` (pushes current elapsed onto `laps`; no-op unless running)
  - `remainingMs(state, now) => number` (countdown; `0` for stopwatch)
  - `isExpired(state, now) => boolean` (countdown reached zero)
  - `formatDuration(ms, { showMs = false } = {}) => string` → e.g. `"1h 23m 04s"`
  - `formatClock(ms) => string` → `"H:MM:SS"` or `"MM:SS"`
  - All timer functions re-exported from `@nexusmd/core`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/modules/timer/timer.test.js`:

```js
import { lap, remainingMs, isExpired, formatDuration, formatClock } from './index.js'

describe('timer engine — laps', () => {
  it('lap records current elapsed while running', () => {
    let t = start(createTimer(), 1000)
    t = lap(t, 3000)   // 2000
    t = lap(t, 6000)   // 5000
    expect(t.laps).toEqual([2000, 5000])
  })

  it('lap is a no-op when not running', () => {
    const t = lap(createTimer(), 3000)
    expect(t.laps).toEqual([])
  })
})

describe('timer engine — countdown', () => {
  it('remainingMs counts down and clamps at zero', () => {
    let t = createTimer({ mode: 'countdown', durationMs: 5000 })
    t = start(t, 1000)
    expect(remainingMs(t, 3000)).toBe(3000)   // 5000 - 2000
    expect(remainingMs(t, 20000)).toBe(0)     // clamped
  })

  it('remainingMs is 0 for a stopwatch', () => {
    const t = start(createTimer(), 1000)
    expect(remainingMs(t, 4000)).toBe(0)
  })

  it('isExpired is true once elapsed reaches the duration', () => {
    let t = createTimer({ mode: 'countdown', durationMs: 5000 })
    t = start(t, 1000)
    expect(isExpired(t, 5000)).toBe(false)   // 4000 elapsed
    expect(isExpired(t, 6000)).toBe(true)    // 5000 elapsed
  })
})

describe('timer engine — formatting', () => {
  it('formatDuration shows h/m/s, dropping leading empty units', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(83_000)).toBe('1m 23s')
    expect(formatDuration(3_661_000)).toBe('1h 1m 1s')
  })

  it('formatClock pads and drops the hour when zero', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(83_000)).toBe('01:23')
    expect(formatClock(3_661_000)).toBe('1:01:01')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/modules/timer/timer.test.js`
Expected: FAIL — `lap`, `remainingMs`, `isExpired`, `formatDuration`, `formatClock` not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/modules/timer/index.js`, add these functions **above** the `registerModule(...)` call:

```js
/** Record current elapsed as a lap (running only). */
export function lap(state, now) {
  if (state.status !== 'running') return state
  return { ...state, laps: [...state.laps, elapsedMs(state, now)] }
}

/** Countdown milliseconds remaining, clamped at 0. Stopwatch → 0. */
export function remainingMs(state, now) {
  if (state.mode !== 'countdown' || typeof state.durationMs !== 'number') return 0
  return Math.max(0, state.durationMs - elapsedMs(state, now))
}

/** True when a countdown has reached or passed its duration. */
export function isExpired(state, now) {
  return state.mode === 'countdown'
    && typeof state.durationMs === 'number'
    && elapsedMs(state, now) >= state.durationMs
}

/**
 * Human-friendly duration, e.g. "1h 23m 04s". Units before the largest
 * non-zero unit are dropped; seconds are always shown.
 * @param {number} ms
 * @param {{ showMs?: boolean }} [opts]
 */
export function formatDuration(ms, { showMs = false } = {}) {
  const totalMs = Math.max(0, Math.round(ms || 0))
  const totalSec = Math.floor(totalMs / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const parts = []
  if (h) parts.push(`${h}h`)
  if (h || m) parts.push(`${m}m`)
  parts.push(`${s}s`)
  let out = parts.join(' ')
  if (showMs) out += ` ${totalMs % 1000}ms`
  return out
}

/** Clock display "H:MM:SS" (hour dropped when zero → "MM:SS"). */
export function formatClock(ms) {
  const totalSec = Math.floor(Math.max(0, ms || 0) / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
```

Note: the Task-1 test `formatDuration(83_000)` expects `'1m 23s'`; the padded `"04s"` shown in the docstring is illustrative of clock style — `formatDuration` does not zero-pad. The assertions above are authoritative.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/modules/timer/timer.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Export from core index**

In `packages/core/src/index.js`, add after the existing `export { ... } from './modules/audit/index.js'` line:

```js
export {
  createTimer, elapsedMs, start as startTimer, pause as pauseTimer,
  resume as resumeTimer, stop as stopTimer, reset as resetTimer, lap as lapTimer,
  remainingMs, isExpired, formatDuration, formatClock,
} from './modules/timer/index.js'
```

(Transition verbs are aliased — `startTimer` etc. — because `start`/`stop`/`pause`/`reset` are common names likely to collide at call sites.)

- [ ] **Step 6: Verify core still builds/tests**

Run: `cd packages/core && npx vitest run`
Expected: PASS — full core suite green, including new timer tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modules/timer/index.js packages/core/src/modules/timer/timer.test.js packages/core/src/index.js
git commit -m "feat(core): add timer laps, countdown, formatting; export from core"
```

---

### Task 3: `useTimer` React hook

**Files:**
- Create: `packages/ui/src/use-timer.js`
- Test: `packages/ui/src/use-timer.test.jsx`
- Modify: `packages/ui/src/index.js` (add export)

**Interfaces:**
- Consumes: `createTimer, elapsedMs, remainingMs, isExpired, startTimer, pauseTimer, resumeTimer, stopTimer, resetTimer, lapTimer` from `@nexusmd/core`; `usePersisted` from `./app-components.jsx`.
- Produces:
  - `useTimer({ mode = 'stopwatch', durationMs = null, persistKey = null, onExpire } = {}) => { state, elapsedMs, remainingMs, isRunning, laps, start, pause, resume, stop, reset, lap }`
  - `start()/pause()/resume()/stop()/reset()/lap()` take no args (the hook injects `Date.now()`).
  - When `persistKey` is set, state persists through `usePersisted` (profile-scoped storage). When null, state is in-memory.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/use-timer.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimer } from './use-timer.js'

describe('useTimer', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('starts idle at zero elapsed', () => {
    const { result } = renderHook(() => useTimer())
    expect(result.current.isRunning).toBe(false)
    expect(result.current.elapsedMs).toBe(0)
  })

  it('advances elapsed on the tick while running', () => {
    const { result } = renderHook(() => useTimer())
    act(() => { result.current.start() })
    expect(result.current.isRunning).toBe(true)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(1000)
  })

  it('pause freezes elapsed', () => {
    const { result } = renderHook(() => useTimer())
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(2000) })
    act(() => { result.current.pause() })
    const frozen = result.current.elapsedMs
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.elapsedMs).toBe(frozen)
  })

  it('fires onExpire once when a countdown reaches zero', () => {
    const onExpire = vi.fn()
    const { result } = renderHook(() =>
      useTimer({ mode: 'countdown', durationMs: 1000, onExpire }))
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(1500) })
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(result.current.remainingMs).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/use-timer.test.jsx`
Expected: FAIL — cannot resolve `./use-timer.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/ui/src/use-timer.js`:

```js
import React from 'react'
import {
  createTimer, elapsedMs, remainingMs, isExpired,
  startTimer, pauseTimer, resumeTimer, stopTimer, resetTimer, lapTimer,
} from '@nexusmd/core'
import { usePersisted } from './app-components.jsx'

const { useState, useEffect, useRef, useCallback, useMemo } = React

/**
 * React binding for the core timer engine. Owns a display tick (the only
 * moving part); the engine state remains the source of truth.
 *
 * @param {{ mode?: 'stopwatch'|'countdown', durationMs?: number|null,
 *           persistKey?: string|null, onExpire?: () => void }} [opts]
 */
export function useTimer({ mode = 'stopwatch', durationMs = null, persistKey = null, onExpire } = {}) {
  const seed = useMemo(() => createTimer({ mode, durationMs }), [mode, durationMs])

  // Persisted branch and in-memory branch are chosen once per persistKey.
  const persisted = usePersisted(persistKey || '__timer_unused__', seed)
  const memory = useState(seed)
  const [state, setState] = persistKey ? persisted : memory

  const [, forceTick] = useState(0)
  const expiredRef = useRef(false)

  const isRunning = state.status === 'running'

  // Display tick: re-render ~4x/sec while running so elapsed advances.
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => forceTick(n => n + 1), 250)
    return () => clearInterval(id)
  }, [isRunning])

  // Countdown expiry: stop once and notify.
  useEffect(() => {
    if (!isRunning || mode !== 'countdown') return
    if (isExpired(state, Date.now()) && !expiredRef.current) {
      expiredRef.current = true
      setState(s => stopTimer(s, Date.now()))
      onExpire?.()
    }
  })

  const now = Date.now()
  const start  = useCallback(() => { expiredRef.current = false; setState(s => startTimer(s, Date.now())) }, [setState])
  const pause  = useCallback(() => setState(s => pauseTimer(s, Date.now())), [setState])
  const resume = useCallback(() => setState(s => resumeTimer(s, Date.now())), [setState])
  const stop   = useCallback(() => setState(s => stopTimer(s, Date.now())), [setState])
  const reset  = useCallback(() => { expiredRef.current = false; setState(s => resetTimer(s)) }, [setState])
  const lap    = useCallback(() => setState(s => lapTimer(s, Date.now())), [setState])

  return {
    state,
    elapsedMs: elapsedMs(state, now),
    remainingMs: remainingMs(state, now),
    isRunning,
    laps: state.laps,
    start, pause, resume, stop, reset, lap,
  }
}
```

Note on the tick reading `Date.now()`: this is a UI-layer concern (display only) and is acceptable outside the pure engine. `usePersisted` is always called (never conditionally) to satisfy the Rules of Hooks; its result is simply ignored when `persistKey` is null.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run src/use-timer.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Export from ui index**

In `packages/ui/src/index.js`, add near the other component exports (e.g. after the `app-components.jsx` export block):

```js
// Timer / stopwatch — hook + standalone widget (built on @nexusmd/core timer).
export { useTimer } from './use-timer.js'
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/use-timer.js packages/ui/src/use-timer.test.jsx packages/ui/src/index.js
git commit -m "feat(ui): add useTimer hook wrapping the core timer engine"
```

---

### Task 4: `<TimerWidget>` standalone component

**Files:**
- Create: `packages/ui/src/timer-widget.jsx`
- Test: `packages/ui/src/timer-widget.test.jsx`
- Modify: `packages/ui/src/index.js` (add export)

**Interfaces:**
- Consumes: `useTimer` from `./use-timer.js`; `formatClock, formatDuration` from `@nexusmd/core`; `Icon` from `./icons.jsx`.
- Produces:
  - `<TimerWidget mode? durationMs? persistKey? compact? onExpire? onStop? />`
  - `onStop(elapsedMs, { firstStartedAt, stoppedAt })` fires when the user stops (used by the team integration).

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/timer-widget.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimerWidget } from './timer-widget.jsx'

describe('<TimerWidget>', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('renders an initial 00:00 clock and a Start control', () => {
    render(<TimerWidget />)
    expect(screen.getByTestId('timer-clock').textContent).toBe('00:00')
    expect(screen.getByRole('button', { name: /start/i })).toBeTruthy()
  })

  it('shows Pause after starting', () => {
    render(<TimerWidget />)
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    expect(screen.getByRole('button', { name: /pause/i })).toBeTruthy()
  })

  it('calls onStop with elapsed when stopped', () => {
    const onStop = vi.fn()
    render(<TimerWidget onStop={onStop} />)
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    vi.advanceTimersByTime(2000)
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onStop.mock.calls[0][0]).toBeGreaterThanOrEqual(2000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/timer-widget.test.jsx`
Expected: FAIL — cannot resolve `./timer-widget.jsx`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/ui/src/timer-widget.jsx`:

```jsx
import React from 'react'
import { formatClock, formatDuration } from '@nexusmd/core'
import { useTimer } from './use-timer.js'
import { Icon } from './icons.jsx'

const { useRef } = React

/**
 * Standalone stopwatch / countdown widget built on useTimer.
 * @param {{ mode?: 'stopwatch'|'countdown', durationMs?: number|null,
 *           persistKey?: string|null, compact?: boolean,
 *           onExpire?: () => void,
 *           onStop?: (elapsedMs: number, meta: { firstStartedAt: number|null, stoppedAt: number }) => void }} props
 */
export function TimerWidget({ mode = 'stopwatch', durationMs = null, persistKey = null, compact = false, onExpire, onStop }) {
  const t = useTimer({ mode, durationMs, persistKey, onExpire })
  const firstStartedAt = useRef(null)

  const display = mode === 'countdown' ? t.remainingMs : t.elapsedMs
  const idle = t.state.status === 'idle'
  const running = t.state.status === 'running'
  const paused = t.state.status === 'paused'

  const handleStart = () => {
    if (firstStartedAt.current == null) firstStartedAt.current = Date.now()
    t.start()
  }
  const handleStop = () => {
    const elapsed = t.elapsedMs
    const meta = { firstStartedAt: firstStartedAt.current, stoppedAt: Date.now() }
    t.stop()
    onStop?.(elapsed, meta)
  }
  const handleReset = () => { firstStartedAt.current = null; t.reset() }

  const wrap = {
    display: 'inline-flex', flexDirection: 'column', gap: 10,
    padding: compact ? 10 : 16, border: '1px solid var(--border)',
    borderRadius: 12, background: 'var(--surface)', minWidth: compact ? 160 : 200,
  }
  const clockStyle = {
    fontFamily: 'var(--mono, monospace)', fontVariantNumeric: 'tabular-nums',
    fontSize: compact ? 22 : 32, fontWeight: 600, color: 'var(--text)', letterSpacing: 1,
  }

  return (
    <div style={wrap} data-testid="timer-widget">
      <div style={clockStyle} data-testid="timer-clock">{formatClock(display)}</div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(idle || paused) && (
          <button className="btn primary sm" onClick={handleStart}>
            <Icon name="play" size={12}/> {paused ? 'Resume' : 'Start'}
          </button>
        )}
        {running && (
          <button className="btn sm" onClick={t.pause}>
            <Icon name="pause" size={12}/> Pause
          </button>
        )}
        {running && (
          <button className="btn ghost sm" onClick={t.lap}>
            <Icon name="flag" size={12}/> Lap
          </button>
        )}
        {(running || paused) && (
          <button className="btn ghost sm" onClick={handleStop}>
            <Icon name="square" size={12}/> Stop
          </button>
        )}
        {(paused || t.state.status === 'done') && (
          <button className="btn ghost sm" onClick={handleReset}>
            <Icon name="rotate-ccw" size={12}/> Reset
          </button>
        )}
      </div>

      {t.laps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: 'var(--text-muted)' }}>
          {t.laps.map((ms, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Lap {i + 1}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatClock(ms)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

Note: `Icon` names (`play`, `pause`, `flag`, `square`, `rotate-ccw`) must exist in `icons.jsx`. Verify in Step 4; if any is missing, substitute an existing near-equivalent name from `icons.jsx` (the icon set already backs `components.jsx`). The buttons carry text labels, so the tests pass regardless of icon availability.

- [ ] **Step 4: Verify icon names, then run tests**

Check available icon names: `grep -oE "case '[a-z-]+'" packages/ui/src/icons.jsx | sort -u` (or open `icons.jsx`). Replace any missing name used above with an existing one.

Run: `cd packages/ui && npx vitest run src/timer-widget.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Export from ui index**

In `packages/ui/src/index.js`, extend the timer export line from Task 3 to:

```js
// Timer / stopwatch — hook + standalone widget (built on @nexusmd/core timer).
export { useTimer } from './use-timer.js'
export { TimerWidget } from './timer-widget.jsx'
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/timer-widget.jsx packages/ui/src/timer-widget.test.jsx packages/ui/src/index.js
git commit -m "feat(ui): add standalone TimerWidget component"
```

---

### Task 5: Team-member stopwatch → saved note

**Files:**
- Modify: `packages/ui/src/views/view-team.jsx` (NoteModal prefill; per-member timer on DevCard; note composition)
- Test: `packages/ui/src/views/view-team-timer.test.jsx`

**Interfaces:**
- Consumes: `useTimer` from `../use-timer.js`; `formatDuration` from `@nexusmd/core`; existing `addNote(dev, text)`, `NoteModal`, `DevCard` in `view-team.jsx`.
- Produces: a note composed as `⏱ <duration> (<HH:MM>–<HH:MM>) — <label?>` saved through the existing `addNote` path. `firstStartedAt` (not the segment `startedAt`) supplies the range's left edge.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/views/view-team-timer.test.jsx`. This unit-tests the note-composition helper (extracted so it's testable without rendering the whole view):

```jsx
import { describe, it, expect } from 'vitest'
import { composeTimerNote } from './view-team.jsx'

describe('composeTimerNote', () => {
  const start = new Date('2026-07-08T09:15:00').getTime()
  const stop  = new Date('2026-07-08T10:38:00').getTime()

  it('includes duration and a clock range', () => {
    const text = composeTimerNote({ elapsedMs: 83 * 60 * 1000, firstStartedAt: start, stoppedAt: stop, label: '' })
    expect(text).toBe('⏱ 1h 23m 0s (09:15–10:38)')
  })

  it('appends a label when provided', () => {
    const text = composeTimerNote({ elapsedMs: 83 * 60 * 1000, firstStartedAt: start, stoppedAt: stop, label: 'pairing on auth bug' })
    expect(text).toBe('⏱ 1h 23m 0s (09:15–10:38) — pairing on auth bug')
  })

  it('omits the range when start time is unknown', () => {
    const text = composeTimerNote({ elapsedMs: 30_000, firstStartedAt: null, stoppedAt: stop, label: '' })
    expect(text).toBe('⏱ 30s')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run src/views/view-team-timer.test.jsx`
Expected: FAIL — `composeTimerNote` not exported.

- [ ] **Step 3: Add the note-composition helper**

At the top of `packages/ui/src/views/view-team.jsx`, after the existing imports, add an import for `formatDuration` and export the helper. First extend the core import (find the existing `@nexusmd/core` import in the file; if none, add one):

```js
import { formatDuration } from '@nexusmd/core'
```

Then add near the top-level helpers (before `NoteModal`):

```js
/** Two-digit local clock "HH:MM" for a wall-clock ms timestamp. */
function clockHM(ms) {
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Build a team-note string from a stopwatch result:
 *   "⏱ 1h 23m 0s (09:15–10:38) — label"
 * The clock range is omitted when firstStartedAt is null; the label suffix
 * is omitted when empty.
 * @param {{ elapsedMs: number, firstStartedAt: number|null, stoppedAt: number, label?: string }} r
 */
export function composeTimerNote({ elapsedMs, firstStartedAt, stoppedAt, label }) {
  let text = `⏱ ${formatDuration(elapsedMs)}`
  if (typeof firstStartedAt === 'number') text += ` (${clockHM(firstStartedAt)}–${clockHM(stoppedAt)})`
  const trimmed = (label || '').trim()
  if (trimmed) text += ` — ${trimmed}`
  return text
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `cd packages/ui && npx vitest run src/views/view-team-timer.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Extend NoteModal to accept a prefill**

Modify `NoteModal` in `view-team.jsx` to accept an optional `prefill` string and seed the textarea with it:

Change the signature and effect:

```js
function NoteModal({ open, dev, prefill = '', onClose, onSave }) {
  const [text, setText] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => { if (open) setText(prefill) }, [open, prefill])
```

(Everything else in `NoteModal` stays the same — the existing `<textarea>` bound to `text` now shows the prefilled timer note, which the user can edit or extend before saving.)

- [ ] **Step 6: Add a per-member timer to DevCard and wire Stop → NoteModal**

In `DevCard`, add a stopwatch. Add near the top of the `DevCard` function body:

```js
  const timer = useTimer({ persistKey: `nexusmd.timer.team.${dev.id}` })
  const firstStartedAt = React.useRef(null)
```

Import `useTimer` at the top of the file:

```js
import { useTimer } from '../use-timer.js'
import { formatClock } from '@nexusmd/core'
```

(Combine `formatClock` into the existing `@nexusmd/core` import line added in Step 3 rather than duplicating it.)

Add a control to the card. Place this next to the existing "Note" button (around the `onAddNote` button near the bottom of `DevCard`):

```jsx
  {timer.state.status === 'idle' || timer.state.status === 'done' ? (
    <button className="btn ghost sm" title="Start stopwatch"
      onClick={e => { e.stopPropagation(); firstStartedAt.current = Date.now(); timer.start() }}>
      <Icon name="clock" size={10}/> Timer
    </button>
  ) : (
    <button className="btn primary sm" title="Stop & save as note"
      onClick={e => {
        e.stopPropagation()
        const elapsed = timer.elapsedMs
        const meta = { firstStartedAt: firstStartedAt.current, stoppedAt: Date.now() }
        timer.stop()
        firstStartedAt.current = null
        onStopTimer?.(dev, elapsed, meta)
      }}>
      <span style={{ fontVariantNumeric:'tabular-nums' }}>{formatClock(timer.elapsedMs)}</span> · Stop
    </button>
  )}
```

Add `onStopTimer` to the `DevCard` props list (destructure alongside `onAddNote`).

- [ ] **Step 7: Handle the stop in TeamView — open a prefilled NoteModal**

In `TeamView`, add state for the pending timer note and a handler, near the existing `noteTarget` state:

```js
  const [timerNotePrefill, setTimerNotePrefill] = useStateT('')

  const handleStopTimer = (dev, elapsedMs, meta) => {
    setTimerNotePrefill(composeTimerNote({ elapsedMs, ...meta, label: '' }))
    setNoteTarget(dev)
  }
```

Pass `prefill` to the existing `<NoteModal>` and clear it on close:

```jsx
      <NoteModal
        open={noteTarget !== null}
        dev={noteTarget}
        prefill={timerNotePrefill}
        onClose={() => { setNoteTarget(null); setTimerNotePrefill('') }}
        onSave={addNote}
      />
```

Pass `onStopTimer` down to each `DevCard` (add alongside the existing `onAddNote`/`notes` props):

```jsx
            onStopTimer={handleStopTimer}
```

- [ ] **Step 8: Run the full ui suite**

Run: `cd packages/ui && npx vitest run`
Expected: PASS — new timer tests plus existing `view-prs`, `pr-tabs`, `work-item-detail`, etc. remain green.

- [ ] **Step 9: Manual round-trip verification**

Launch the app (per the repo's run instructions), open the Team view, click **Timer** on a member, wait a few seconds, click **Stop**, confirm the NoteModal opens pre-filled with `⏱ …(HH:MM–HH:MM)`, add an optional label, save, and confirm the note appears on the card. Reload the app mid-run to confirm a running team timer resumes with elapsed time intact.

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src/views/view-team.jsx packages/ui/src/views/view-team-timer.test.jsx
git commit -m "feat(ui): team-member stopwatch saved as a note"
```

---

## Notes for the implementer

- **Test runner directories matter:** always `cd packages/core` or `cd packages/ui` before running vitest — running from the repo root hits a workspace/jsdom gap and misreports.
- **Rules of Hooks:** in `useTimer`, `usePersisted` is called unconditionally every render; only its *return value* is conditionally used. Do not move it inside an `if`.
- **Purity:** the engine (`packages/core/src/modules/timer/index.js`) must never read the clock itself. Only the UI layer calls `Date.now()`.
- **Icon names:** verify against `packages/ui/src/icons.jsx` before using (`clock`, `play`, `pause`, `square`, `flag`, `rotate-ccw`); substitute an existing name if any is absent. Text labels keep the tests passing regardless.
