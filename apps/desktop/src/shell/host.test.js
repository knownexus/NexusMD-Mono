import { describe, it, expect, vi, beforeEach } from 'vitest'

// host.js pulls in the shell's sign-in and sync modules; only navigation is under test here.
vi.mock('../cloud-auth.js', () => ({ makeDesktopOAuthService: vi.fn(), makeNativeGoogleBinding: vi.fn() }))
vi.mock('../sync.js', () => ({ desktopSync: {} }))
vi.mock('../adapters/secureStorage.js', () => ({ secureStorageAdapter: {} }))
vi.mock('../adapters/picker.js', () => ({ pickerAdapter: {} }))

import { host, takeWaitingNavigation } from './host.js'

beforeEach(() => { takeWaitingNavigation() })

describe('host.navigate', () => {
  it('tells a shell that is already listening', () => {
    const heard = vi.fn()
    window.addEventListener('nexusmd:navigate', heard)
    host.navigate('git')
    window.removeEventListener('nexusmd:navigate', heard)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard.mock.calls[0][0].detail).toBe('git')
  })

  it('keeps a request made before the shell was there, for it to pick up once', () => {
    host.navigate('editor')   // e.g. a file the app was launched with, opened while the page loads
    expect(takeWaitingNavigation()).toBe('editor')
    expect(takeWaitingNavigation()).toBeNull()
  })

  it('keeps only the latest request', () => {
    host.navigate('git'); host.navigate('editor')
    expect(takeWaitingNavigation()).toBe('editor')
  })
})
