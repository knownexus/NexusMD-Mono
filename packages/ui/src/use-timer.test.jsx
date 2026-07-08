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
