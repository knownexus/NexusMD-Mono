import { describe, it, expect, vi } from 'vitest'
import { viewFromLink, registerDeepLinks } from './deep-links.js'

describe('viewFromLink', () => {
  it('reads the screen of an open link', () => {
    expect(viewFromLink('nexusmd://open/git')).toBe('git')
    expect(viewFromLink('nexusmd://open/api-client/')).toBe('api-client')
  })
  it('ignores sign-in links, other schemes and odd screen names', () => {
    expect(viewFromLink('nexusmd://oauth/gdrive?otc=1')).toBeNull()
    expect(viewFromLink('https://open/git')).toBeNull()
    expect(viewFromLink('nexusmd://open/a/b')).toBeNull()
    expect(viewFromLink('nexusmd://open/')).toBeNull()
    expect(viewFromLink('not a url')).toBeNull()
  })
})

describe('registerDeepLinks', () => {
  const make = initial => {
    let cb
    return { isAvailable: () => true, onLink: c => { cb = c }, takeInitial: () => Promise.resolve(initial), emit: u => cb(u) }
  }

  it('opens screens and redeems sign-in codes through the one listener', () => {
    const adapter = make(null), navigate = vi.fn(), redeem = vi.fn()
    registerDeepLinks({ redeem, navigate, adapter })
    adapter.emit('nexusmd://open/notes')
    adapter.emit('nexusmd://oauth/gdrive?otc=1')
    expect(navigate).toHaveBeenCalledExactlyOnceWith('notes')
    expect(redeem).toHaveBeenCalledExactlyOnceWith('nexusmd://oauth/gdrive?otc=1')
  })

  it('acts on the link the app was started with', async () => {
    const navigate = vi.fn()
    registerDeepLinks({ redeem: vi.fn(), navigate, adapter: make('nexusmd://open/editor') })
    await Promise.resolve()
    expect(navigate).toHaveBeenCalledWith('editor')
  })

  it('does nothing without the bridge', () => {
    const adapter = { isAvailable: () => false }
    expect(() => registerDeepLinks({ redeem: vi.fn(), navigate: vi.fn(), adapter })).not.toThrow()
  })
})
