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

  const [state, setState] = usePersisted(
    persistKey || 'nexusmd.timer.__ephemeral__',
    seed,
    { enabled: !!persistKey },
  )

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

/**
 * useTimer plus first-start tracking and a stop() that returns the elapsed
 * time and a { firstStartedAt, stoppedAt } meta object. Shared by TimerWidget
 * and the team-member stopwatch so the stop-contract lives in one place.
 *
 * @param {object} [opts]
 */
export function useStopwatch(opts = {}) {
  const timer = useTimer(opts)
  const firstStartedAt = useRef(null)

  const start = useCallback(() => {
    if (firstStartedAt.current == null) firstStartedAt.current = Date.now()
    timer.start()
  }, [timer])

  const stop = useCallback(() => {
    const elapsed = timer.elapsedMs
    const meta = { firstStartedAt: firstStartedAt.current, stoppedAt: Date.now() }
    timer.stop()
    return { elapsedMs: elapsed, meta }
  }, [timer])

  const reset = useCallback(() => {
    firstStartedAt.current = null
    timer.reset()
  }, [timer])

  return { ...timer, start, stop, reset, firstStartedAt }
}
