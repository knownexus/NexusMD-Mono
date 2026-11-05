import { describe, it, expect } from 'vitest'
import { listDamagedCopies, discardDamagedCopy } from '../src/modules/sync/damaged-copy.js'

const full = (seed = {}) => {
  const m = { ...seed }
  return {
    m, get length() { return Object.keys(m).length }, key: i => Object.keys(m)[i] ?? null,
    getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] },
  }
}
const P = 'nexusmd.p.x.sync.quarantine.'

describe('listDamagedCopies', () => {
  it('lists the copies kept for one profile, newest first, with what they are and when', () => {
    const s = full({
      [`${P}planner.2026-W26.1000`]: '{"a":',
      [`${P}timelog.v1.data.3000`]: '{"entries":[',
      [`${P}notes.data.2000`]: '[{"id"',
      'nexusmd.p.other.sync.quarantine.planner.2026-W26.5000': 'someone else',
      'nexusmd.p.x.planner.week.2026-W26': 'not a copy',
    })
    expect(listDamagedCopies({ storage: s, namespace: 'nexusmd', profileId: 'x' })).toEqual([
      { key: `${P}timelog.v1.data.3000`, collection: 'timelog.v1', item: 'data', at: 3000, size: 12 },
      { key: `${P}notes.data.2000`, collection: 'notes', item: 'data', at: 2000, size: 6 },
      { key: `${P}planner.2026-W26.1000`, collection: 'planner', item: '2026-W26', at: 1000, size: 5 },
    ])
  })

  it('is empty when nothing was kept, and does not throw on a storage that cannot be read', () => {
    expect(listDamagedCopies({ storage: full(), namespace: 'nexusmd', profileId: 'x' })).toEqual([])
    const broken = { get length() { throw new Error('denied') }, key: () => null, getItem: () => null }
    expect(listDamagedCopies({ storage: broken, namespace: 'nexusmd', profileId: 'x' })).toEqual([])
  })
})

describe('discardDamagedCopy', () => {
  it('removes a kept copy', () => {
    const s = full({ [`${P}notes.data.2000`]: 'x' })
    expect(discardDamagedCopy(s, `${P}notes.data.2000`)).toBe(true)
    expect(s.length).toBe(0)
  })
  it('refuses any key that is not a kept copy (the live value must not be removable from here)', () => {
    const s = full({ 'nexusmd.p.x.planner.week.2026-W26': '{}' })
    expect(discardDamagedCopy(s, 'nexusmd.p.x.planner.week.2026-W26')).toBe(false)
    expect(s.length).toBe(1)
  })
})
