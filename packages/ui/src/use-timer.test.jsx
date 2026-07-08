import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimer, useStopwatch } from './use-timer.js'
import { NexusDataProvider } from './data-context.jsx'

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

  it('does not write to storage when persistKey is null (in-memory)', () => {
    const setItem = vi.fn()
    const storage = { getItem: () => null, setItem, removeItem: vi.fn() }
    const wrapper = ({ children }) => (
      <NexusDataProvider value={{ storage }}>{children}</NexusDataProvider>
    )
    const { result } = renderHook(() => useTimer(), { wrapper })
    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(500) })
    expect(setItem).not.toHaveBeenCalled()
  })

  it('writes to storage when a persistKey is given', () => {
    const setItem = vi.fn()
    const storage = { getItem: () => null, setItem, removeItem: vi.fn() }
    const wrapper = ({ children }) => (
      <NexusDataProvider value={{ storage }}>{children}</NexusDataProvider>
    )
    const { result } = renderHook(() => useTimer({ persistKey: 'nexusmd.timer.test' }), { wrapper })
    act(() => { result.current.start() })
    expect(setItem).toHaveBeenCalled()
  })
})

describe('useStopwatch', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('captures firstStartedAt on first start and keeps it across pause/resume', () => {
    const { result } = renderHook(() => useStopwatch())

    let firstStart
    act(() => { firstStart = Date.now(); result.current.start() })
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => { result.current.pause() })
    act(() => { vi.advanceTimersByTime(2000) })
    act(() => { result.current.start() }) // resume
    act(() => { vi.advanceTimersByTime(500) })

    let stopResult
    act(() => { stopResult = result.current.stop() })

    expect(stopResult.meta.firstStartedAt).toBe(firstStart)
    expect(stopResult.elapsedMs).toBeGreaterThan(0)
  })

  it('stop() returns elapsedMs and meta with firstStartedAt/stoppedAt', () => {
    const { result } = renderHook(() => useStopwatch())

    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(1500) })

    let stopResult
    act(() => { stopResult = result.current.stop() })

    expect(stopResult.elapsedMs).toBeGreaterThan(0)
    expect(typeof stopResult.meta.firstStartedAt).toBe('number')
    expect(typeof stopResult.meta.stoppedAt).toBe('number')
    expect(stopResult.meta.firstStartedAt).toBeLessThanOrEqual(stopResult.meta.stoppedAt)
  })

  it('reset() clears firstStartedAt so the next start captures a fresh value', () => {
    const { result } = renderHook(() => useStopwatch())

    act(() => { result.current.start() })
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => { result.current.stop() })
    act(() => { result.current.reset() })

    act(() => { vi.advanceTimersByTime(5000) })
    let secondStart
    act(() => { secondStart = Date.now(); result.current.start() })
    act(() => { vi.advanceTimersByTime(200) })

    let stopResult
    act(() => { stopResult = result.current.stop() })

    expect(stopResult.meta.firstStartedAt).toBe(secondStart)
  })
})
