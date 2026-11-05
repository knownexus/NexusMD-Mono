// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActiveModule, getActiveModule, serializeError, sendEntry, rendererLog, reportRenderError, installRendererErrorHooks } from './log.js'

function fakeTarget() {
  const handlers = {}
  return {
    handlers,
    addEventListener: (type, fn) => { handlers[type] = fn },
    removeEventListener: (type) => { delete handlers[type] },
  }
}

describe('renderer logging', () => {
  beforeEach(() => setActiveModule('core'))

  it('serializes whatever was thrown', () => {
    expect(serializeError(new TypeError('bad'))).toMatchObject({ name: 'TypeError', message: 'bad' })
    expect(serializeError('just text')).toEqual({ name: 'NonError', message: 'just text' })
    expect(serializeError({ code: 7 })).toEqual({ name: 'NonError', message: '{"code":7}' })
    expect(serializeError(undefined).name).toBe('NonError')
  })

  it('reports that nothing was sent when there is nowhere to send', () => {
    expect(sendEntry({ msg: 'x' }, undefined)).toBe(false)
  })

  describe('without the desktop bridge (the web app, tests)', () => {
    afterEach(() => vi.restoreAllMocks())

    it('a logger call goes to the console, tagged with its module and scope', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const err = new Error('boom')
      rendererLog('git', 'diff').error('diff failed', err, { file: 'a.js' })
      rendererLog('work').warn('slow', { ms: 900 })
      expect(error).toHaveBeenCalledWith('[git:diff] diff failed', err, { file: 'a.js' })
      expect(warn).toHaveBeenCalledWith('[work] slow', { ms: 900 })
    })

    it('a render error goes to the console and reports it was not sent', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(reportRenderError(new Error('render blew up'), '\n  at Board', 'work')).toBe(false)
      expect(error).toHaveBeenCalled()
    })

    it('does not also print what it has sent to the hub', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      window.electronAPI = { logging: { ingest: vi.fn() } }
      rendererLog('git').error('sent')
      delete window.electronAPI
      expect(error).not.toHaveBeenCalled()
    })
  })

  it('treats an error-like object from another realm as an error', () => {
    const send = vi.fn()
    window.electronAPI = { logging: { ingest: send } }
    rendererLog('git').error('failed', { name: 'AbortError', message: 'aborted', stack: 's' })
    delete window.electronAPI
    expect(send.mock.calls[0][0]).toMatchObject({ err: { name: 'AbortError', message: 'aborted' } })
  })

  it('never throws into the caller when sending fails', () => {
    expect(sendEntry({ msg: 'x' }, () => { throw new Error('channel closed') })).toBe(false)
  })

  it('an app logger files entries under its own id with the error and data', () => {
    const send = vi.fn()
    window.electronAPI = { logging: { ingest: send } }
    const log = rendererLog('git').scope('diff')
    log.error('diff failed', new Error('boom'), { file: 'a.js' })
    log.info('opened', { n: 2 })
    delete window.electronAPI
    expect(send.mock.calls[0][0]).toMatchObject({ mod: 'git', lvl: 'error', scope: 'diff', msg: 'diff failed', err: { name: 'Error', message: 'boom' }, data: { file: 'a.js' } })
    expect(send.mock.calls[1][0]).toMatchObject({ mod: 'git', lvl: 'info', msg: 'opened', data: { n: 2 } })
  })

  it('files a render error under the screen that was showing', () => {
    const send = vi.fn()
    window.electronAPI = { logging: { ingest: send } }
    setActiveModule('work')
    reportRenderError(new Error('render blew up'), '\n  at Board')
    delete window.electronAPI
    expect(getActiveModule()).toBe('work')
    expect(send.mock.calls[0][0]).toMatchObject({ mod: 'work', lvl: 'error', scope: 'render', err: { message: 'render blew up' }, data: { componentStack: '\n  at Board' } })
  })

  it('logs an uncaught error against the active app and cancels the console print', () => {
    const send = vi.fn()
    const target = fakeTarget()
    setActiveModule('devenv')
    installRendererErrorHooks(target, send)
    const event = { message: 'x is not a function', error: new TypeError('x is not a function'), filename: 'app.js', lineno: 4, colno: 9, preventDefault: vi.fn() }
    target.handlers.error(event)
    expect(send.mock.calls[0][0]).toMatchObject({ mod: 'devenv', lvl: 'error', scope: 'window.onerror', err: { name: 'TypeError' }, data: { file: 'app.js', line: 4, col: 9 } })
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('logs an unhandled rejection, including a non-Error reason', () => {
    const send = vi.fn()
    const target = fakeTarget()
    installRendererErrorHooks(target, send)
    target.handlers.unhandledrejection({ reason: 'plain string', preventDefault: vi.fn() })
    expect(send.mock.calls[0][0]).toMatchObject({ mod: 'core', scope: 'unhandledrejection', msg: 'Unhandled promise rejection: plain string', err: { name: 'NonError' } })
  })

  it('leaves the event alone when the entry could not be sent', () => {
    const target = fakeTarget()
    installRendererErrorHooks(target, () => { throw new Error('closed') })
    const event = { message: 'm', error: new Error('m'), preventDefault: vi.fn() }
    target.handlers.error(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('installs nothing without a channel, and removes its hooks', () => {
    expect(installRendererErrorHooks(fakeTarget(), undefined)()).toBeUndefined()
    const target = fakeTarget()
    const off = installRendererErrorHooks(target, vi.fn())
    expect(Object.keys(target.handlers).sort()).toEqual(['error', 'unhandledrejection'])
    off()
    expect(target.handlers).toEqual({})
  })
})
