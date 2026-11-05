// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { createStore } = require('./store.cjs')

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nxt-store-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const header = (id, over = {}) => JSON.stringify({ nxrec: 1, id, label: 'a recording', startedAt: 1000, ...over })
const ev = (n) => JSON.stringify({ k: 'enter', id: `m1-${n}`, p: null, fn: 'x.js:1:0:f', a: [], t: 1000 + n, proc: 'main' })
const end = (events, status = 'finished') => JSON.stringify({ end: true, status, endedAt: 5000, events })
const write = (id, lines) => writeFileSync(join(dir, `${id}.nxrec`), lines.join('\n') + '\n')
const A = 'rec-20261105-101500-ab12'
const B = 'rec-20261105-111500-cd34'

describe('list and read', () => {
  it('lists newest first with label, times, event count, size and status', () => {
    write(A, [header(A, { startedAt: 1000 }), ev(1), ev(2), end(2)])
    write(B, [header(B, { startedAt: 2000, label: 'later' }), ev(1), end(1)])
    const list = createStore({ dir }).list()
    expect(list.map(i => i.id)).toEqual([B, A])
    expect(list[1]).toMatchObject({ id: A, label: 'a recording', startedAt: 1000, endedAt: 5000, events: 2, status: 'finished', version: 1 })
    expect(list[1].bytes).toBeGreaterThan(0)
  })

  it('a recording whose process died (no end line) is listed as unfinished and still reads', async () => {
    write(A, [header(A), ev(1), ev(2), '{"k":"enter","id":"m1-3","p":null,"fn":"x.js:1:'])   // the last line is torn
    const store = createStore({ dir })
    expect(store.list()[0]).toMatchObject({ id: A, status: 'unfinished', events: 2 })
    const { header: h, events } = await store.read(A)
    expect(h.id).toBe(A)
    expect(events).toHaveLength(2)
  })

  it('a capped recording is listed as capped', () => {
    write(A, [header(A), ev(1), JSON.stringify({ k: 'cap', t: 1, proc: 'main', reason: 'bytes' }), end(1, 'capped')])
    expect(createStore({ dir }).list()[0].status).toBe('capped')
  })

  it('an unreadable version is listed as unreadable and kept', async () => {
    write(A, [JSON.stringify({ nxrec: 99, id: A, label: 'from the future', startedAt: 1 }), '{"whatever":1}'])
    const store = createStore({ dir })
    expect(store.list()[0]).toMatchObject({ id: A, status: 'unreadable', version: 99 })
    await expect(store.read(A)).rejects.toThrow(/version 99/)
    expect(store.prune({ days: 0, now: Date.now() + 1e12 })).toBe(0)
    expect(existsSync(join(dir, `${A}.nxrec`))).toBe(true)
  })

  it('files that are not recordings, and a missing folder, are ignored', () => {
    writeFileSync(join(dir, 'notes.txt'), 'x')
    writeFileSync(join(dir, 'rec-bad.nxrec'), 'not json at all')
    expect(createStore({ dir }).list()).toEqual([])
    expect(createStore({ dir: join(dir, 'nope') }).list()).toEqual([])
  })

  it('refuses an id that could leave the folder', async () => {
    const store = createStore({ dir })
    await expect(store.read('../../etc/passwd')).rejects.toThrow(/not a recording id/)
    await expect(store.remove('..\\x')).rejects.toThrow(/not a recording id/)
  })
})

describe('remove, export, import', () => {
  it('remove deletes the file', async () => {
    write(A, [header(A), end(0)])
    const store = createStore({ dir })
    await store.remove(A)
    expect(store.list()).toEqual([])
  })

  it('export writes the bytes unchanged; import of that file lists the same recording', async () => {
    write(A, [header(A), ev(1), end(1)])
    const out = join(dir, 'copy.nxrec')
    const store = createStore({ dir })
    await store.exportTo(A, out)
    expect(readFileSync(out)).toEqual(readFileSync(join(dir, `${A}.nxrec`)))
    const other = mkdtempSync(join(tmpdir(), 'nxt-store2-'))
    try {
      const info = await createStore({ dir: other }).importFrom(out)
      expect(info).toMatchObject({ id: A, events: 1, status: 'finished' })
      expect(readFileSync(join(other, `${A}.nxrec`))).toEqual(readFileSync(out))
    } finally { rmSync(other, { recursive: true, force: true }) }
  })

  it('importing a recording that is already here does not make a second one', async () => {
    write(A, [header(A), end(0)])
    const store = createStore({ dir })
    await store.importFrom(join(dir, `${A}.nxrec`))
    expect(readdirSync(dir).filter(n => n.endsWith('.nxrec'))).toHaveLength(1)
  })

  it('import of garbage fails with a clear error and writes nothing', async () => {
    const bad = join(dir, 'garbage.bin')
    writeFileSync(bad, Buffer.from([0, 1, 2, 3, 250, 251]))
    const target = mkdtempSync(join(tmpdir(), 'nxt-store3-'))
    try {
      await expect(createStore({ dir: target }).importFrom(bad)).rejects.toThrow(/not a NexusMD recording/)
      writeFileSync(bad, '{"hello":"world"}\n')
      await expect(createStore({ dir: target }).importFrom(bad)).rejects.toThrow(/not a NexusMD recording/)
      expect(readdirSync(target)).toEqual([])
    } finally { rmSync(target, { recursive: true, force: true }) }
  })
})

describe('retention', () => {
  it('removes recordings older than the given days and keeps newer ones', () => {
    write(A, [header(A), end(0)]); write(B, [header(B), end(0)])
    const now = Date.now()
    utimesSync(join(dir, `${A}.nxrec`), new Date(now - 20 * 864e5), new Date(now - 20 * 864e5))
    const store = createStore({ dir })
    expect(store.prune({ days: 14, now })).toBe(1)
    expect(store.list().map(i => i.id)).toEqual([B])
  })
})
