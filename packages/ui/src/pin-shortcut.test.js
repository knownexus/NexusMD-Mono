import { describe, it, expect, vi } from 'vitest'
import { pinToHome, listenForPins, PIN_EVENT } from './pin-shortcut.js'

const gitFile = { target: 'git', kind: 'file', path: '/src/app.js', repo: { provider: 'github', name: 'nexus', fullName: 'knownexus/nexus' } }

describe('pin to Home', () => {
  it('hands the host a widget for the pinned target', () => {
    const onPin = vi.fn()
    const off = listenForPins(onPin, 'desktop')
    expect(pinToHome(gitFile)).toBe(true)
    off()
    expect(onPin).toHaveBeenCalledTimes(1)
    expect(onPin.mock.calls[0][0]).toMatchObject({ type: 'link', config: { target: 'git', path: '/src/app.js' } })
    expect(onPin.mock.calls[0][0].id).toMatch(/^lk-/)
  })

  it('stamps an Editor path with the platform of the host that took it', () => {
    const seen = []
    const off = listenForPins(w => seen.push(w), 'mobile')
    pinToHome({ target: 'editor', kind: 'file', path: '/editor/a.md', name: 'a.md' })
    off()
    expect(seen[0].config.platform).toBe('mobile')
  })

  it('gives the same widget id for the same pin on the same host, so pinning twice replaces', () => {
    const ids = []
    const off = listenForPins(w => ids.push(w.id), 'desktop')
    pinToHome(gitFile)
    pinToHome({ ...gitFile })
    off()
    expect(ids[0]).toBe(ids[1])
  })

  it('does not stamp a document or git target', () => {
    const seen = []
    const off = listenForPins(w => seen.push(w), 'desktop')
    pinToHome({ target: 'doc', tool: 'json', docId: 'd', name: 'cfg' })
    off()
    expect(seen[0].config).not.toHaveProperty('platform')
  })

  it('refuses a target that is not usable, and says nothing to the host', () => {
    const onPin = vi.fn()
    const off = listenForPins(onPin, 'desktop')
    expect(pinToHome({ target: 'doc' })).toBe(false)
    expect(pinToHome(null)).toBe(false)
    off()
    expect(onPin).not.toHaveBeenCalled()
  })

  it('stops listening once unsubscribed, and ignores a malformed event', () => {
    const onPin = vi.fn()
    const off = listenForPins(onPin, 'desktop')
    window.dispatchEvent(new CustomEvent(PIN_EVENT, { detail: 'nonsense' }))
    window.dispatchEvent(new CustomEvent(PIN_EVENT))
    off()
    pinToHome(gitFile)
    expect(onPin).not.toHaveBeenCalled()
  })
})
