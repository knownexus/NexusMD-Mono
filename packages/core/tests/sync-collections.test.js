import { describe, it, expect, vi, afterEach } from 'vitest'
import { notesCollection, plannerCollection, teamCustomCollection, teamRemovedCollection, tweaksCollection } from '../src/index.js'

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

// If a local write or removal fails (storage full, blocked), the sync engine believes it stored the merged
// data when it did not, so the next round trips the difference. That must leave a trace, not stay silent.
describe('collections log a local write or removal that fails', () => {
  afterEach(() => vi.restoreAllMocks())
  const brokenStorage = () => ({ ...memStorage(), setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => { throw new Error('blocked') } })
  const o = () => ({ storage: brokenStorage(), getProfileKey: k => k.replace('nexusmd.', 'nexusmd.p.p1.'), namespace: 'nexusmd' })

  it('a planner week that cannot be written or removed names the collection and the week', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = plannerCollection(o())
    expect(() => c.writeLocal('2026-W45', { days: [] })).not.toThrow()
    expect(() => c.removeLocal('2026-W45')).not.toThrow()
    expect(warn.mock.calls.map(c => c[0])).toEqual([
      '[sync:collections] ignored: could not write a collection to local storage',
      '[sync:collections] ignored: could not remove a collection from local storage',
    ])
    expect(warn.mock.calls[0][2]).toEqual({ collection: 'planner', key: '2026-W45' })
    expect(warn.mock.calls[0][1].message).toBe('QuotaExceededError')
  })

  it('a single-value collection that cannot be written or removed names the collection', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = notesCollection(o())
    expect(() => c.writeLocal('data', [{ id: 'n1' }])).not.toThrow()
    expect(() => c.removeLocal('data')).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0][2]).toEqual({ collection: 'notes' })
  })

  it('logs nothing when storage works', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = notesCollection({ storage: memStorage(), getProfileKey: k => k, namespace: 'nexusmd' })
    c.writeLocal('data', [])
    c.removeLocal('data')
    expect(warn).not.toHaveBeenCalled()
  })
})
