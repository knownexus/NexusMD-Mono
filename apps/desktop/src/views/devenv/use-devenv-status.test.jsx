import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useDevenvStatus } from './use-devenv-status.js'

afterEach(() => { cleanup(); vi.useRealTimers() })

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const statusResult = { type: 'result', kind: 'status', docker: { ok: true }, backend: [{ key: 'orders', label: 'Orders API', port: 5101, state: 'running' }] }
const adapterWith = impl => ({ query: vi.fn(impl) })

describe('useDevenvStatus', () => {
  it('queries status --json on mount', async () => {
    const a = adapterWith(async () => ({ code: 0, results: [statusResult], stderr: '' }))
    const { result } = renderHook(() => useDevenvStatus({ adapter: a, config: CFG, runStatus: 'idle' }))
    await act(async () => {})
    expect(a.query).toHaveBeenCalledWith(CFG, ['status', '--json'])
    expect(result.current.status.backend[0].state).toBe('running')
    expect(result.current.error).toBeNull()
  })

  it('polls on the interval while visible', async () => {
    vi.useFakeTimers()
    const a = adapterWith(async () => ({ code: 0, results: [statusResult], stderr: '' }))
    renderHook(() => useDevenvStatus({ adapter: a, config: CFG, runStatus: 'idle', intervalMs: 1000 }))
    await act(async () => {})
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(a.query.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it('refreshes when a run ends', async () => {
    const a = adapterWith(async () => ({ code: 0, results: [statusResult], stderr: '' }))
    const { rerender } = renderHook(p => useDevenvStatus({ adapter: a, config: CFG, runStatus: p }), { initialProps: 'running' })
    await act(async () => {})
    const before = a.query.mock.calls.length
    rerender('done')
    await act(async () => {})
    expect(a.query.mock.calls.length).toBe(before + 1)
  })

  it('reports a query that returns no status', async () => {
    const a = adapterWith(async () => ({ code: 1, results: [], stderr: 'No profile at C:\\x' }))
    const { result } = renderHook(() => useDevenvStatus({ adapter: a, config: CFG, runStatus: 'idle' }))
    await act(async () => {})
    expect(result.current.error).toBe('devenv status returned nothing (exit 1). No profile at C:\\x')
  })

  it('reports a rejected query', async () => {
    const a = adapterWith(async () => { throw new Error('devenv took too long to answer status --json') })
    const { result } = renderHook(() => useDevenvStatus({ adapter: a, config: CFG, runStatus: 'idle' }))
    await act(async () => {})
    expect(result.current.error).toMatch(/too long/)
  })

  it('works under StrictMode double-mount', async () => {
    const a = adapterWith(async () => ({ code: 0, results: [statusResult], stderr: '' }))
    const { result } = renderHook(() => useDevenvStatus({ adapter: a, config: CFG, runStatus: 'idle' }), { wrapper: React.StrictMode })
    await act(async () => {})
    expect(result.current.status.backend[0].state).toBe('running')
    expect(result.current.loading).toBe(false)
  })

  it('keeps the newest response when an older one resolves last', async () => {
    const mk = state => ({ code: 0, results: [{ ...statusResult, backend: [{ key: 'orders', label: 'O', port: 1, state }] }], stderr: '' })
    let release
    const first = new Promise(r => { release = () => r(mk('stopped')) })
    const a = adapterWith(() => (a.query.mock.calls.length === 1 ? first : Promise.resolve(mk('running'))))
    const { result } = renderHook(() => useDevenvStatus({ adapter: a, config: CFG, runStatus: 'idle' }))
    await act(async () => { await result.current.refresh() })
    await act(async () => { release() })
    expect(result.current.status.backend[0].state).toBe('running')
  })

  it('does not flip loading on interval polls', async () => {
    vi.useFakeTimers()
    const a = adapterWith(async () => ({ code: 0, results: [statusResult], stderr: '' }))
    const { result } = renderHook(() => useDevenvStatus({ adapter: a, config: CFG, runStatus: 'idle', intervalMs: 1000 }))
    await act(async () => {})
    expect(result.current.loading).toBe(false)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.loading).toBe(false)
    await act(async () => {})
  })
})
