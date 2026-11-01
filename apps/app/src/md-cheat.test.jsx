import { describe, it, expect } from 'vitest'
import { CHEAT } from '@nexusmd/core'
import { FORMATS } from './views/md-phone.jsx'

describe('cheat sheet', () => {
  it('only points at formatting chips that exist', () => {
    const titles = FORMATS.map(f => f.title)
    for (const g of CHEAT) for (const it of g.items) expect(titles).toContain(it.format)
  })
})
