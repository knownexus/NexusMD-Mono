import { describe, it, expect } from 'vitest'
import { indexPRsByWorkItem } from '../../src/modules/ado/pr-links.js'

const pr = (id, wids) => ({ id, linkedWorkItems: wids.map(w => ({ id: w })) })

describe('indexPRsByWorkItem', () => {
  it('groups PRs by linked work item id', () => {
    const a = pr(1, [7]), b = pr(2, [7, 9])
    const idx = indexPRsByWorkItem([a, b])
    expect(idx.get(7)).toEqual([a, b])
    expect(idx.get(9)).toEqual([b])
  })
  it('coerces string ids to numbers', () => {
    const idx = indexPRsByWorkItem([{ id: 1, linkedWorkItems: [{ id: '7' }] }])
    expect(idx.get(7)).toHaveLength(1)
    expect(idx.has('7')).toBe(false)
  })
  it('skips PRs with no links and malformed ids', () => {
    const idx = indexPRsByWorkItem([{ id: 1 }, { id: 2, linkedWorkItems: [{ id: 'x' }] }])
    expect(idx.size).toBe(0)
  })
  it('returns an empty map for empty/nullish input', () => {
    expect(indexPRsByWorkItem([]).size).toBe(0)
    expect(indexPRsByWorkItem(null).size).toBe(0)
  })
})
