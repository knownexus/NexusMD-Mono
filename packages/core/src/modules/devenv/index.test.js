import { describe, it, expect } from 'vitest'
import { getRegistry } from '../../features/module-registry.js'
import './index.js'

describe('devenv module registration', () => {
  it('registers a desktop-gated, off-by-default module', () => {
    const m = getRegistry().find(x => x.id === 'devenv')
    expect(m.name).toBe('Dev Environment')
    expect(m.requiredAdapters).toEqual(['devenv'])
    expect(m.defaultEnabled).toBe(false)
  })
})
