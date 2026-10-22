import { describe, it, expect, vi } from 'vitest'
import { useRoutedWorkItemSource } from './use-routed-work-item-source.js'

describe('useRoutedWorkItemSource', () => {
  it('keeps the same routed source across re-renders (e.g. snapshot refreshes) and rebuilds only when a source changes', async () => {
    const { renderHook } = await import('@testing-library/react')
    const ado = { loadDetail: vi.fn() }
    const jira = { loadDetail: vi.fn() }
    const { result, rerender } = renderHook(({ snapshot, j }) => {
      void snapshot
      return useRoutedWorkItemSource(ado, j)
    }, { initialProps: { snapshot: { WORK_ITEMS: [] }, j: null } })
    const first = result.current
    rerender({ snapshot: { WORK_ITEMS: [{ id: 1 }] }, j: null })
    expect(result.current).toBe(first)
    rerender({ snapshot: { WORK_ITEMS: [{ id: 2 }] }, j: jira })
    expect(result.current).not.toBe(first)
    expect(result.current.jira).toBe(jira)
    const second = result.current
    rerender({ snapshot: { WORK_ITEMS: [{ id: 3 }] }, j: jira })
    expect(result.current).toBe(second)
  })
})

