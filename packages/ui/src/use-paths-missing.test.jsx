import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { usePathsMissing } from './use-paths-missing.js'

afterEach(() => { cleanup(); delete window.electronAPI })

describe('usePathsMissing', () => {
  it('lets only the latest check set state when checks resolve out of order', async () => {
    const pending = []
    window.electronAPI = { file: { exists: () => new Promise(res => pending.push(res)) } }
    const { result } = renderHook(() => usePathsMissing(['C:/a']))
    // Second check (focus) starts while the mount check is still pending.
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(pending).toHaveLength(2))
    // The newer check answers first: present. The older, stale one answers later: missing.
    await act(async () => { pending[1](true) })
    await act(async () => { pending[0](false) })
    expect(result.current.size).toBe(0)
  })
})
