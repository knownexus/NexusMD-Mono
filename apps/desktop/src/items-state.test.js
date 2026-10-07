import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { resolveItemsUpdate, useLocalItems } from './items-state.js'

describe('resolveItemsUpdate', () => {
  const snapshot = [{ id: 1, assignee: null }, { id: 2, assignee: null }]

  it('applies a functional update against the fallback when prev is the null sentinel', () => {
    // Reproduces the assign crash: prev is null and the updater does arr.map(...)
    const next = resolveItemsUpdate(
      null,
      arr => arr.map(w => (w.id === 1 ? { ...w, assignee: 'louis' } : w)),
      snapshot,
    )
    expect(next).toEqual([{ id: 1, assignee: 'louis' }, { id: 2, assignee: null }])
  })

  it('applies a functional update against prev once it holds an array', () => {
    const prev = [{ id: 9, assignee: 'x' }]
    const next = resolveItemsUpdate(prev, arr => arr.map(w => ({ ...w, assignee: 'y' })), snapshot)
    expect(next).toEqual([{ id: 9, assignee: 'y' }])
  })

  it('passes through a direct (non-function) value', () => {
    expect(resolveItemsUpdate(null, [{ id: 5 }], snapshot)).toEqual([{ id: 5 }])
  })

  it('falls back to [] when both prev and fallback are nullish', () => {
    expect(resolveItemsUpdate(null, arr => [...arr, { id: 1 }], null)).toEqual([{ id: 1 }])
  })
})

describe('useLocalItems', () => {
  it('holds optimistic edits until the snapshot changes, then mirrors the new snapshot again', () => {
    const snap1 = { WORK_ITEMS: [{ id: 1, assignee: null }] }
    const { result, rerender } = renderHook(({ snapshot }) => useLocalItems(snapshot), { initialProps: { snapshot: snap1 } })
    expect(result.current[0]).toBeNull()

    act(() => result.current[1](arr => arr.map(w => ({ ...w, assignee: 'louis' }))))
    expect(result.current[0]).toEqual([{ id: 1, assignee: 'louis' }])

    rerender({ snapshot: snap1 }) // same snapshot: the edit survives
    expect(result.current[0]).toEqual([{ id: 1, assignee: 'louis' }])

    const snap2 = { WORK_ITEMS: [{ id: 1, assignee: null }, { id: 2, assignee: null }] }
    rerender({ snapshot: snap2 }) // new snapshot (refresh, hide/restore): reset to the sentinel
    expect(result.current[0]).toBeNull()

    act(() => result.current[1](arr => arr.map(w => (w.id === 2 ? { ...w, assignee: 'x' } : w))))
    expect(result.current[0]).toEqual([{ id: 1, assignee: null }, { id: 2, assignee: 'x' }])
  })
})
