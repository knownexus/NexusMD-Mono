// "Pin to Home" through the booted app shell: a viewer asks, the shell saves the shortcut with the Home widgets and says so.
// Kept apart from app-render.test.jsx: each test boots a whole app that stays mounted (off screen) with its listeners, and the
// message check wants an app of its own, so the first test here is the only one that looks at the toast.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The pin listeners are recorded as the app adds them, so a test can tell when the app is listening.
const pinHandlers = []
const realAdd = window.addEventListener.bind(window)
window.addEventListener = (type, fn, ...rest) => { if (type === 'nexusmd:pin-shortcut') pinHandlers.push(fn); return realAdd(type, fn, ...rest) }

const seedProfile = () => {
  localStorage.setItem('helm.profiles', JSON.stringify([{ id: 'test', name: 'Test', initials: 'TE', color: '#6c8ebf', type: 'ado', createdAt: 1 }]))
  localStorage.setItem('helm.activeProfileId', 'test')
  localStorage.setItem('helm.account.optOut', '1')
}

describe('app shell: Pin to Home', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    seedProfile()
    document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'root' }))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    pinHandlers.length = 0
  })

  // The shell shows its navigation before the app behind it has mounted; a pin is only heard once the app has.
  const bootAndWaitForPins = async () => {
    await (await import('./main.jsx')).appReady
    await vi.waitFor(() => expect(pinHandlers.length).toBeGreaterThan(0), { timeout: 15000 })
    return (await import('@nexusmd/ui')).pinToHome
  }
  // The Home widgets as the shell saved them (the key carries the profile, so find it by what it holds).
  const savedWidgets = () => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!/tweaks/.test(key)) continue
      try { const w = JSON.parse(localStorage.getItem(key)).homeWidgets; if (Array.isArray(w) && w.length) return w } catch { /* not the tweaks */ }
    }
    return []
  }
  const gitFile = { target: 'git', kind: 'file', path: '/src/app.js', repo: { provider: 'github', name: 'nexus', fullName: 'knownexus/nexus' } }

  it('adds the shortcut to the Home widgets, once, and says so', async () => {
    const pinToHome = await bootAndWaitForPins()
    pinToHome(gitFile)
    await vi.waitFor(() => expect(document.body.textContent).toMatch(/Pinned to Home/), { timeout: 5000 })
    await vi.waitFor(() => expect(savedWidgets()).toHaveLength(1), { timeout: 5000 })
    expect(savedWidgets()[0]).toMatchObject({ type: 'link', config: { target: 'git', path: '/src/app.js' } })
    pinToHome(gitFile)
    await vi.waitFor(() => expect(document.body.textContent).toMatch(/Already on Home/), { timeout: 5000 })
    expect(savedWidgets()).toHaveLength(1)
  }, 40000)

  it('stamps an Editor path with the phone as the device that made it', async () => {
    // The first test's app is still mounted and also hears this pin, so only the widget this app saved is checked.
    const pinToHome = await bootAndWaitForPins()
    pinToHome({ target: 'editor', kind: 'file', path: '/editor/a.md', name: 'a.md' })
    await vi.waitFor(() => expect(savedWidgets()).toHaveLength(1), { timeout: 5000 })
    expect(savedWidgets()[0].config.platform).toBe('mobile')
  }, 40000)
})
