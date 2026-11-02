import React from 'react'
import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ sync: null }))
vi.mock('@nexusmd/ui', () => ({ useAccount: () => ({ sync: state.sync }) }))

import { useObserveForSync, useObserveOnSettingsChange } from './observe-sync.js'

describe('useObserveForSync', () => {
  it('observes on mount, on tweak change and on pagehide', () => {
    state.sync = { observe: vi.fn() }
    const { rerender } = renderHook(({ t }) => useObserveForSync(t), { initialProps: { t: { a: 1 } } })
    expect(state.sync.observe).toHaveBeenCalledTimes(1)
    rerender({ t: { a: 2 } })
    expect(state.sync.observe).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new Event('pagehide'))
    expect(state.sync.observe).toHaveBeenCalledTimes(3)
  })

  it('tolerates a null sync (opted out)', () => {
    state.sync = null
    const { rerender, unmount } = renderHook(({ t }) => useObserveForSync(t), { initialProps: { t: {} } })
    rerender({ t: { b: 1 } })
    window.dispatchEvent(new Event('pagehide'))
    unmount()
  })
})

describe('useObserveOnSettingsChange', () => {
  it('observes when the tab changes and when Settings is left', () => {
    state.sync = { observe: vi.fn() }
    const { rerender, unmount } = renderHook(({ tab }) => useObserveOnSettingsChange(tab), { initialProps: { tab: 'profile' } })
    expect(state.sync.observe).not.toHaveBeenCalled()
    rerender({ tab: 'data' })
    expect(state.sync.observe).toHaveBeenCalledTimes(1)
    unmount()
    expect(state.sync.observe).toHaveBeenCalledTimes(2)
  })

  it('tolerates a null sync', () => {
    state.sync = null
    const { rerender, unmount } = renderHook(({ tab }) => useObserveOnSettingsChange(tab), { initialProps: { tab: 'a' } })
    rerender({ tab: 'b' })
    unmount()
  })
})
