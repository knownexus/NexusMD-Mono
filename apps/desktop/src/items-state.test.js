import { describe, it, expect } from 'vitest'
import { resolveItemsUpdate } from './items-state.js'

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
