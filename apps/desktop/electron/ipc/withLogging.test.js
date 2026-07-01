// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withLogging } from './withLogging.cjs'

// Inject a fake logger rather than mocking the electron-log module: vi.mock
// does not intercept the CJS require('electron-log') inside withLogging.cjs.
let errorSpy
let scopedFor
let fakeLog

beforeEach(() => {
  errorSpy = vi.fn()
  scopedFor = null
  fakeLog = { scope: (ch) => { scopedFor = ch; return { error: errorSpy } } }
})

describe('withLogging', () => {
  it('registers the handler on ipcMain and returns its value', async () => {
    const handlers = {}
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn } }
    withLogging(ipcMain, fakeLog)('x:ok', async () => 42)
    expect(await handlers['x:ok']()).toBe(42)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('logs under the channel scope and rethrows when the handler rejects', async () => {
    const handlers = {}
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn } }
    const boom = new Error('boom')
    withLogging(ipcMain, fakeLog)('x:fail', async () => { throw boom })
    await expect(handlers['x:fail']()).rejects.toThrow('boom')
    expect(errorSpy).toHaveBeenCalledWith(boom)
    expect(scopedFor).toBe('x:fail')
  })
})
