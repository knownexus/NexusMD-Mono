import { describe, it, expect } from 'vitest'
import { mergeLists } from '../src/index.js'

const baseList = () => ({ id: 'a', name: 'A', items: [{ id: '1', title: 'x' }, { id: '2', title: 'y' }] })
const wrap = (...lists) => ({ lists })

describe('mergeLists', () => {
  it('edits to different items on each side both survive in one list', () => {
    const base = wrap(baseList())
    const local = wrap({ ...baseList(), items: [{ id: '1', title: 'x local' }, { id: '2', title: 'y' }] })
    const remote = wrap({ ...baseList(), items: [{ id: '1', title: 'x' }, { id: '2', title: 'y remote' }] })
    const { merged, conflicts } = mergeLists(base, local, remote)
    expect(merged.lists).toHaveLength(1)
    expect(merged.lists[0].id).toBe('a')
    expect(merged.lists[0].items).toEqual([{ id: '1', title: 'x local' }, { id: '2', title: 'y remote' }])
    expect(conflicts).toEqual([])
  })

  it("same item edited on both sides keeps both, second id '1__conflict'", () => {
    const base = wrap(baseList())
    const local = wrap({ ...baseList(), items: [{ id: '1', title: 'L' }, { id: '2', title: 'y' }] })
    const remote = wrap({ ...baseList(), items: [{ id: '1', title: 'R' }, { id: '2', title: 'y' }] })
    const { merged, conflicts } = mergeLists(base, local, remote)
    expect(merged.lists).toHaveLength(1)
    const items = merged.lists[0].items
    expect(items.map(i => i.id)).toEqual(['1', '1__conflict', '2'])
    expect(items[0].title).toBe('L')
    expect(items[1].title).toBe('R')
    expect(conflicts).toEqual([{ kind: 'row', id: '1', from: 'remote', listId: 'a' }])
  })

  it('list added on remote appears', () => {
    const base = wrap(baseList())
    const local = wrap(baseList())
    const added = { id: 'b', name: 'B', items: [{ id: '9', title: 'z' }] }
    const remote = wrap(baseList(), added)
    const { merged } = mergeLists(base, local, remote)
    expect(merged.lists.map(l => l.id)).toEqual(['a', 'b'])
    expect(merged.lists[1]).toEqual(added)
  })

  it('list deleted locally and untouched remotely is dropped', () => {
    const base = wrap(baseList())
    const { merged, conflicts } = mergeLists(base, wrap(), wrap(baseList()))
    expect(merged.lists).toEqual([])
    expect(conflicts).toEqual([])
  })

  it('list deleted remotely but items added locally is kept', () => {
    const base = wrap(baseList())
    const local = wrap({ ...baseList(), items: [...baseList().items, { id: '3', title: 'new' }] })
    const { merged, conflicts } = mergeLists(base, local, wrap())
    expect(merged.lists).toHaveLength(1)
    expect(merged.lists[0].items.map(i => i.id)).toEqual(['1', '2', '3'])
    expect(conflicts).toEqual([{ kind: 'list', id: 'a', from: 'remote-delete' }])
  })

  it('list-level rename uses the newer side (prefer local) without duplicating items', () => {
    const base = wrap(baseList())
    const local = wrap({ ...baseList(), name: 'Local name' })
    const remote = wrap({ ...baseList(), name: 'Remote name', color: '#48b870' })
    const { merged, conflicts } = mergeLists(base, local, remote, { prefer: 'local' })
    expect(merged.lists).toHaveLength(1)
    expect(merged.lists[0].name).toBe('Local name')
    expect(merged.lists[0].color).toBe('#48b870')
    expect(merged.lists[0].items).toEqual(baseList().items)
    expect(conflicts).toEqual([{ kind: 'keyval', key: 'name', winner: 'local', listId: 'a' }])
  })

  it('a list with no items key does not throw', () => {
    const bare = { id: 'a', name: 'A' }
    expect(() => mergeLists(wrap(bare), wrap({ ...bare, name: 'L' }), wrap({ ...bare, color: '#fff' }))).not.toThrow()
    const { merged } = mergeLists(wrap(bare), wrap({ ...bare, name: 'L' }), wrap({ ...bare, color: '#fff' }))
    expect(merged.lists).toEqual([{ id: 'a', name: 'L', color: '#fff' }])
  })

  it('first sync (no base) matches lists by id instead of duplicating them', () => {
    const local = wrap({ ...baseList(), items: [{ id: '1', title: 'x' }] })
    const remote = wrap({ ...baseList(), items: [{ id: '1', title: 'x' }, { id: '2', title: 'y' }] })
    const { merged } = mergeLists(null, local, remote)
    expect(merged.lists).toHaveLength(1)
    expect(merged.lists[0].items.map(i => i.id)).toEqual(['1', '2'])
  })

  it('tolerates null/malformed sides', () => {
    expect(mergeLists(null, null, null).merged).toEqual({ lists: [] })
    expect(mergeLists(undefined, { lists: 'bad' }, wrap(baseList())).merged.lists.map(l => l.id)).toEqual(['a'])
  })
})
