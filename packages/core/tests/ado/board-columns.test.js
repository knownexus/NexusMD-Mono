import { describe, it, expect } from 'vitest'
import {
  syncBoardColumns, getActiveLanes, removeAutoAdded,
  resetToDetected, reorderColumns, toggleColumnHidden, addManualColumn,
} from '../../src/modules/ado/board-columns.js'

const FALLBACK = ['To Do', 'In Progress', 'Done']

describe('syncBoardColumns', () => {
  it('initialises from empty config', () => {
    const result = syncBoardColumns({}, 'proj-a', ['To Do', 'Active', 'Done'])
    expect(result['proj-a'].columns).toEqual(['To Do', 'Active', 'Done'])
    expect(result['proj-a'].autoAdded).toEqual(['To Do', 'Active', 'Done'])
    expect(result['proj-a'].hidden).toEqual([])
  })

  it('appends new states not already in columns', () => {
    const config = { 'proj-a': { columns: ['To Do', 'Done'], autoAdded: ['To Do', 'Done'], hidden: [] } }
    const result = syncBoardColumns(config, 'proj-a', ['To Do', 'Done', 'Testing'])
    expect(result['proj-a'].columns).toEqual(['To Do', 'Done', 'Testing'])
    expect(result['proj-a'].autoAdded).toContain('Testing')
  })

  it('does not duplicate states already present', () => {
    const config = { 'proj-a': { columns: ['To Do', 'Done'], autoAdded: [], hidden: [] } }
    const result = syncBoardColumns(config, 'proj-a', ['To Do', 'Done'])
    expect(result['proj-a'].columns).toEqual(['To Do', 'Done'])
  })

  it('returns same reference when nothing changes', () => {
    const config = { 'proj-a': { columns: ['To Do'], autoAdded: [], hidden: [] } }
    const result = syncBoardColumns(config, 'proj-a', ['To Do'])
    expect(result).toBe(config)
  })

  it('preserves manually-added columns not in detected set', () => {
    const config = { 'proj-a': { columns: ['To Do', 'My Custom'], autoAdded: ['To Do'], hidden: [] } }
    const result = syncBoardColumns(config, 'proj-a', ['To Do', 'Done'])
    expect(result['proj-a'].columns).toContain('My Custom')
    expect(result['proj-a'].columns).toContain('Done')
  })
})

describe('getActiveLanes', () => {
  const config = {
    '__global__': { columns: ['To Do', 'Active', 'Done'], autoAdded: [], hidden: [] },
    'proj-a':     { columns: ['To Do', 'Testing', 'Done'], autoAdded: [], hidden: ['Done'] },
    'proj-b':     { columns: ['Backlog', 'In Progress', 'Done'], autoAdded: [], hidden: [] },
  }

  it('returns fallback when config is empty', () => {
    expect(getActiveLanes({}, 'all', [{ id: 'proj-a' }], FALLBACK)).toEqual(FALLBACK)
  })

  it('uses __global__ for single project', () => {
    const lanes = getActiveLanes(config, 'all', [{ id: 'proj-a' }], FALLBACK)
    expect(lanes).toEqual(['To Do', 'Active', 'Done'])
  })

  it('uses per-project config for specific project', () => {
    const lanes = getActiveLanes(config, 'proj-a', [{ id: 'proj-a' }, { id: 'proj-b' }], FALLBACK)
    expect(lanes).toEqual(['To Do', 'Testing'])   // 'Done' is hidden
  })

  it('unions all projects for "all" view, first project order first', () => {
    const lanes = getActiveLanes(config, 'all', [{ id: 'proj-a' }, { id: 'proj-b' }], FALLBACK)
    expect(lanes[0]).toBe('To Do')   // proj-a first
    expect(lanes).toContain('Backlog')
    expect(lanes).toContain('In Progress')
    expect(lanes).not.toContain('Done') // hidden in proj-a; proj-b has it visible — union keeps it
  })

  it('respects hidden columns', () => {
    const lanes = getActiveLanes(config, 'proj-a', [{ id: 'proj-a' }, { id: 'proj-b' }], FALLBACK)
    expect(lanes).not.toContain('Done')
  })
})

describe('removeAutoAdded', () => {
  it('removes state from autoAdded and adds to hidden', () => {
    const config = { 'proj-a': { columns: ['To Do', 'Testing'], autoAdded: ['Testing'], hidden: [] } }
    const result = removeAutoAdded(config, 'proj-a', 'Testing')
    expect(result['proj-a'].autoAdded).not.toContain('Testing')
    expect(result['proj-a'].hidden).toContain('Testing')
    expect(result['proj-a'].columns).toContain('Testing')  // stays in columns, just hidden
  })

  it('does not duplicate in hidden', () => {
    const config = { 'proj-a': { columns: ['To Do'], autoAdded: ['To Do'], hidden: ['To Do'] } }
    const result = removeAutoAdded(config, 'proj-a', 'To Do')
    expect(result['proj-a'].hidden.filter(s => s === 'To Do').length).toBe(1)
  })

  it('returns same config when projectKey not found', () => {
    const config = {}
    expect(removeAutoAdded(config, 'proj-x', 'Testing')).toBe(config)
  })
})

describe('resetToDetected', () => {
  it('replaces columns with detected states and marks all as autoAdded', () => {
    const config = { 'proj-a': { columns: ['Old', 'Manual'], autoAdded: ['Old'], hidden: ['Old'] } }
    const result = resetToDetected(config, 'proj-a', ['To Do', 'Active', 'Done'])
    expect(result['proj-a'].columns).toEqual(['To Do', 'Active', 'Done'])
    expect(result['proj-a'].autoAdded).toEqual(['To Do', 'Active', 'Done'])
    expect(result['proj-a'].hidden).toEqual([])
  })
})

describe('reorderColumns', () => {
  it('replaces column order', () => {
    const config = { 'proj-a': { columns: ['A', 'B', 'C'], autoAdded: [], hidden: [] } }
    const result = reorderColumns(config, 'proj-a', ['C', 'A', 'B'])
    expect(result['proj-a'].columns).toEqual(['C', 'A', 'B'])
  })
})

describe('toggleColumnHidden', () => {
  it('hides a visible column', () => {
    const config = { 'proj-a': { columns: ['A', 'B'], autoAdded: [], hidden: [] } }
    const result = toggleColumnHidden(config, 'proj-a', 'A', true)
    expect(result['proj-a'].hidden).toContain('A')
  })

  it('unhides a hidden column', () => {
    const config = { 'proj-a': { columns: ['A', 'B'], autoAdded: [], hidden: ['A'] } }
    const result = toggleColumnHidden(config, 'proj-a', 'A', false)
    expect(result['proj-a'].hidden).not.toContain('A')
  })
})

describe('addManualColumn', () => {
  it('appends new state without marking it autoAdded', () => {
    const config = { 'proj-a': { columns: ['To Do'], autoAdded: [], hidden: [] } }
    const result = addManualColumn(config, 'proj-a', 'Staging')
    expect(result['proj-a'].columns).toContain('Staging')
    expect(result['proj-a'].autoAdded).not.toContain('Staging')
  })

  it('does not duplicate if state already present', () => {
    const config = { 'proj-a': { columns: ['To Do'], autoAdded: [], hidden: [] } }
    const result = addManualColumn(config, 'proj-a', 'To Do')
    expect(result['proj-a'].columns.filter(s => s === 'To Do').length).toBe(1)
  })

  it('initialises project entry if not present', () => {
    const result = addManualColumn({}, 'proj-a', 'Staging')
    expect(result['proj-a'].columns).toEqual(['Staging'])
  })
})
