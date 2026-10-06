import { describe, it, expect } from 'vitest'
import {
  CATEGORY_LANES, CATEGORY_LABELS, itemCategory, adoStateForCategory,
} from '../../src/modules/workitems/categories.js'

describe('itemCategory', () => {
  it('uses the item stateCategory when it is a lane', () => {
    expect(itemCategory({ state: 'Shipped', stateCategory: 'Completed' })).toBe('Completed')
    expect(itemCategory({ state: 'QA', stateCategory: 'InProgress' })).toBe('InProgress')
    expect(itemCategory({ state: 'Verified', stateCategory: 'Resolved' })).toBe('Resolved')
  })
  it('folds Removed into Completed', () => {
    expect(itemCategory({ state: 'Cut', stateCategory: 'Removed' })).toBe('Completed')
  })
  it('falls back to the state-name regex when no category is known', () => {
    expect(itemCategory({ state: 'Done' })).toBe('Completed')
    expect(itemCategory({ state: 'New' })).toBe('Proposed')
    expect(itemCategory({ state: 'Active' })).toBe('InProgress')
    expect(itemCategory({ state: 'Blocked' })).toBe('InProgress')
  })
  it('exposes lanes in board order with labels', () => {
    expect(CATEGORY_LANES).toEqual(['Proposed', 'InProgress', 'Resolved', 'Completed'])
    expect(CATEGORY_LABELS.InProgress).toBe('In Progress')
  })
})

describe('adoStateForCategory', () => {
  const meta = {
    typeStates: { 'User Story': ['New', 'Active', 'Resolved', 'Closed'], Bug: ['New', 'Committed', 'Done'] },
    stateCategoryByName: { New: 'Proposed', Active: 'InProgress', Committed: 'InProgress', Resolved: 'Resolved', Closed: 'Completed', Done: 'Completed' },
  }
  it('picks the first state of the item type in that category', () => {
    expect(adoStateForCategory({ type: 'story' }, 'Completed', meta)).toBe('Closed')
    expect(adoStateForCategory({ type: 'bug' }, 'InProgress', meta)).toBe('Committed')
  })
  it('falls back to any state in that category when the type is unknown', () => {
    expect(adoStateForCategory({ type: 'mystery' }, 'Proposed', meta)).toBe('New')
  })
  it('returns null when nothing matches or metadata is missing', () => {
    expect(adoStateForCategory({ type: 'bug' }, 'Resolved', meta)).toBeNull()
    expect(adoStateForCategory({ type: 'bug' }, 'Completed', {})).toBeNull()
  })
})
