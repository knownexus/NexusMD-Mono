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

registerModule({
  id:               'timer',
  name:             'Timer',
  requiredAdapters: [],
  defaultEnabled:   true,

  init(_adapters, _config) {},
  async load(_adapters) { return {} },
  dispose() {},
})
