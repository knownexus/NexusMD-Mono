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
