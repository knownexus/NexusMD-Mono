// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createProcessWatch, moduleOfStack, placeOf } = require('./process-watch.cjs')
const { runWithCorrelation } = require('@nexusmd/main-kit/logging')

// Records what each module's logger was asked to log: { mod, level, args }.
function fakeHub() {
  const entries = []
  const make = mod => Object.fromEntries(['error', 'warn', 'info', 'debug'].map(level => [level, (...args) => entries.push({ mod, level, args })]))
  return { entries, flush: vi.fn(), logger: make2(make) }
}
function make2(make) { const cache = {}; return mod => (cache[mod] ??= make(mod)) }

let app, proc, hub, dialog, owners, watch
beforeEach(() => {
  app = new EventEmitter()
  proc = new EventEmitter()
  hub = fakeHub()
  dialog = { showErrorBox: vi.fn() }
  owners = new Map()
  watch = createProcessWatch({ app, proc, hub, dialog, ownerOf: wc => owners.get(wc) ?? null })
})

const newWindow = (id = 1) => {
  const wc = Object.assign(new EventEmitter(), { id })
  app.emit('web-contents-created', {}, wc)
  return wc
}

describe('which module a failure belongs to', () => {
  it('reads it from the first frame inside a module, in both layouts', () => {
    expect(moduleOfStack('Error: x\n    at fn (node:internal/x:1:1)\n    at run (C:\\repos\\NexusMD-Mono\\master\\modules\\git\\src\\main\\git.cjs:10:5)')).toBe('git')
    expect(moduleOfStack('Error\n    at C:\\Users\\a\\AppData\\Local\\Programs\\NexusMD\\resources\\apps\\api-client\\main\\index.cjs:91:21')).toBe('api-client')
    expect(moduleOfStack('Error\n    at x (C:\\repos\\NexusMD-Mono\\master\\apps\\desktop\\electron\\main.cjs:1:1)')).toBeNull()
    expect(moduleOfStack(undefined)).toBeNull()
  })

  it('shows a page without its query or fragment', () => {
    expect(placeOf('https://dev.azure.com/org/_workitems/edit/5?token=abc#frag')).toBe('https://dev.azure.com/org/_workitems/edit/5')
    expect(placeOf('not a url?x=1')).toBe('not a url')
  })
})

describe('uncaught exceptions and rejections', () => {
  it('logs an uncaught exception under the module in its stack, flushes, and shows the dialog', () => {
    const err = new Error('boom')
    err.stack = 'Error: boom\n    at x (C:\\r\\modules\\database\\src\\main\\db-manager.cjs:1:1)'
    proc.emit('uncaughtException', err, 'uncaughtException')
    expect(hub.entries).toEqual([{ mod: 'database', level: 'error', args: ['uncaught exception', err] }])
    expect(hub.flush).toHaveBeenCalled()
    expect(dialog.showErrorBox).toHaveBeenCalledWith('A JavaScript error occurred in the main process', expect.stringContaining('boom'))
  })

  it('prefers the module of the call chain, and falls back to core', async () => {
    await runWithCorrelation(async () => { proc.emit('uncaughtException', new Error('from a handler')) }, { mod: 'devenv' })
    proc.emit('uncaughtException', new Error('from nowhere'))
    expect(hub.entries.map(e => e.mod)).toEqual(['devenv', 'core'])
  })

  it('logs an unhandled rejection, with no dialog, even when the reason is not an Error', () => {
    proc.emit('unhandledRejection', 'plain text')
    proc.emit('unhandledRejection', { code: 42 })
    expect(hub.entries.map(e => [e.level, e.args[0], e.args[1].message])).toEqual([
      ['error', 'unhandled promise rejection', 'plain text'],
      ['error', 'unhandled promise rejection', '{"code":42}'],
    ])
    expect(dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('logs a process warning', () => {
    proc.emit('warning', Object.assign(new Error('Possible EventEmitter memory leak'), { name: 'MaxListenersExceededWarning' }))
    expect(hub.entries[0]).toMatchObject({ mod: 'core', level: 'warn', args: ['process warning: MaxListenersExceededWarning: Possible EventEmitter memory leak', expect.anything()] })
  })

  it('does not let a failing dialog hide the exception', () => {
    dialog.showErrorBox.mockImplementation(() => { throw new Error('no dialog') })
    expect(() => proc.emit('uncaughtException', new Error('x'))).not.toThrow()
    expect(hub.entries.map(e => e.level)).toEqual(['error', 'warn'])
  })
})

describe('windows', () => {
  it('logs a crashed renderer under the app that owns the window', () => {
    const wc = newWindow(7)
    owners.set(wc, 'git')
    wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 139 })
    expect(hub.entries[0]).toEqual({ mod: 'git', level: 'error', args: ['renderer process gone: crashed', { reason: 'crashed', exitCode: 139, webContents: 7 }] })
  })

  it('treats a clean exit as information and a window nobody owns as core', () => {
    const wc = newWindow()
    wc.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 })
    expect(hub.entries[0]).toMatchObject({ mod: 'core', level: 'info' })
  })

  it('logs a window that stops responding, and recovers', () => {
    const wc = newWindow()
    wc.emit('unresponsive')
    wc.emit('responsive')
    expect(hub.entries.map(e => [e.level, e.args[0]])).toEqual([['warn', 'window is not responding'], ['info', 'window is responding again']])
  })

  it('logs a failed page load by how much it matters, without the query string', () => {
    const wc = newWindow()
    wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://x.test/a?token=secret', true)
    wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://x.test/frame', false)
    wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://x.test/b', true)
    expect(hub.entries.map(e => e.level)).toEqual(['error', 'warn', 'debug'])
    expect(hub.entries[0].args[1]).toMatchObject({ url: 'https://x.test/a', mainFrame: true })
    expect(JSON.stringify(hub.entries)).not.toContain('secret')
  })

  it('logs a preload script that failed', () => {
    const wc = newWindow()
    wc.emit('preload-error', {}, 'C:\\app\\preload.cjs', new Error('bad preload'))
    expect(hub.entries[0]).toMatchObject({ level: 'error', args: ['preload script failed', expect.objectContaining({ message: 'bad preload' }), expect.anything()] })
  })
})

describe('child processes and cleanup', () => {
  it('logs a GPU or utility process that died', () => {
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1 })
    app.emit('child-process-gone', {}, { type: 'Utility', reason: 'clean-exit', exitCode: 0 })
    expect(hub.entries.map(e => [e.mod, e.level, e.args[0]])).toEqual([['core', 'error', 'GPU process gone: crashed'], ['core', 'info', 'Utility process gone: clean-exit']])
  })

  it('stops listening when disposed', () => {
    watch.dispose()
    proc.emit('unhandledRejection', new Error('x'))
    const wc = new EventEmitter()
    app.emit('web-contents-created', {}, wc)
    expect(hub.entries).toEqual([])
    expect(proc.listenerCount('unhandledRejection')).toBe(0)
  })
})
