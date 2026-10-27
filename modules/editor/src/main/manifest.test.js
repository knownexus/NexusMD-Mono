// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import manifest from '../../app.manifest.json'
import { validateManifest } from '@nexusmd/shell-sdk'

const require = createRequire(import.meta.url)
const { register } = require('./index.cjs')

function registerWith(ctx = {}) {
  const handlers = {}
  const handle = register({
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn } },
    send: vi.fn(),
    log: { scope: () => ({ error: vi.fn() }) },
    ...ctx,
  })
  return { handlers, handle }
}

const methods = () => Object.values(manifest.ipc.preload).flatMap(ns => Object.values(ns))

describe('editor app manifest', () => {
  it('is a valid app manifest', () => {
    expect(validateManifest(manifest)).toEqual([])
    expect(manifest.id).toBe('editor')
  })
  it('has an invoke handler for every invoke channel it exposes, and no unexposed editor:* ones', () => {
    const { handlers } = registerWith()
    const exposed = methods().filter(m => m.invoke).map(m => m.invoke)
    expect(exposed.filter(c => !handlers[c])).toEqual([])
    expect(Object.keys(handlers).filter(c => c.startsWith('editor:') && !exposed.includes(c))).toEqual([])
  })
})

describe('files opened with the app', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-editor-argv-'))
  const file = path.join(dir, 'a.txt')
  fs.writeFileSync(file, 'x')

  it('waits for the window to ask for what the app was launched with, once', async () => {
    const { handlers } = registerWith({ argv: ['NexusMD.exe', '--flag', file, path.join(dir, 'missing.txt')] })
    expect(await handlers['editor:take-pending']()).toEqual([file])
    expect(await handlers['editor:take-pending']()).toEqual([])
  })

  it('ignores the app folder an unpackaged run is started with (electron . file)', async () => {
    const { handlers } = registerWith({ defaultApp: true, argv: ['electron.exe', dir, file] })
    expect(await handlers['editor:take-pending']()).toEqual([file])
    let listener
    const send = vi.fn()
    registerWith({ defaultApp: true, send, argv: ['electron.exe', dir], onSecondInstance: fn => { listener = fn; return () => {} } })
    listener(['electron.exe', dir])
    expect(send).not.toHaveBeenCalled()
    listener(['electron.exe', dir, file])
    expect(send).toHaveBeenCalledWith('editor:open-request', [file])
  })

  it('pushes files from a later launch straight to the window', () => {
    let listener
    const send = vi.fn()
    registerWith({ send, argv: ['NexusMD.exe'], onSecondInstance: fn => { listener = fn; return () => {} } })
    listener(['NexusMD.exe', file])
    expect(send).toHaveBeenCalledWith('editor:open-request', [file])
    send.mockClear()
    listener(['NexusMD.exe', '--only-a-flag'])
    expect(send).not.toHaveBeenCalled()
  })

  it('stops listening for later launches when the app shuts down', () => {
    const off = vi.fn()
    const { handle } = registerWith({ onSecondInstance: () => off })
    handle.dispose()
    expect(off).toHaveBeenCalled()
  })

  it('reads, saves and lists through its handlers', async () => {
    const { handlers } = registerWith()
    const r = await handlers['editor:read'](null, file)
    expect(r.text).toBe('x')
    expect((await handlers['editor:write'](null, file, 'y', { expectedStamp: r.stamp })).ok).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toBe('y')
    expect((await handlers['editor:list'](null, dir)).entries.map(e => e.name)).toEqual(['a.txt'])
    expect(await handlers['editor:stat'](null, file)).toMatchObject({ exists: true, kind: 'file' })
  })
})
