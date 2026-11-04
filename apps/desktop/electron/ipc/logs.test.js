// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import Module from 'module'
import path from 'path'
import os from 'os'
import fs from 'fs'

const origRequire = Module.prototype.require
let register
let userData

beforeAll(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-ipc-'))
  const fakeElectron = { app: { getPath: () => userData } }
  Module.prototype.require = function (id) {
    if (id === 'electron') return fakeElectron
    return origRequire.apply(this, arguments)
  }
  ;({ register } = origRequire.call(module, path.join(__dirname, 'logs.cjs')))
})

afterAll(() => {
  Module.prototype.require = origRequire
  fs.rmSync(userData, { recursive: true, force: true })
})

function fakeIpc() {
  const on = {}
  const h = {}
  return { ipcMain: { handle: (c, fn) => { h[c] = fn }, on: (c, fn) => { on[c] = fn } }, on, h }
}

// A webContents stand-in that records what is pushed to it.
function fakeWebContents(id = 1) {
  const sent = []
  const listeners = {}
  return { id, sent, send: (ch, payload) => sent.push([ch, payload]), isDestroyed: () => !!listeners.gone, once: (ev, fn) => { listeners[ev] = fn }, listeners }
}

describe('logs ipc: renderer ingest', () => {
  it('hands a renderer entry to the hub, tagged with the window it came from', () => {
    const { ipcMain, on } = fakeIpc()
    const hub = { ingest: vi.fn() }
    register(ipcMain, { hub })
    const entry = { mod: 'git', lvl: 'error', msg: 'diff failed' }
    on['log:ingest']({ sender: { id: 7 } }, entry)
    expect(hub.ingest).toHaveBeenCalledWith(entry, { sender: 'window-7', win: 7 })
  })

  it('has no ingest channel without a hub', () => {
    const { ipcMain, on } = fakeIpc()
    register(ipcMain)
    expect(on['log:ingest']).toBeUndefined()
  })
})

describe('logs ipc: per-module logs and live tail', () => {
  const makeHub = () => {
    const subs = new Set()
    return { ingest: vi.fn(), flush: vi.fn(), recent: () => [{ msg: 'earlier' }], subscribe: fn => { subs.add(fn); return () => subs.delete(fn) }, emit: e => subs.forEach(fn => fn(e)), subs }
  }

  it('answers module, query and follow requests, flushing the hub first', async () => {
    const { ipcMain, h } = fakeIpc()
    const hub = makeHub()
    register(ipcMain, { hub })
    expect(await h['logs:modules']()).toEqual([])
    expect(hub.flush).toHaveBeenCalled()
    expect((await h['logs:query'](null, { date: '2026-01-01' })).entries).toEqual([])
    expect(await h['logs:query'](null, 'not an object')).toMatchObject({ entries: expect.any(Array) })
    expect((await h['logs:follow'](null, 'c-nope1234')).entries).toEqual([])
  })

  it('opens the tail with the recent entries, then pushes new ones in one batch', async () => {
    vi.useFakeTimers()
    try {
      const { ipcMain, h } = fakeIpc()
      const hub = makeHub()
      register(ipcMain, { hub })
      const wc = fakeWebContents()
      expect(await h['logs:tail-start']({ sender: wc })).toEqual([{ msg: 'earlier' }])
      hub.emit({ msg: 'a' }); hub.emit({ msg: 'b' })
      expect(wc.sent).toEqual([])
      vi.advanceTimersByTime(150)
      expect(wc.sent).toEqual([['logs:entries', [{ msg: 'a' }, { msg: 'b' }]]])
    } finally { vi.useRealTimers() }
  })

  it('stops pushing after tail-stop, and when the window goes away', async () => {
    vi.useFakeTimers()
    try {
      const { ipcMain, h } = fakeIpc()
      const hub = makeHub()
      register(ipcMain, { hub })
      const wc = fakeWebContents()
      await h['logs:tail-start']({ sender: wc })
      await h['logs:tail-stop']({ sender: wc })
      expect(hub.subs.size).toBe(0)

      await h['logs:tail-start']({ sender: wc })
      await h['logs:tail-start']({ sender: wc })      // starting again does not stack subscriptions
      expect(hub.subs.size).toBe(1)
      wc.listeners.destroyed()
      expect(hub.subs.size).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
