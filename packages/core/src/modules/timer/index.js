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
