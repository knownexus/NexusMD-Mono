import { describe, it, expect } from 'vitest'
import { notesCollection, teamCustomCollection, teamRemovedCollection, tweaksCollection } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get length() { return m.size }, key: i => [...m.keys()][i] ?? null,
  }
}
const opts = (seed) => ({ storage: memStorage(seed), getProfileKey: k => k.replace('nexusmd.', 'nexusmd.p.p1.'), namespace: 'nexusmd' })

describe('notesCollection', () => {
  it('reads/writes the globalNotes array and merges by id (keep-both)', () => {
    const c = notesCollection(opts({ 'nexusmd.p.p1.planner.globalNotes': JSON.stringify([{ id: 'n1', body: 'a' }]) }))
    expect(c.id).toBe('notes')
    expect(c.listLocal()).toEqual(['data'])
    expect(c.readLocal('data')).toEqual([{ id: 'n1', body: 'a' }])
    // keep-both: same note edited on both sides
    const base = [{ id: 'n1', body: 'a' }]
    const local = [{ id: 'n1', body: 'mine' }]
    const remote = [{ id: 'n1', body: 'theirs' }]
    const { conflicts } = c.merge(base, local, remote, { from: 'B', prefer: 'local' })
    expect(conflicts).toEqual([{ kind: 'row', id: 'n1', from: 'remote' }])
  })

  it('listLocal is empty when the key is absent', () => {
    expect(notesCollection(opts({})).listLocal()).toEqual([])
  })
})

describe('teamCustomCollection', () => {
  it('merges custom members by id', () => {
    const c = teamCustomCollection(opts({ 'nexusmd.p.p1.team.custom': JSON.stringify([{ id: 'm1', name: 'A' }]) }))
    expect(c.id).toBe('team-custom')
    expect(c.readLocal('data')).toEqual([{ id: 'm1', name: 'A' }])
    const { merged } = c.merge([], [{ id: 'm1', name: 'A' }], [{ id: 'm2', name: 'B' }])
    expect(merged.map(m => m.id).sort()).toEqual(['m1', 'm2'])
  })
})

describe('teamRemovedCollection', () => {
  it('unions removed ids', () => {
    const c = teamRemovedCollection(opts({ 'nexusmd.p.p1.team.removed': JSON.stringify(['x']) }))
    expect(c.id).toBe('team-removed')
    const { merged } = c.merge(['x'], ['x', 'y'], ['x', 'z'])
    expect(merged.sort()).toEqual(['x', 'y', 'z'])
  })
})

describe('tweaksCollection', () => {
  it('merges settings per key (newest-wins via prefer)', () => {
    const c = tweaksCollection(opts({ 'nexusmd.p.p1.tweaks': JSON.stringify({ theme: 'dark' }) }))
    expect(c.id).toBe('tweaks')
    expect(c.readLocal('data')).toEqual({ theme: 'dark' })
    const { merged } = c.merge({ theme: 'light' }, { theme: 'dark' }, { theme: 'light', density: 'compact' }, { prefer: 'local' })
    expect(merged).toEqual({ theme: 'dark', density: 'compact' })
  })
})
