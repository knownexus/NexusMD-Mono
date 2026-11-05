// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { createRecorder } = require('./recorder.cjs')
const { createStore } = require('./store.cjs')

let dir, clock, runtime, rec
// The main process's own runtime, stood in for: it has what the recorder calls.
const fakeRuntime = () => ({ started: null, stopped: 0, queue: [], onCap: null, start(o) { this.started = o }, stop() { this.stopped++ }, drain() { const q = this.queue; this.queue = []; return q } })
const enter = (id, t, over = {}) => ({ k: 'enter', id, p: null, fn: 'x.js:1:0:f', a: [], t, proc: 'main', ...over })
const lines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const fileOf = (id) => join(dir, `${id}.nxrec`)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nxt-rec-'))
  clock = { t: 1_000_000 }
  runtime = fakeRuntime()
  rec = createRecorder({ dir, now: () => clock.t, runtime, flushMs: 1e9, horizonMs: 1500 })
})
afterEach(async () => { try { await rec.stop() } catch { /* not recording */ } rmSync(dir, { recursive: true, force: true }) })

describe('a recording', () => {
  it('start then stop writes a header, the events in time order across two sources, and an end line', async () => {
    const { id } = rec.start('merge test')
    clock.t = 1_000_100   // events are stamped between the start of the recording and now
    runtime.queue.push(enter('m1-2', 1_000_050), enter('m1-1', 1_000_010))
    // a window's batch arrives later but holds an earlier event
    rec.add([enter('r1-1', 1_000_020, { proc: 'renderer', win: 1 })], { win: 1 })
    const info = await rec.stop()
    const all = lines(fileOf(id))
    expect(all[0]).toMatchObject({ nxrec: 1, id, label: 'merge test' })
    expect(all.slice(1, -1).map(e => e.id)).toEqual(['m1-1', 'r1-1', 'm1-2'])
    expect(all.at(-1)).toMatchObject({ end: true, status: 'finished', events: 3 })
    expect(info).toMatchObject({ id, status: 'finished', events: 3, label: 'merge test' })
  })

  it('starts and stops the main process runtime', async () => {
    rec.start()
    expect(runtime.started).toMatchObject({ proc: 'main' })
    await rec.stop()
    expect(runtime.stopped).toBeGreaterThan(0)
  })

  it('events from a window are redacted before they are written, and so are the main process\'s own', async () => {
    const { id } = rec.start()
    rec.add([enter('r1-1', 1_000_010, { proc: 'renderer', a: ['Bearer abcdefghijklmnop1234'] })], { win: 1 })
    runtime.queue.push(enter('m1-1', 1_000_020, { a: [{ password: 'pw-123456' }] }))
    await rec.stop()
    const text = readFileSync(fileOf(id), 'utf8')
    expect(text).not.toContain('abcdefghijklmnop1234')
    expect(text).not.toContain('pw-123456')
  })

  it('a denied call hides what it called, even when its child arrives in an earlier batch than its return', async () => {
    const { id } = rec.start()
    rec.add([enter('r1-1', 1_000_010, { fn: 'a.js:1:0:getAuthToken', proc: 'renderer', a: ['x'] })], { win: 1 })
    rec.add([enter('r1-2', 1_000_020, { fn: 'a.js:2:0:exchange', proc: 'renderer', p: 'r1-1', a: ['plain-looking-code'] })], { win: 1 })
    await rec.stop()
    expect(readFileSync(fileOf(id), 'utf8')).not.toContain('plain-looking-code')
  })

  it('starting twice throws; stopping when idle throws', async () => {
    rec.start()
    expect(() => rec.start()).toThrow(/already/)
    await rec.stop()
    await expect(rec.stop()).rejects.toThrow(/not recording/i)
  })

  it('status says what is happening, and onState is told when it changes', async () => {
    const seen = []
    const off = rec.onState(s => seen.push(s.recording))
    expect(rec.status()).toEqual({ recording: false })
    const { id } = rec.start()
    rec.add([enter('r1-1', 1_000_010, { proc: 'renderer' })], { win: 1 })
    expect(rec.status()).toMatchObject({ recording: true, id, events: 1, capped: false })
    await rec.stop(); off()
    expect(seen).toEqual([true, false])
  })

  it('events after stop are dropped', async () => {
    const { id } = rec.start()
    rec.add([enter('r1-1', 1_000_010, { proc: 'renderer' })], { win: 1 })
    await rec.stop()
    rec.add([enter('r1-2', 1_000_020, { proc: 'renderer' })], { win: 1 })
    expect(lines(fileOf(id)).filter(e => e.k === 'enter')).toHaveLength(1)
  })

  it('malformed events from a window are dropped without stopping the recording', async () => {
    const { id } = rec.start()
    rec.add([null, 'x', 7, {}, { k: 5 }, enter('r1-1', 1_000_010, { proc: 'renderer' })], { win: 1 })
    await rec.stop()
    expect(lines(fileOf(id)).filter(e => e.k === 'enter')).toHaveLength(1)
  })

  it('past maxBytes the recording stops itself, writes a cap event, and is listed as capped', async () => {
    const small = createRecorder({ dir, now: () => clock.t, runtime, flushMs: 1e9, horizonMs: 0, maxBytes: 1500 })
    const { id } = small.start()
    for (let i = 0; i < 40; i++) small.add([enter(`r1-${i}`, 990_000 + i, { proc: 'renderer', a: ['x'.repeat(100)] })], { win: 1 })
    await small.flush()
    expect(small.status()).toMatchObject({ recording: true, capped: true })
    const info = await small.stop()
    expect(info.status).toBe('capped')
    expect(lines(fileOf(id)).some(e => e.k === 'cap' && e.reason === 'bytes')).toBe(true)
    expect(createStore({ dir }).list()[0].status).toBe('capped')
    expect(readFileSync(fileOf(id)).length).toBeLessThan(2500)
  })

  it('an event a window stamps far in the future is not held back forever: it is written once the horizon has passed', async () => {
    const { id } = rec.start()
    rec.add([enter('r1-1', clock.t + 1e12, { proc: 'renderer' })], { win: 1 })
    clock.t += 2000
    await rec.flush()
    expect(lines(fileOf(id)).filter(e => e.k === 'enter').map(e => e.id)).toEqual(['r1-1'])
  })

  it('an event stamped before the recording began is placed at its start', async () => {
    const { id } = rec.start()
    rec.add([enter('r1-1', 5, { proc: 'renderer' })], { win: 1 })
    await rec.stop()
    expect(lines(fileOf(id)).find(e => e.k === 'enter').t).toBe(1_000_000)
  })

  it('what is waiting to be written counts against the size cap, so a flood cannot fill memory before a write', async () => {
    const small = createRecorder({ dir, now: () => clock.t, runtime, flushMs: 1e9, horizonMs: 1500, maxBytes: 1500 })
    small.start()
    for (let i = 0; i < 40; i++) small.add([enter(`r1-${i}`, 1_000_000, { proc: 'renderer', a: ['x'.repeat(100)] })], { win: 1 })
    expect(small.status().capped).toBe(true)   // no flush happened: the waiting events alone went past the cap
    await small.stop()
  })

  it('a single enormous event is dropped, not stored', async () => {
    const { id } = rec.start()
    rec.add([enter('r1-1', 1_000_010, { proc: 'renderer', a: ['y'.repeat(400000)] }), enter('r1-2', 1_000_020, { proc: 'renderer' })], { win: 1 })
    await rec.stop()
    expect(lines(fileOf(id)).filter(e => e.k === 'enter').map(e => e.id)).toEqual(['r1-2'])
  })

  it('events that fit are written even when the cap is reached by what came after them', async () => {
    const small = createRecorder({ dir, now: () => clock.t, runtime, flushMs: 1e9, horizonMs: 1500, maxBytes: 1500 })
    const { id } = small.start()
    for (let i = 0; i < 40; i++) small.add([enter(`r1-${i}`, 1_000_000, { proc: 'renderer', a: ['x'.repeat(100)] })], { win: 1 })
    await small.stop()
    const written = lines(fileOf(id)).filter(e => e.k === 'enter')
    expect(written.length).toBeGreaterThan(0)
    expect(written.length).toBeLessThan(40)
  })

  it('past maxEvents it is capped too', async () => {
    const few = createRecorder({ dir, now: () => clock.t, runtime, flushMs: 1e9, horizonMs: 0, maxEvents: 3 })
    few.start()
    few.add([1, 2, 3, 4, 5].map(i => enter(`r1-${i}`, 1_000_000 + i, { proc: 'renderer' })), { win: 1 })
    expect(few.status().capped).toBe(true)
    expect((await few.stop()).status).toBe('capped')
  })

  it('the runtime hitting its own cap caps the recording', async () => {
    const { id } = rec.start()
    runtime.onCap('events')
    expect(rec.status().capped).toBe(true)
    expect((await rec.stop()).status).toBe('capped')
    expect(id).toBeTruthy()
  })

  it('two recordings in a row get different files', async () => {
    const a = rec.start(); await rec.stop()
    const b = rec.start(); await rec.stop()
    expect(a.id).not.toBe(b.id)
    expect(readdirSync(dir).filter(n => n.endsWith('.nxrec'))).toHaveLength(2)
  })

  it('a folder that cannot be written fails start with a clear error and leaves nothing recording', () => {
    const bad = createRecorder({ dir: join(dir, 'file.txt', 'sub'), now: () => clock.t, runtime })
    require('node:fs').writeFileSync(join(dir, 'file.txt'), 'x')
    expect(() => bad.start()).toThrow(/could not start/i)
    expect(bad.status()).toEqual({ recording: false })
    expect(runtime.started).toBeNull()
  })
})

describe('the app quitting mid-recording', () => {
  it('close() writes what is waiting and leaves the file without an end line, so it is listed as unfinished and still reads', async () => {
    const { id } = rec.start('quit test')
    clock.t = 1_000_100
    rec.add([enter('r1-1', 1_000_050, { proc: 'renderer' })], { win: 1 })
    runtime.queue.push(enter('m1-1', 1_000_060))
    rec.close()
    expect(rec.status()).toEqual({ recording: false })
    const info = createStore({ dir }).list()[0]
    expect(info).toMatchObject({ id, status: 'unfinished', events: 2 })
    expect((await createStore({ dir }).read(id)).events.map(e => e.id)).toEqual(['r1-1', 'm1-1'])
  })

  it('close() when nothing is recording does nothing', () => {
    expect(() => rec.close()).not.toThrow()
  })
})

describe('the flush timer', () => {
  it('writes what is older than the horizon while recording, and the rest on stop', async () => {
    vi.useFakeTimers()
    try {
      const timed = createRecorder({ dir, now: () => clock.t, runtime, flushMs: 100, horizonMs: 1500 })
      const { id } = timed.start()
      clock.t += 10_000
      runtime.queue.push(enter('m1-1', clock.t - 5000), enter('m1-2', clock.t))
      await vi.advanceTimersByTimeAsync(150)
      const mid = lines(fileOf(id)).filter(e => e.k === 'enter').map(e => e.id)
      expect(mid).toEqual(['m1-1'])             // m1-2 is newer than the horizon: held back, in case an older one is still on its way
      await timed.stop()
      expect(lines(fileOf(id)).filter(e => e.k === 'enter').map(e => e.id)).toEqual(['m1-1', 'm1-2'])
    } finally { vi.useRealTimers() }
  })
})
