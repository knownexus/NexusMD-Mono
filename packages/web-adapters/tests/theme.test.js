import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('themeAdapter', () => {
  it('can be imported with no window and reports light', async () => {
    vi.stubGlobal('window', undefined)
    const { themeAdapter } = await import('../src/theme.js')
    expect(themeAdapter.getColorScheme()).toBe('light')
    expect(() => themeAdapter.onChange(() => {})()).not.toThrow()
  })

  it('follows prefers-color-scheme and notifies on change', async () => {
    let listener
    const mql = {
      matches: true,
      addEventListener: (_t, h) => { listener = h },
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('window', { matchMedia: vi.fn(() => mql) })
    const { themeAdapter } = await import('../src/theme.js')
    expect(themeAdapter.getColorScheme()).toBe('dark')
    const cb = vi.fn()
    const off = themeAdapter.onChange(cb)
    listener({ matches: false })
    expect(cb).toHaveBeenCalledWith('light')
    off()
    expect(mql.removeEventListener).toHaveBeenCalled()
  })
})
