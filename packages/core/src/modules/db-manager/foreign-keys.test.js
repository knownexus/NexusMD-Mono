import { describe, it, expect } from 'vitest'
import { followTargets, referencingTargets, whereLabel } from './foreign-keys.js'

describe('followTargets', () => {
  const structure = { foreignKeys: [{ key: 'fk1', columns: ['A', 'B'], refTable: 'P', refColumns: ['X', 'Y'] }] }
  it('pairs referenced columns with the row values', () => {
    expect(followTargets(structure, ['A', 'B'], [1, 2])).toEqual([
      { key: 'fk1', table: 'P', where: [{ column: 'X', value: 1 }, { column: 'Y', value: 2 }], label: 'A, B → P' },
    ])
  })
  it('leaves out a key with a null column', () => {
    expect(followTargets(structure, ['A', 'B'], [1, null])).toEqual([])
  })
  it('follows a self-reference', () => {
    const s = { foreignKeys: [{ key: 'fk', columns: ['ParentID'], refTable: 'Node', refColumns: ['ID'] }] }
    expect(followTargets(s, ['ID', 'ParentID'], [1, 2])[0].table).toBe('Node')
  })
  it('passes strings and dates through unchanged', () => {
    const d = new Date()
    const s = { foreignKeys: [{ key: 'k', columns: ['A', 'B'], refTable: 'P', refColumns: ['X', 'Y'] }] }
    const [t] = followTargets(s, ['A', 'B'], ['9007199254740993', d])
    expect(t.where[0].value).toBe('9007199254740993')
    expect(t.where[1].value).toBe(d)
  })
})

describe('referencingTargets', () => {
  it('filters the referencing table by the key columns', () => {
    const s = { referencedBy: [{ key: 'r', table: 'Member', columns: ['BookingID'], refColumns: ['ID'] }] }
    expect(referencingTargets(s, ['ID'], [5])).toEqual([
      { key: 'r', table: 'Member', where: [{ column: 'BookingID', value: 5 }], label: 'Member by BookingID' },
    ])
    expect(referencingTargets(s, ['ID'], [null])).toEqual([])
  })
})

describe('whereLabel', () => {
  it('joins pairs and shows NULL and dates readably', () => {
    expect(whereLabel([{ column: 'A', value: 1 }, { column: 'B', value: null }])).toBe('A = 1 · B IS NULL')
    expect(whereLabel([{ column: 'D', value: new Date(Date.UTC(2026, 9, 26, 9, 30)) }])).toBe('D = 2026-10-26T09:30:00')
  })
})
