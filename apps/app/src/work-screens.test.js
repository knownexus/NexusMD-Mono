import { describe, it, expect, beforeEach } from 'vitest'
import { getOffScreens, setOffScreens, skippedFetches, resetOffScreensCache } from './work-screens.js'

describe('work screens', () => {
  beforeEach(() => { localStorage.clear(); resetOffScreensCache() })

  it('starts with every screen on and fetches everything', () => {
    expect(getOffScreens()).toEqual([])
    expect(skippedFetches()).toEqual({ prs: false, builds: false, tests: false })
  })

  it('skips fetching for switched-off screens that have data of their own', () => {
    setOffScreens(['builds', 'team'])
    expect(skippedFetches()).toEqual({ prs: false, builds: true, tests: false })
    resetOffScreensCache()
    expect(getOffScreens()).toEqual(['builds', 'team'])
  })

  it('ignores unknown ids', () => {
    setOffScreens(['nope', 'pr'])
    expect(getOffScreens()).toEqual(['pr'])
  })
})
