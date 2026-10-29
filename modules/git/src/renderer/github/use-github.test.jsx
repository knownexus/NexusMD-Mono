import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup, act, waitFor } from '@testing-library/react'
import { core } from '@nexusmd/core'
import { useGithub } from './use-github.js'

afterEach(cleanup)

const host = () => ({
  capabilities: { provide: vi.fn(), has: n => n === 'work.github', call: vi.fn(() => ({ repos: ['acme/web'], http: { fetch: vi.fn() }, cached: { prs: [], issues: [] } })) },
})
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })

describe('useGithub', () => {
  it('refreshes on Work\'s data update but not on another module\'s', async () => {
    const h = host()
    const { result } = renderHook(() => useGithub(h))
    expect(result.current.refreshKey).toBe(0)
    act(() => core._emit('data:updated', { moduleId: 'calendar', data: {} }))
    await tick()
    expect(result.current.refreshKey).toBe(0)
    expect(h.capabilities.call).toHaveBeenCalledTimes(1)
    // Work announces its refresh with no module id.
    act(() => core._emit('data:updated'))
    await waitFor(() => expect(result.current.refreshKey).toBe(1))
    expect(h.capabilities.call).toHaveBeenCalledTimes(2)
  })
})

describe('useGithub at startup', () => {
  it('finds Work\'s GitHub registered by an ancestor\'s effect after its own first read', async () => {
    // React runs a child's effects before its parent's: Work's provider registers after the hook reads.
    const React = await import('react')
    const caps = new Map()
    const h = { capabilities: { provide: vi.fn(), has: n => caps.has(n), call: n => caps.get(n)() } }
    function WorkLike({ children }) {
      React.useEffect(() => { caps.set('work.github', () => ({ repos: ['acme/web'], http: { fetch: vi.fn() }, cached: { prs: [], issues: [] } })) }, [])
      return children
    }
    const { result } = renderHook(() => useGithub(h), { wrapper: WorkLike })
    await waitFor(() => expect(result.current?.repos).toEqual(['acme/web']))
  })
})
