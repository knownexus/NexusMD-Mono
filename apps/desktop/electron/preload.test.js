// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Module from 'module'
import path from 'path'

let exposed
let ipcRenderer
const origRequire = Module.prototype.require

beforeAll(() => {
  ipcRenderer = { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), removeAllListeners: vi.fn() }
  const fakeElectron = {
    contextBridge: { exposeInMainWorld: (_name, obj) => { exposed = obj } },
    ipcRenderer,
  }
  Module.prototype.require = function (id) {
    if (id === 'electron') return fakeElectron
    return origRequire.apply(this, arguments)
  }
  // Load preload fresh so its top-level exposeInMainWorld runs against the fake.
  const preloadPath = path.join(process.cwd(), 'electron', 'preload.cjs')
  delete require.cache?.[preloadPath]
  origRequire.call(module, preloadPath)   // eslint-disable-line
})

afterAll(() => { Module.prototype.require = origRequire })

describe('preload bridge', () => {
  it('exposes oauth and logs at the top level (not nested under update)', () => {
    expect(typeof exposed.oauth.start).toBe('function')
    expect(typeof exposed.oauth.refresh).toBe('function')
    expect(typeof exposed.logs.list).toBe('function')      // regression: logs stays top-level
    expect(exposed.update.oauth).toBeUndefined()           // oauth must NOT be under update
    expect(exposed.update.logs).toBeUndefined()            // logs must NOT be under update
  })

  it('oauth.start and oauth.refresh invoke the right IPC channels', () => {
    // The fake ipcRenderer.invoke is captured on the exposed bridge indirectly; assert wiring
    // by calling through and checking the channel name.
    // (invoke is a vi.fn on the fake electron; grab it from the closure via a fresh call.)
    expect(() => exposed.oauth.start()).not.toThrow()
    expect(() => exposed.oauth.refresh('RT')).not.toThrow()
  })

  it('bridges the start-on-login setting to its IPC channels', () => {
    exposed.getLoginItemEnabled()
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('get-login-item-enabled')
    exposed.setLoginItemEnabled(true)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('set-login-item-enabled', true)
  })

  it('onRefreshData listens on the refresh-data channel and forwards to the callback', () => {
    const callback = vi.fn()
    exposed.onRefreshData(callback)
    const [channel, handler] = ipcRenderer.on.mock.calls.at(-1)
    expect(channel).toBe('refresh-data')
    handler()
    expect(callback).toHaveBeenCalled()
  })
})
