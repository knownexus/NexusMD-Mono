import { describe, it, expect } from 'vitest'
import { core, initCore } from '../src/index.js'

describe('@nexusmd/core smoke', () => {
  it('exports core singleton', () => {
    expect(core).toBeDefined()
    expect(typeof core.isEnabled).toBe('function')
    expect(typeof core.on).toBe('function')
    expect(typeof core.off).toBe('function')
  })

  it('exports initCore as an async function', () => {
    expect(typeof initCore).toBe('function')
    expect(initCore.constructor.name).toBe('AsyncFunction')
  })
})
