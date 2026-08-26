// packages/core/tests/ado/process-metadata.test.js
import { describe, it, expect } from 'vitest'
import { fetchAdoProcessMetadata } from '../../src/modules/ado/process-metadata.js'

function makeGet(responses) {
  return async (path) => {
    for (const [pattern, data] of Object.entries(responses)) {
      if (path.includes(pattern)) return data
    }
    return { value: [] }
  }
}

const TYPES_RESPONSE = {
  value: [
    { name: 'Bug', isDisabled: false },
    { name: 'Task', isDisabled: false },
    { name: 'Retired Type', isDisabled: true },
  ],
}

const BUG_STATES = {
  value: [
    { name: 'New', category: 'Proposed' },
    { name: 'Active', category: 'InProgress' },
    { name: 'Verified', category: 'Resolved' },
    { name: 'Closed', category: 'Completed' },
  ],
}

const TASK_STATES = {
  value: [
    { name: 'To Do', category: 'Proposed' },
    { name: 'Doing', category: 'InProgress' },
    { name: 'Done', category: 'Completed' },
  ],
}

const PRIORITY_FIELDS = {
  value: [
    { referenceName: 'Microsoft.VSTS.Common.Priority', allowedValues: [1, 2, 3, 4] },
  ],
}

function makeStandardGet() {
  return makeGet({
    'workitemtypes?api-version': TYPES_RESPONSE,
    'workitemtypes/Bug/states': BUG_STATES,
    'workitemtypes/Task/states': TASK_STATES,
    'workitemtypes/Bug/fields': PRIORITY_FIELDS,
    'workitemtypes/Task/fields': PRIORITY_FIELDS,
  })
}

describe('fetchAdoProcessMetadata', () => {
  it('returns empty result for no projects', async () => {
    const result = await fetchAdoProcessMetadata(makeStandardGet(), [])
    expect(result).toEqual({
      types: [], typeStates: {}, stateCategoryByName: {}, states: [],
      terminalStateNames: [], doneStateNames: [], priorities: [],
    })
  })

  it('filters out disabled types', async () => {
    const result = await fetchAdoProcessMetadata(makeStandardGet(), ['Proj'])
    expect(result.types).not.toContain('Retired Type')
    expect(result.types).toEqual(['Bug', 'Task'])
  })

  it('builds per-type state lists', async () => {
    const result = await fetchAdoProcessMetadata(makeStandardGet(), ['Proj'])
    expect(result.typeStates.Bug).toEqual(['New', 'Active', 'Verified', 'Closed'])
    expect(result.typeStates.Task).toEqual(['To Do', 'Doing', 'Done'])
  })

  it('classifies a custom terminal state ("Verified") as done, not just the standard names', async () => {
    const result = await fetchAdoProcessMetadata(makeStandardGet(), ['Proj'])
    expect(result.stateCategoryByName.Verified).toBe('Resolved')
    expect(result.doneStateNames).toContain('Verified')
    expect(result.terminalStateNames).toContain('Verified')
  })

  it('excludes Proposed/InProgress states from terminal/done lists', async () => {
    const result = await fetchAdoProcessMetadata(makeStandardGet(), ['Proj'])
    expect(result.terminalStateNames).not.toContain('New')
    expect(result.terminalStateNames).not.toContain('Active')
    expect(result.doneStateNames).not.toContain('Active')
  })

  it('unions numeric priority allowedValues across types, sorted ascending', async () => {
    const result = await fetchAdoProcessMetadata(makeStandardGet(), ['Proj'])
    expect(result.priorities).toEqual([1, 2, 3, 4])
  })

  it('does not throw when a project fails entirely', async () => {
    const get = async (path) => { throw new Error('network down') }
    const result = await fetchAdoProcessMetadata(get, ['BrokenProj'])
    expect(result).toEqual({
      types: [], typeStates: {}, stateCategoryByName: {}, states: [],
      terminalStateNames: [], doneStateNames: [], priorities: [],
    })
  })

  it('does not throw when the states call fails for one type but the fields call succeeds', async () => {
    const get = makeGet({
      'workitemtypes?api-version': { value: [{ name: 'Bug', isDisabled: false }] },
      'workitemtypes/Bug/fields': PRIORITY_FIELDS,
      // no 'states' entry → falls through to the default { value: [] } in makeGet
    })
    const result = await fetchAdoProcessMetadata(get, ['Proj'])
    expect(result.types).toEqual(['Bug'])
    expect(result.priorities).toEqual([1, 2, 3, 4])
  })
})
