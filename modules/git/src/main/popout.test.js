// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'module'

const { createPopouts, validateSpec } = createRequire(import.meta.url)('./popout.cjs')

const spec = (extra = {}) => ({
  kind: 'editor', repo: { name: 'A', path: 'C:/repos/A' }, worktree: 'C:/repos/A', path: 'src/app.jsx', registered: ['C:/repos/A'], ...extra,
})

function setup() {
  const windows = []
  class FakeWindow {
    constructor(options) {
      this.options = options
      this.handlers = {}
      this.destroyed = false
      this.minimized = false
      this.focus = vi.fn()
      this.restore = vi.fn(() => { this.minimized = false })
      this.show = vi.fn()
      this.removeMenu = vi.fn()
      this.webContents = { on: vi.fn((e, fn) => { this.handlers[e] = fn }), setWindowOpenHandler: vi.fn(), send: vi.fn() }
      windows.push(this)
    }
    on(e, fn) { this.handlers[e] = fn }
    once(e, fn) { this.handlers[e] = fn }
    isDestroyed() { return this.destroyed }
    isMinimized() { return this.minimized }
    close() { this.destroyed = true; this.handlers.closed?.() }
    static getAllWindows() { return windows.filter(w => !w.destroyed) }
  }
  const dialog = { showMessageBoxSync: vi.fn(() => 1) }
  const load = vi.fn()
  const popouts = createPopouts({ BrowserWindow: FakeWindow, dialog, preload: 'preload.cjs', icon: 'icon.png', load })
  return { popouts, windows, dialog, load }
}

describe('validateSpec', () => {
  it('keeps only the known fields', () => {
    expect(validateSpec({ ...spec(), extra: 1, repo: { name: 'A', path: 'C:/repos/A', junk: 1 } })).toEqual(spec())
  })
  it('refuses anything malformed', () => {
    for (const bad of [null, 'x', spec({ kind: 'shell' }), spec({ repo: null }), spec({ worktree: '' }), spec({ path: 3 }),
      spec({ registered: 'C:/repos/A' }), spec({ registered: [1] }), spec({ kind: 'diff' }), spec({ path: 'a\0b' })]) {
      expect(() => validateSpec(bad)).toThrow(/Can't open that window/)
    }
  })
  it('needs a change id for a diff and keeps it, NUL separator included', () => {
    expect(validateSpec(spec({ kind: 'diff', changeId: 'unstaged:src/app.jsx' })).changeId).toBe('unstaged:src/app.jsx')
    expect(validateSpec(spec({ kind: 'diff', changeId: 'unstaged\0src/app.jsx' })).changeId).toBe('unstaged\0src/app.jsx')
  })
  it('keeps the change a diff carries, with only its status fields', () => {
    const change = { id: 'unstaged\0src/app.jsx', area: 'unstaged', path: 'src/app.jsx', originalPath: 'src/old.jsx', xy: '.R', sub: 'N...' }
    expect(validateSpec(spec({ kind: 'diff', changeId: change.id, change: { ...change, junk: 1 } })).change).toEqual(change)
    expect(validateSpec(spec({ kind: 'diff', changeId: 'u', change: { id: 'u', area: 'untracked', path: 'a.txt' } })).change).toEqual({ id: 'u', area: 'untracked', path: 'a.txt' })
    expect(validateSpec(spec({ kind: 'diff', changeId: 'u' }))).not.toHaveProperty('change')
  })
  it('refuses a change that is not the one the id names, or is malformed', () => {
    const ok = { id: 'u', area: 'unstaged', path: 'a.txt' }
    for (const change of ['x', { ...ok, id: 'other' }, { ...ok, area: 'nowhere' }, { ...ok, path: '' }, { ...ok, path: 'a\0b' }, { ...ok, originalPath: 3 }, { ...ok, xy: '' }]) {
      expect(() => validateSpec(spec({ kind: 'diff', changeId: 'u', change }))).toThrow(/Can't open that window/)
    }
  })
})

describe('createPopouts', () => {
  it('opens a window titled for what it shows, loading the request in the hash', () => {
    const { popouts, windows, load } = setup()
    expect(popouts.open(spec())).toEqual({ reused: false })
    expect(windows[0].options).toMatchObject({ title: 'Edit app.jsx', show: false, webPreferences: { preload: 'preload.cjs', contextIsolation: true, nodeIntegration: false, sandbox: true } })
    const [win, hash] = load.mock.calls[0]
    expect(win).toBe(windows[0])
    expect(JSON.parse(decodeURIComponent(hash.replace('popout=', '')))).toEqual(spec())
    windows[0].handlers['ready-to-show']()
    expect(windows[0].show).toHaveBeenCalled()
  })

  it('focuses the window already showing the same item, restoring it if minimised', () => {
    const { popouts, windows } = setup()
    popouts.open(spec())
    windows[0].minimized = true
    expect(popouts.open(spec())).toEqual({ reused: true })
    expect(windows).toHaveLength(1)
    expect(windows[0].restore).toHaveBeenCalled()
    expect(windows[0].focus).toHaveBeenCalled()
  })

  it('treats another file, kind or change as another window, and reopens after closing', () => {
    const { popouts, windows } = setup()
    popouts.open(spec())
    popouts.open(spec({ path: 'other.js' }))
    popouts.open(spec({ kind: 'conflict' }))
    popouts.open(spec({ kind: 'diff', changeId: 'a' }))
    popouts.open(spec({ kind: 'diff', changeId: 'b' }))
    expect(windows).toHaveLength(5)
    windows[0].close()
    expect(popouts.count()).toBe(4)
    popouts.open(spec())
    expect(windows).toHaveLength(6)
  })

  it('locks the page down and asks before discarding unsaved edits', () => {
    const { popouts, windows, dialog } = setup()
    popouts.open(spec())
    const w = windows[0]
    const nav = { preventDefault: vi.fn() }
    w.webContents.on.mock.calls.find(([e]) => e === 'will-navigate')[1](nav)
    expect(nav.preventDefault).toHaveBeenCalled()
    expect(w.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' })

    const unload = { preventDefault: vi.fn() }
    dialog.showMessageBoxSync.mockReturnValueOnce(1)
    w.handlers['will-prevent-unload'](unload)
    expect(unload.preventDefault).not.toHaveBeenCalled()
    dialog.showMessageBoxSync.mockReturnValueOnce(0)
    w.handlers['will-prevent-unload'](unload)
    expect(unload.preventDefault).toHaveBeenCalled()
  })

  it('tells every other window, not the sender, that a repository changed', () => {
    const { popouts, windows } = setup()
    popouts.open(spec())
    popouts.open(spec({ path: 'b.js' }))
    popouts.changed(windows[0].webContents, 'C:/repos/A')
    expect(windows[0].webContents.send).not.toHaveBeenCalled()
    expect(windows[1].webContents.send).toHaveBeenCalledWith('popout:changed', 'C:/repos/A')
    popouts.changed(windows[0].webContents, '')
    expect(windows[1].webContents.send).toHaveBeenCalledTimes(1)
  })
})
