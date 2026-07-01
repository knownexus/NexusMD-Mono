import { describe, it, expect, vi } from 'vitest'
import { createWindowOpenHandler } from './window-open.cjs'

// A stand-in for manager.cjs's isAllowedUrl (http/https only).
const allow = (u) => { try { return /^https?:$/.test(new URL(u).protocol) } catch { return false } }

describe('createWindowOpenHandler', () => {
  it('routes http(s) target=_blank urls to openLink and denies the native window', () => {
    const openLink = vi.fn()
    const handler = createWindowOpenHandler({ isAllowedUrl: allow, openLink })
    const result = handler({ url: 'https://cirrus.uat.msl.co.uk/' })
    expect(openLink).toHaveBeenCalledWith('https://cirrus.uat.msl.co.uk/')
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
