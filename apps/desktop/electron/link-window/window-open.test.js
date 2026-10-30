import { describe, it, expect, vi } from 'vitest'
import { createWindowOpenHandler } from './window-open.cjs'

// A stand-in for manager.cjs's isAllowedUrl (http/https only).
const allow = (u) => { try { return /^https?:$/.test(new URL(u).protocol) } catch { return false } }

describe('createWindowOpenHandler', () => {
  it('routes http(s) target=_blank urls to openLink and denies the native window', () => {
    const openLink = vi.fn()
    const handler = createWindowOpenHandler({ isAllowedUrl: allow, openLink })
    const result = handler({ url: 'https://uat.example.com/' })
    expect(openLink).toHaveBeenCalledWith('https://uat.example.com/')
    expect(result).toEqual({ action: 'deny' })
  })

  it('does not route disallowed schemes but still denies the native window', () => {
    const openLink = vi.fn()
    const handler = createWindowOpenHandler({ isAllowedUrl: allow, openLink })
    const result = handler({ url: 'file:///etc/passwd' })
    expect(openLink).not.toHaveBeenCalled()
    expect(result).toEqual({ action: 'deny' })
  })

  it('handles missing details or url without throwing, always denying', () => {
    const openLink = vi.fn()
    const handler = createWindowOpenHandler({ isAllowedUrl: allow, openLink })
    expect(handler()).toEqual({ action: 'deny' })
    expect(handler({})).toEqual({ action: 'deny' })
    expect(openLink).not.toHaveBeenCalled()
  })
})

describe('createWindowOpenHandler pop-out windows', () => {
  it('allows only a blank window with the pop-out name', () => {
    const openLink = vi.fn()
    const handler = createWindowOpenHandler({ isAllowedUrl: allow, openLink })
    const result = handler({ url: 'about:blank', frameName: 'nexusmd-popout' })
    expect(result.action).toBe('allow')
    expect(result.overrideBrowserWindowOptions.autoHideMenuBar).toBe(true)
    expect(handler({ url: 'about:blank', frameName: 'nexusmd-popout-2' }).action).toBe('allow')
    expect(handler({ url: 'about:blank', frameName: 'other' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'about:blank', frameName: 'nexusmd-popout-x' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'https://example.com/', frameName: 'nexusmd-popout' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'file:///C:/x.html', frameName: 'nexusmd-popout' })).toEqual({ action: 'deny' })
  })
})
