// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ignore, ignored, setActiveModule, getActiveModule, serializeError, sendEntry, rendererLog, reportRenderError, installRendererErrorHooks } from './log.js'

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

describe('a failed JSON.parse does not put the text it failed on into the log', () => {
  const quoted = () => { try { JSON.parse('secret torn') } catch (e) { return e } }

  it('the premise: the engine does quote the start of the text', () => {
    expect(quoted().message).toContain('secret')   // if a runtime stops doing this, the scrub below is just a no-op
  })

  it('serializeError drops it from the message and the stack, and keeps the rest', () => {
    const out = serializeError(quoted())
    expect(JSON.stringify(out)).not.toContain('secret')
    expect(out.name).toBe('SyntaxError')
    expect(out.message).toBe('not valid JSON (the text that failed to parse is not logged)')
    expect(out.stack).toContain('SyntaxError')
  })

  it('a message without quoted text is unchanged', () => {
    expect(serializeError(new Error('Unexpected end of JSON input')).message).toBe('Unexpected end of JSON input')
    expect(serializeError(new Error('disk full')).message).toBe('disk full')
  })

  it('what a logger sends carries none of it', () => {
    const send = vi.fn()
    window.electronAPI = { logging: { ingest: send } }
    rendererLog('core', 'profiles').warn('skipped a file', quoted(), { file: 'a.json' })
    ignore(rendererLog('core'), 'parsing a note', quoted(), 'warn')
    delete window.electronAPI
    expect(JSON.stringify(send.mock.calls)).not.toContain('secret')
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('ignore: the sanctioned way to swallow an error', () => {
  const fakeLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

  it('logs what was ignored and why, at debug unless told otherwise', () => {
    const log = fakeLog()
    const err = new Error('gone')
    ignore(log, 'removing a temp file', err)
    ignore(log, 'saving the draft', err, 'warn', { id: 7 })
    expect(log.debug).toHaveBeenCalledWith('ignored: removing a temp file', err, undefined)
    expect(log.warn).toHaveBeenCalledWith('ignored: saving the draft', err, { id: 7 })
  })

  it('keeps the detail when what was thrown is not an error', () => {
    const log = fakeLog()
    ignore(log, 'parsing', 'just text', 'warn', { file: 'a.json' })
    expect(log.warn).toHaveBeenCalledWith('ignored: parsing', { file: 'a.json', thrown: { name: 'NonError', message: 'just text' } })
  })

  it('works as a promise handler', async () => {
    const log = fakeLog()
    await Promise.reject(new Error('nope')).catch(ignored(log, 'a best-effort call', 'info'))
    expect(log.info).toHaveBeenCalledWith('ignored: a best-effort call', expect.any(Error), undefined)
  })

  it('never throws, even when the logger does', () => {
    const broken = { debug: () => { throw new Error('logger down') } }
    expect(() => ignore(broken, 'x', new Error('y'))).not.toThrow()
    expect(() => ignore(undefined, 'x', new Error('y'))).not.toThrow()
  })
})
