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
  return { ipcMain: { handle: vi.fn(), on: (c, fn) => { on[c] = fn } }, on }
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
