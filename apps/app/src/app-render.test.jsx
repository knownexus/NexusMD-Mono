// Smoke test: the app shell mounts and shows something. The white-screen bug was a ReferenceError on
// the first render, which unmounts the whole tree, so "root has content" is the check that matters.
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('app shell', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'root' }))
    // Nothing here should reach the network; a failed request must not take the render down.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  })

  it('renders its navigation instead of an empty page', async () => {
    const errors = []
    const onError = e => errors.push(e.error?.message || e.message)
    window.addEventListener('error', onError)

    await import('./main.jsx')

    const root = document.getElementById('root')
    await vi.waitFor(() => expect(root.children.length).toBeGreaterThan(0), { timeout: 15000 })
    // The bottom navigation is part of the shell on a phone-sized window.
    await vi.waitFor(() => expect(root.textContent).toMatch(/Home/), { timeout: 15000 })

    window.removeEventListener('error', onError)
    expect(errors.filter(m => /is not defined/.test(m || ''))).toEqual([])
  }, 30000)
})
