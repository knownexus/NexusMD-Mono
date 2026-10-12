import { describe, it, expect } from 'vitest'
import { normaliseSummary } from './summary.js'

describe('normaliseSummary', () => {
  it('groups rows under their headings and flags failures', () => {
    const s = normaliseSummary({
      kind: 'summary', title: 'Session up',
      rows: [
        { key: 'Backend', value: '' }, { key: 'Orders API', value: 'http://127.0.0.1:5101' },
        { key: 'Mobile', value: '' }, { key: 'iOS', value: 'FAILED - ssh exit 255' },
      ],
      notes: ['devenv status'],
    })
    expect(s.title).toBe('Session up')
    expect(s.sections).toEqual([
      { heading: 'Backend', rows: [{ key: 'Orders API', value: 'http://127.0.0.1:5101', failed: false }] },
      { heading: 'Mobile', rows: [{ key: 'iOS', value: 'FAILED - ssh exit 255', failed: true }] },
    ])
    expect(s.notes).toEqual(['devenv status'])
  })
  it('keeps rows before any heading in an untitled section', () => {
    expect(normaliseSummary({ kind: 'summary', rows: [{ key: 'a', value: 'b' }] }).sections).toEqual([{ heading: null, rows: [{ key: 'a', value: 'b', failed: false }] }])
  })
})
