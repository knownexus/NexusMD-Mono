import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getDevenvConfig, setDevenvConfig, DEFAULT_DEVENV_CONFIG } from './devenv-config.js'

describe('devenv config', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to C:\\repos\\dev-environment and pwsh on PATH', () => {
    expect(getDevenvConfig()).toEqual(DEFAULT_DEVENV_CONFIG)
    expect(DEFAULT_DEVENV_CONFIG).toEqual({ root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' })
  })

  it('merges and persists patches, and announces the change', () => {
    const seen = vi.fn()
    window.addEventListener('nexusmd:devenv-config', seen)
    expect(setDevenvConfig({ profile: 'D:\\prof' })).toEqual({ ...DEFAULT_DEVENV_CONFIG, profile: 'D:\\prof' })
    expect(getDevenvConfig().profile).toBe('D:\\prof')
    expect(seen).toHaveBeenCalled()
    window.removeEventListener('nexusmd:devenv-config', seen)
  })

  it('survives corrupt storage', () => {
    setDevenvConfig({ pwsh: 'x' })
    for (const k of Object.keys(localStorage)) localStorage.setItem(k, '{nope')
    expect(getDevenvConfig()).toEqual(DEFAULT_DEVENV_CONFIG)
  })
})
