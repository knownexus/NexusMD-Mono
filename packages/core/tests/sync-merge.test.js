import { describe, it, expect } from 'vitest'
import { mergeRows, mergeKeyVal, mergeText, mergeSet, mergePlannerWeek } from '../src/index.js'

const rows = (...r) => r

describe('mergeRows', () => {
  it('keeps additions from both sides', () => {
    const base = rows({ id: 'a', t: 1 })
    const local = rows({ id: 'a', t: 1 }, { id: 'b', t: 2 })
    const remote = rows({ id: 'a', t: 1 }, { id: 'c', t: 3 })
    const { merged, conflicts } = mergeRows(base, local, remote)
    expect(merged.map(r => r.id).sort()).toEqual(['a', 'b', 'c'])
    expect(conflicts).toEqual([])
  })

  it('takes the remote edit when local is unchanged', () => {
    const base = rows({ id: 'a', t: 1 })
    const local = rows({ id: 'a', t: 1 })
    const remote = rows({ id: 'a', t: 9 })
    const { merged } = mergeRows(base, local, remote)
    expect(merged).toEqual([{ id: 'a', t: 9 }])
  })

  it('drops a row deleted remotely when local is unchanged', () => {
    const base = rows({ id: 'a', t: 1 })
    const local = rows({ id: 'a', t: 1 })
    const remote = rows()
    const { merged } = mergeRows(base, local, remote)
    expect(merged).toEqual([])
  })

  it('keeps both when the same row is edited on both sides', () => {
    const base = rows({ id: 'a', t: 1 })
    const local = rows({ id: 'a', t: 2 })
    const remote = rows({ id: 'a', t: 3 })
    const { merged, conflicts } = mergeRows(base, local, remote, 'id')
    expect(merged).toContainEqual({ id: 'a', t: 2 })
    expect(merged).toContainEqual({ id: 'a__conflict', t: 3, _conflict: { from: 'remote' } })
    expect(conflicts).toEqual([{ kind: 'row', id: 'a', from: 'remote' }])
  })

  it('keeps an edit that races a delete (edit wins, conflict noted)', () => {
    const base = rows({ id: 'a', t: 1 })
    const local = rows()
    const remote = rows({ id: 'a', t: 5 })
    const { merged, conflicts } = mergeRows(base, local, remote)
    expect(merged).toContainEqual({ id: 'a', t: 5 })
    expect(conflicts.length).toBe(1)
  })
})

describe('mergeKeyVal', () => {
  it('takes each side’s independent key change', () => {
    const base = { theme: 'light', density: 'cozy' }
    const local = { theme: 'dark', density: 'cozy' }
    const remote = { theme: 'light', density: 'compact' }
    const { merged, conflicts } = mergeKeyVal(base, local, remote)
    expect(merged).toEqual({ theme: 'dark', density: 'compact' })
    expect(conflicts).toEqual([])
  })

  it('resolves a same-key conflict by prefer', () => {
    const base = { theme: 'light' }
    const local = { theme: 'dark' }
    const remote = { theme: 'sepia' }
    expect(mergeKeyVal(base, local, remote, { prefer: 'local' }).merged).toEqual({ theme: 'dark' })
    const r = mergeKeyVal(base, local, remote, { prefer: 'remote' })
    expect(r.merged).toEqual({ theme: 'sepia' })
    expect(r.conflicts).toEqual([{ kind: 'keyval', key: 'theme', winner: 'remote' }])
  })

  it('honors a one-sided deletion', () => {
    const base = { a: 1, b: 2 }
    const local = { a: 1 }
    const remote = { a: 1, b: 2 }
    expect(mergeKeyVal(base, local, remote).merged).toEqual({ a: 1 })
  })
})

describe('mergeText', () => {
  it('takes the changed side when only one changed', () => {
    expect(mergeText('x', 'x', 'y').merged).toBe('y')
    expect(mergeText('x', 'z', 'x').merged).toBe('z')
    expect(mergeText('x', 'x', 'x').merged).toBe('x')
  })
  it('keeps both when both changed', () => {
    const { merged, conflicts } = mergeText('base', 'mine', 'theirs', { from: 'phone' })
    expect(merged).toBe('mine\n\n--- conflict from phone ---\n\ntheirs')
    expect(conflicts).toEqual([{ kind: 'text', from: 'phone' }])
  })
})

describe('mergeSet', () => {
  it('unions ids from both sides without duplicates', () => {
    const { merged, conflicts } = mergeSet(['a'], ['a', 'b'], ['a', 'c'])
    expect(merged.sort()).toEqual(['a', 'b', 'c'])
    expect(conflicts).toEqual([])
  })
})

describe('mergePlannerWeek', () => {
  it('merges independent edits across section types and tags conflicts', () => {
    const base = { data: {}, themes: {} }
    const local = { data: {}, themes: { mon: 'plan A' } }
    const remote = { data: {}, themes: { tue: 'plan B' } }
    const { merged } = mergePlannerWeek(base, local, remote)
    expect(merged.themes).toEqual({ mon: 'plan A', tue: 'plan B' })
  })

  it('keeps both when the same themes key changes on both sides', () => {
    const base = { data: {}, themes: { mon: 'x' } }
    const local = { data: {}, themes: { mon: 'mine' } }
    const remote = { data: {}, themes: { mon: 'theirs' } }
    const { conflicts } = mergePlannerWeek(base, local, remote, { prefer: 'local' })
    expect(conflicts).toContainEqual({ kind: 'keyval', key: 'mon', winner: 'local', sectionId: 'themes' })
  })
})
