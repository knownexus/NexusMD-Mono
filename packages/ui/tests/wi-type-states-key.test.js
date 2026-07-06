import { describe, it, expect } from 'vitest'
import { WI_TYPE_STATES_CACHE_KEY } from '../src/index.js'

describe('WI_TYPE_STATES_CACHE_KEY', () => {
  it('is the board work-item-type states cache key', () => {
    expect(WI_TYPE_STATES_CACHE_KEY).toBe('nexusmd.wi.wiTypeStates.cache')
  })
})
