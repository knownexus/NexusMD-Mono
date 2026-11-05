// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const { spyRendererConsole, levelOf } = createRequire(import.meta.url)('./renderer-console.cjs')

const setup = (existing = []) => {
  const app = new EventEmitter()
  const log = { processMessage: vi.fn() }
  const wcs = existing
  spyRendererConsole({ app, log, getAllWebContents: () => wcs })
  return { app, log }
}
// Electron 43 hands console-message listeners ONE event object; the old (event, level, message, ...) arguments
// are deprecated and print a warning each time a listener is attached.
const consoleEvent = (level, message) => ({ level, message, lineNumber: 1, sourceId: 'x.js', frame: {} })

describe('spyRendererConsole', () => {
  it('forwards a window\'s console message to the log as a renderer message, at its level', () => {
    const { app, log } = setup()
    const wc = new EventEmitter(); app.emit('web-contents-created', {}, wc)
    wc.emit('console-message', consoleEvent('warning', 'careful'))
    wc.emit('console-message', consoleEvent('error', 'bad'))
    expect(log.processMessage.mock.calls.map(c => c[0])).toEqual([
      { data: ['careful'], level: 'warn', variables: { processType: 'renderer' } },
      { data: ['bad'], level: 'error', variables: { processType: 'renderer' } },
    ])
  })

  it('also listens on windows that already exist', () => {
    const wc = new EventEmitter()
    const { log } = setup([wc])
    wc.emit('console-message', consoleEvent('info', 'hello'))
    expect(log.processMessage).toHaveBeenCalledWith({ data: ['hello'], level: 'info', variables: { processType: 'renderer' } })
  })

  it('listens with the one-argument form, so Electron prints no deprecation warning', () => {
    const { app } = setup()
    const wc = new EventEmitter(); app.emit('web-contents-created', {}, wc)
    const [listener] = wc.listeners('console-message')
    expect(listener.length).toBe(1)
  })

  it('does not attach twice to the same window', () => {
    const wc = new EventEmitter()
    const { app } = setup([wc])
    app.emit('web-contents-created', {}, wc)
    expect(wc.listenerCount('console-message')).toBe(1)
  })

  it('maps Electron levels to log levels, and an unknown one to info', () => {
    expect(['debug', 'info', 'warning', 'error', 'verbose', undefined].map(levelOf)).toEqual(['debug', 'info', 'warn', 'error', 'info', 'info'])
  })
})
