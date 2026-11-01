import { describe, it, expect } from 'vitest'
import { visibleColumns, gridTemplate, minTableWidth, orderColumns } from '../src/index.js'

// A column list in the shape each view defines: the status dot and actions are locked (never hidden).
const COLS = [
  { id: 'status', label: '', width: '28px', locked: true },
  { id: 'build', label: 'Build', width: '100px' },
  { id: 'actor', label: 'Triggered by', width: 'minmax(120px,1fr)' },
  { id: 'commit', label: 'Commit', width: '72px' },
  { id: 'actions', label: '', width: '140px', locked: true },
]

describe('build columns', () => {
  it('visibleColumns ignores hidden ids that no longer exist', () => {
    expect(visibleColumns(COLS, ['gone', 'commit']).map(c => c.id)).toEqual(['status', 'build', 'actor', 'actions'])
    expect(visibleColumns(COLS, ['gone']).map(c => c.id)).toEqual(['status', 'build', 'actor', 'commit', 'actions'])
  })

  it('visibleColumns never hides a locked column', () => {
    expect(visibleColumns(COLS, ['status', 'actions']).map(c => c.id)).toEqual(['status', 'build', 'actor', 'commit', 'actions'])
  })

  it('visibleColumns accepts catalogs keyed by `key`', () => {
    const cat = [{ key: 'a', width: '10px' }, { key: 'b', width: '20px' }]
    expect(visibleColumns(cat, ['b']).map(c => c.key)).toEqual(['a'])
  })

  it('gridTemplate omits hidden columns', () => {
    expect(gridTemplate(COLS, [])).toBe('28px 100px minmax(120px,1fr) 72px 140px')
    expect(gridTemplate(COLS, ['commit'])).toBe('28px 100px minmax(120px,1fr) 140px')
  })

  it('gridTemplate lets the last column take the spare width when no stretchy column is left', () => {
    expect(gridTemplate(COLS, ['actor'])).toBe('28px 100px 72px minmax(140px, 1fr)')
  })

  it('minTableWidth shrinks when a column is hidden', () => {
    // 28 + 100 + 120 + 72 + 140 + 4 gaps of 8 + 28 padding
    expect(minTableWidth(COLS, [])).toBe(520)
    expect(minTableWidth(COLS, ['commit'])).toBe(520 - 72 - 8)
    expect(minTableWidth(COLS, ['gone'])).toBe(520)
  })

  it('orderColumns keeps unknown/new columns after the saved ones', () => {
    const ids = orderColumns(['commit', 'gone', 'build', 'commit'], COLS).map(c => c.id)
    expect(ids).toEqual(['commit', 'build', 'status', 'actor', 'actions'])
    expect(orderColumns(undefined, COLS).map(c => c.id)).toEqual(COLS.map(c => c.id))
  })
})
