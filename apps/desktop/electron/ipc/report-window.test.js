// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import { pathToFileURL } from 'url'
import { createReportWindows } from './report-window.cjs'

function fakes({ loadRejects = false } = {}) {
  const wins = []
  class FakeWindow {
    constructor(opts) {
      this.opts = opts
      this.handlers = {}
      this.destroyed = false
      this.webContents = {
        setWindowOpenHandler: fn => { this.openHandler = fn },
        on: (ev, fn) => { this.handlers[ev] = fn },
      }
      this.loadFile = vi.fn(() => (loadRejects ? Promise.reject(new Error('ERR_ABORTED')) : Promise.resolve()))
      this.minimized = false
      this.isMinimized = () => this.minimized
      this.restore = vi.fn()
      this.reload = vi.fn()
      this.focus = vi.fn()
      this.on = (ev, fn) => { this.handlers[`win:${ev}`] = fn }
      wins.push(this)
    }
    isDestroyed() { return this.destroyed }
  }
  const shell = { openExternal: vi.fn(() => Promise.resolve()) }
  const ses = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }
  const session = { fromPartition: vi.fn(() => ses) }
  const log = vi.fn()
  return { wins, shell, ses, session, log, openReport: createReportWindows({ BrowserWindow: FakeWindow, shell, session, log }) }
}

const FILE = path.resolve('C:\\repos\\dev-environment\\.local\\test\\traces\\runs\\r1\\trace.html')

describe('report windows', () => {
  it('opens a sandboxed window with no preload and loads the file', () => {
    const { wins, openReport } = fakes()
    openReport(FILE)
    const prefs = wins[0].opts.webPreferences
    expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'devenv-reports' })
    expect(wins[0].loadFile).toHaveBeenCalledWith(FILE)
    expect(wins[0].opts.title).toBe('trace.html')
  })

  it('focuses and reloads the window when the same report opens again', () => {
    const { wins, openReport } = fakes()
    openReport(FILE)
    openReport(FILE.toUpperCase())
    expect(wins).toHaveLength(1)
    expect(wins[0].reload).toHaveBeenCalled()
    expect(wins[0].focus).toHaveBeenCalled()
  })

  it('opens a new window once the old one was closed', () => {
    const { wins, openReport } = fakes()
    openReport(FILE)
    wins[0].handlers['win:closed']()
    openReport(FILE)
    expect(wins).toHaveLength(2)
  })

  it('sends new-window links to the browser and denies everything', () => {
    const { wins, shell, openReport } = fakes()
    openReport(FILE)
    expect(wins[0].openHandler({ url: 'https://example.com/x' })).toEqual({ action: 'deny' })
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/x')
    expect(wins[0].openHandler({ url: 'file:///C:/Windows/x.html' })).toEqual({ action: 'deny' })
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('never navigates away from the report; anchors in it are fine', () => {
    const { wins, shell, openReport } = fakes()
    openReport(FILE)
    const nav = wins[0].handlers['will-navigate']
    const own = pathToFileURL(FILE).href
    const anchor = { preventDefault: vi.fn() }
    nav(anchor, `${own}#call-3`)
    expect(anchor.preventDefault).not.toHaveBeenCalled()
    const away = { preventDefault: vi.fn() }
    nav(away, 'https://example.com/')
    expect(away.preventDefault).toHaveBeenCalled()
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/')
    const file = { preventDefault: vi.fn() }
    nav(file, 'file:///C:/Windows/win.ini')
    expect(file.preventDefault).toHaveBeenCalled()
  })

  it('denies every permission but plain clipboard writes, installing the handlers once', () => {
    const { ses, session, openReport } = fakes()
    openReport(FILE)
    openReport(path.resolve('C:\\other\\trace.html'))
    expect(session.fromPartition).toHaveBeenCalledWith('devenv-reports')
    expect(ses.setPermissionRequestHandler).toHaveBeenCalledTimes(1)
    expect(ses.setPermissionCheckHandler).toHaveBeenCalledTimes(1)
    const ask = ses.setPermissionRequestHandler.mock.calls[0][0]
    const check = ses.setPermissionCheckHandler.mock.calls[0][0]
    for (const [perm, ok] of [['clipboard-sanitized-write', true], ['media', false], ['geolocation', false], ['notifications', false]]) {
      const cb = vi.fn()
      ask({}, perm, cb)
      expect(cb).toHaveBeenCalledWith(ok)
      expect(check({}, perm)).toBe(ok)
    }
  })

  it('restores a minimized report when it opens again', () => {
    const { wins, openReport } = fakes()
    openReport(FILE)
    wins[0].minimized = true
    openReport(FILE)
    expect(wins[0].restore).toHaveBeenCalled()
  })

  it('logs a failed load instead of leaving an unhandled rejection', async () => {
    const { log, openReport } = fakes({ loadRejects: true })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    openReport(FILE)
    await new Promise(r => setTimeout(r, 20))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
  })
})
