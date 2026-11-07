import { describe, it, expect } from 'vitest'
import { nextSelection } from './change-selection.js'

const ordered = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }))
const state = (selected = [], focusId = null) => ({ ordered, selected, focusId })

describe('nextSelection', () => {
  it('a plain click selects only that change', () => {
    expect(nextSelection(state(['a', 'b']), 'c')).toEqual(['c'])
  })

  it('Ctrl / Cmd toggles one change in or out and keeps the rest', () => {
    expect(nextSelection(state(['a']), 'c', { ctrl: true })).toEqual(['a', 'c'])
    expect(nextSelection(state(['a', 'c']), 'c', { ctrl: true })).toEqual(['a'])
  })

  it('Shift adds the range from the focused change down to the clicked one', () => {
    expect(nextSelection(state([], 'b'), 'd', { shift: true })).toEqual(['b', 'c', 'd'])
  })

  it('Shift adds the range upward too, keeping what was selected', () => {
    expect(nextSelection(state(['e'], 'd'), 'b', { shift: true })).toEqual(['e', 'b', 'c', 'd'])
  })

  it('Shift with nothing focused selects just the clicked change', () => {
    expect(nextSelection(state(['a']), 'c', { shift: true })).toEqual(['c'])
  })

  it('Shift to a change that is not in the list selects just that change', () => {
    expect(nextSelection(state([], 'b'), 'zz', { shift: true })).toEqual(['zz'])
  })
})
