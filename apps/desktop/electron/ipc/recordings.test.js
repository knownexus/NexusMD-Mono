// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { register } = require('./recordings.cjs')
const { createRecorder, createTraceLink } = require('@nexusmd/main-kit/trace')

let dir, clock, runtime, recorder, link, ipc, dialog, windows, api
const fakeRuntime = () => ({ queue: [], onCap: null, start() {}, stop() {}, drain() { const q = this.queue; this.queue = []; return q } })
const fakeIpc = () => {
  const handlers = new Map(); const listeners = new Map()
  return { handlers, listeners, handle: (ch, fn) => handlers.set(ch, fn), on: (ch, fn) => { listeners.set(ch, fn) } }
}
const wc = (id) => ({ id, send: vi.fn(), isDestroyed: () => false })
const evt = (id = 1) => ({ sender: { id } })
const enter = (id, t, over = {}) => ({ k: 'enter', id, p: null, fn: 'x.js:1:0:f', a: [], t, proc: 'renderer', ...over })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nxt-ipc-'))
  clock = { t: 1_000_000 }
  runtime = fakeRuntime()
  recorder = createRecorder({ dir, now: () => clock.t, runtime, flushMs: 1e9, horizonMs: 0 })
  link = createTraceLink()
  ipc = fakeIpc()
  dialog = { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() }
  windows = [wc(1), wc(2)]
  api = register(ipc, { recorder, link, dialog, getWebContents: () => windows })
})
afterEach(async () => { try { await recorder.stop() } catch { /* not recording */ } rmSync(dir, { recursive: true, force: true }) })

const call = (ch, ...args) => ipc.handlers.get(ch)(evt(), ...args)

describe('recording IPC', () => {
  it('start, status, stop, list, read and remove go through the recorder', async () => {
    const { id } = await call('recording:start', 'merge test')
    expect(await call('recording:status')).toMatchObject({ recording: true, id })
    clock.t = 1_000_100
    ipc.listeners.get('trace:push')(evt(1), [enter('r1-1', 1_000_050)])
    const info = await call('recording:stop')
    expect(info).toMatchObject({ id, status: 'finished', events: 1, label: 'merge test' })
    expect((await call('recording:list')).map(i => i.id)).toEqual([id])
    expect((await call('recording:read', id)).events.map(e => e.id)).toEqual(['r1-1'])
    await call('recording:remove', id)
    expect(await call('recording:list')).toEqual([])
  })

  it('a second start rejects with a clear message', async () => {
    await call('recording:start')
    await expect(call('recording:start')).rejects.toThrow(/already running/)
  })

  it('stopping when nothing is recording rejects with a clear message', async () => {
    await expect(call('recording:stop')).rejects.toThrow(/not recording/i)
  })

  it('state changes are sent to every window, each with its own window id', async () => {
    const { id } = await call('recording:start')
    expect(windows[0].send).toHaveBeenLastCalledWith('trace:state', expect.objectContaining({ recording: true, id, win: 1 }))
    expect(windows[1].send).toHaveBeenLastCalledWith('trace:state', expect.objectContaining({ recording: true, win: 2 }))
    await call('recording:stop')
    expect(windows[0].send).toHaveBeenLastCalledWith('trace:state', { recording: false, win: 1 })
  })

  it('a window opened mid-recording is told, and one opened when idle is told it is not recording', async () => {
    const idle = wc(7)
    api.sendStateTo(idle)
    expect(idle.send).toHaveBeenLastCalledWith('trace:state', { recording: false, win: 7 })
    const { id } = await call('recording:start')
    const late = wc(8)
    api.sendStateTo(late)
    expect(late.send).toHaveBeenLastCalledWith('trace:state', expect.objectContaining({ recording: true, id, win: 8 }))
  })

  it('does not send to a window that has been destroyed', async () => {
    windows[1].isDestroyed = () => true
    await call('recording:start')
    expect(windows[1].send).not.toHaveBeenCalled()
  })

  it('events pushed by a window are added with that window\'s id', async () => {
    const { id } = await call('recording:start')
    clock.t = 1_000_100
    ipc.listeners.get('trace:push')(evt(5), [enter('r5-1', 1_000_050)])
    await call('recording:stop')
    const written = readFileSync(join(dir, `${id}.nxrec`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).find(e => e.k === 'enter')
    expect(written).toMatchObject({ id: 'r5-1', win: 5 })
  })

  it('a push when not recording is ignored, and a push of something that is not a list does no harm', async () => {
    expect(() => ipc.listeners.get('trace:push')(evt(1), [enter('r1-1', 1)])).not.toThrow()
    await call('recording:start')
    expect(() => ipc.listeners.get('trace:push')(evt(1), 'nonsense')).not.toThrow()
  })

  it('a note about which window call is about to make an IPC call is kept while recording, and ignored otherwise', async () => {
    ipc.listeners.get('trace:ctx')(evt(1), { callId: 'r1-1', channel: 'git:push' })
    expect(link.take(1, 'git:push')).toBeNull()
    await call('recording:start')
    ipc.listeners.get('trace:ctx')(evt(1), { callId: 'r1-1', channel: 'git:push' })
    expect(link.take(1, 'git:push')).toBe('r1-1')
    ipc.listeners.get('trace:ctx')(evt(1), null)       // a malformed note does no harm
    ipc.listeners.get('trace:ctx')(evt(1), { callId: 5, channel: {} })
  })

  it('what was noted is forgotten when the recording stops', async () => {
    await call('recording:start')
    ipc.listeners.get('trace:ctx')(evt(1), { callId: 'r1-1', channel: 'git:push' })
    await call('recording:stop')
    expect(link.take(1, 'git:push')).toBeNull()
  })

  it('export asks where to save and writes the recording unchanged; cancelling saves nothing', async () => {
    const { id } = await call('recording:start')
    await call('recording:stop')
    const out = join(dir, 'exported.nxrec')
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: out })
    expect(await call('recording:export', id)).toEqual({ saved: true, file: out })
    expect(readFileSync(out)).toEqual(readFileSync(join(dir, `${id}.nxrec`)))
    expect(dialog.showSaveDialog.mock.calls[0][0].defaultPath).toBe(`${id}.nxrec`)
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true })
    expect(await call('recording:export', id)).toEqual({ saved: false })
  })

  it('import asks for a file and lists what it holds; cancelling returns null; a file that is not a recording rejects', async () => {
    const { id } = await call('recording:start')
    await call('recording:stop')
    const copy = join(dir, 'copy.nxrec')
    writeFileSync(copy, readFileSync(join(dir, `${id}.nxrec`)))
    await call('recording:remove', id)
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [copy] })
    expect(await call('recording:import')).toMatchObject({ id, status: 'finished' })
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await call('recording:import')).toBeNull()
    const junk = join(dir, 'junk.txt'); writeFileSync(junk, 'hello')
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [junk] })
    await expect(call('recording:import')).rejects.toThrow(/not a NexusMD recording/)
  })

  it('an id that could leave the recordings folder is refused', async () => {
    await expect(call('recording:read', '../../secret')).rejects.toThrow(/not a recording id/)
    await expect(call('recording:export', '..\\x')).rejects.toThrow(/not a recording id/)
  })
})
