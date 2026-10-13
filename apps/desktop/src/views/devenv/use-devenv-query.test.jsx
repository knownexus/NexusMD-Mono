import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { useDevenvQuery } from './use-devenv-query.js'

afterEach(cleanup)
const CFG = { root: 'C:\repos\dev-environment', pwsh: 'pwsh', profile: '' }
const ARGV = ['build', 'status', '--json']

describe('useDevenvQuery', () => {
  it('loads once, normalises the matching result, and does not poll without an interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const adapter = { query: vi.fn(async () => ({ code: 0, results: [{ kind: 'other' }, { kind: 'builds', items: [1] }], stderr: '' })) }
    const normalise = vi.fn(r => ({ n: r.items.length }))
    const { result } = renderHook(() => useDevenvQuery({ adapter, config: CFG, argv: ARGV, kind: 'builds', normalise, runStatus: 'idle' }))
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }))
    expect(adapter.query).toHaveBeenCalledWith(CFG, ARGV)
    await act(async () => { vi.advanceTimersByTime(60000) })
    expect(adapter.query).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('reports a missing result with the command name and exit code', async () => {
    const adapter = { query: vi.fn(async () => ({ code: 1, results: [], stderr: 'boom' })) }
    const { result } = renderHook(() => useDevenvQuery({ adapter, config: CFG, argv: ARGV, kind: 'builds', normalise: x => x, runStatus: 'idle' }))
    await waitFor(() => expect(result.current.error).toBe('devenv build status returned nothing (exit 1). boom'))
  })

  it('turns a normaliser error into an error, not a crash', async () => {
    const adapter = { query: vi.fn(async () => ({ code: 0, results: [{ kind: 'builds' }], stderr: '' })) }
    const { result } = renderHook(() => useDevenvQuery({ adapter, config: CFG, argv: ARGV, kind: 'builds', normalise: () => { throw new Error('bad shape') }, runStatus: 'idle' }))
    await waitFor(() => expect(result.current.error).toBe('bad shape'))
  })

  it('reloads when a run finishes', async () => {
    const adapter = { query: vi.fn(async () => ({ code: 0, results: [{ kind: 'builds' }], stderr: '' })) }
    const { rerender } = renderHook(p => useDevenvQuery({ adapter, config: CFG, argv: ARGV, kind: 'builds', normalise: x => x, runStatus: p.s }), { initialProps: { s: 'idle' } })
    await waitFor(() => expect(adapter.query).toHaveBeenCalledTimes(1))
    rerender({ s: 'running' })
    rerender({ s: 'done' })
    await waitFor(() => expect(adapter.query).toHaveBeenCalledTimes(2))
  })
})
