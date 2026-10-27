import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { createCapabilities } from '@nexusmd/shell-sdk'
import { createPlannerStore, usePlannerStore } from './planner-store.js'
import planner from './index.js'

afterEach(cleanup)

describe('planner store', () => {
  it('takes a value or an updater, like setState', () => {
    const s = createPlannerStore()
    s.setData({ notes: 'a' })
    s.setData(d => ({ ...d, notes: d.notes + 'b' }))
    expect(s.getData()).toEqual({ notes: 'ab' })
    s.setThemes(t => ({ ...t, work: 'blue' }))
    expect(s.getThemes()).toEqual({ work: 'blue' })
  })
  it('tells subscribers about changes, but not about no-ops', () => {
    const s = createPlannerStore()
    const fn = vi.fn()
    const off = s.subscribe(fn)
    const same = s.getData()
    s.setData(same)
    expect(fn).not.toHaveBeenCalled()
    s.setData({ x: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    s.setData({ x: 2 })
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('re-renders a component when the data changes', () => {
    const s = createPlannerStore()
    function Probe() { const [data] = usePlannerStore(s); return <div>{`notes:${data.notes ?? ''}`}</div> }
    render(<Probe />)
    act(() => s.setData({ notes: 'hello' }))
    expect(screen.getByText('notes:hello')).toBeTruthy()
  })
})

describe('what the Planner offers other apps', () => {
  it('lets another app change the planner data through a capability', () => {
    const capabilities = createCapabilities()
    planner.activate({ capabilities })
    expect(capabilities.has('planner.updateData')).toBe(true)
    expect(() => capabilities.call('planner.updateData', prev => ({ ...prev, notes: 'from dashboard' }))).not.toThrow()
  })
})
