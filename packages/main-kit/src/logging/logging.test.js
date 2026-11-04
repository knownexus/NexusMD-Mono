// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createLogHub, createElectronLogTransport, runWithCorrelation, redactString, redactValue } = require('./index.cjs')
const { argsToParts, normalizeLevel, isModuleId } = require('./entry.cjs')
const { prune } = require('./retention.cjs')

let dir, clock
const now = () => clock
const hubWith = (opts = {}) => createLogHub({ dir, now, flushMs: 5, fallback: { error: vi.fn() }, ...opts })
const readLines = (mod, file) => fs.readFileSync(path.join(dir, mod, file), 'utf8').trim().split('\n').map(l => JSON.parse(l))

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-log-'))
  clock = Date.parse('2026-11-04T12:00:00.000Z')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('entry helpers', () => {
  it('maps every level name onto error, warn, info or debug', () => {
    expect(['fatal', 'warning', 'log', 'verbose', 'silly', 'nonsense'].map(normalizeLevel)).toEqual(['error', 'warn', 'info', 'debug', 'debug', 'debug'])
  })
  it('only accepts module ids that are safe as a folder name', () => {
    expect(['git', 'api-client', 'core'].every(isModuleId)).toBe(true)
    expect(['', '../x', 'a/b', 'A', '.hidden', null].some(isModuleId)).toBe(false)
  })
  it('splits call arguments into message, error and data', () => {
    const e = Object.assign(new Error('boom'), { code: 'ENOENT' })
    expect(argsToParts(['push failed', 3, e, { a: 1 }])).toMatchObject({ msg: 'push failed 3', err: { name: 'Error', message: 'boom', code: 'ENOENT' }, data: { a: 1 } })
    expect(argsToParts([e]).msg).toBe('boom')
  })
})

describe('redaction', () => {
  it.each([
    ['mssql://sa:hunter2@db:1433/x', 'hunter2'],
    ['Server=db;User Id=sa;Password=hunter2;Encrypt=true', 'hunter2'],
    ['Authorization: Basic aHVudGVyMg==', 'aHVudGVyMg'],
    ['fetch failed with Bearer abcdef0123456789xyz', 'abcdef0123456789xyz'],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['{"password":"hunter2","user":"sa"}', 'hunter2'],
  ])('blanks the secret in %s', (text, secret) => {
    const out = redactString(text)
    expect(out).not.toContain(secret)
    expect(out).toContain('[redacted]')
  })
  it('keeps ordinary text', () => {
    expect(redactString('Could not open C:\\repos\\x.sql')).toBe('Could not open C:\\repos\\x.sql')
  })
  it('blanks secret-looking keys at any depth without mutating the input', () => {
    const input = { user: 'sa', config: { password: 'p', apiKey: 'k', nested: [{ Token: 't', ok: 1 }] } }
    const out = redactValue(input)
    expect(out).toEqual({ user: 'sa', config: { password: '[redacted]', apiKey: '[redacted]', nested: [{ Token: '[redacted]', ok: 1 }] } })
    expect(input.config.password).toBe('p')
  })
  it('survives circular data', () => {
    const a = { name: 'a' }
    a.self = a
    expect(redactValue(a)).toEqual({ name: 'a', self: '[circular]' })
  })
})

describe('log hub', () => {
  it('writes each module to its own daily JSON-lines file', () => {
    const hub = hubWith()
    hub.logger('git').error('push failed', new Error('rejected'), { remote: 'origin' })
    hub.logger('database').info('connected')
    hub.flush()
    const [git] = readLines('git', '2026-11-04.jsonl')
    expect(git).toMatchObject({ v: 1, lvl: 'error', mod: 'git', proc: 'main', msg: 'push failed', err: { message: 'rejected' }, data: { remote: 'origin' } })
    expect(git.ts).toBe('2026-11-04T12:00:00.000Z')
    expect(readLines('database', '2026-11-04.jsonl')[0]).toMatchObject({ mod: 'database', lvl: 'info', msg: 'connected' })
    expect(fs.existsSync(path.join(dir, 'core'))).toBe(false)
  })

  it('logs under core when the module id is not a safe name', () => {
    const hub = hubWith()
    hub.logger('../evil').warn('x')
    hub.flush()
    expect(readLines('core', '2026-11-04.jsonl')[0].mod).toBe('core')
    expect(fs.readdirSync(dir)).toEqual(['core'])
  })

  it('drops entries below the level, and the level can be raised at run time', () => {
    const hub = hubWith({ level: 'warn' })
    const log = hub.logger('git')
    log.info('quiet'); log.warn('loud')
    hub.setLevel('debug')
    log.verbose('now heard')
    hub.flush()
    expect(readLines('git', '2026-11-04.jsonl').map(e => e.msg)).toEqual(['loud', 'now heard'])
  })

  it('redacts before anything is written or handed to subscribers', () => {
    const hub = hubWith()
    const seen = []
    hub.subscribe(e => seen.push(e))
    hub.logger('database').error('connect failed: mssql://sa:hunter2@db/x', { config: { password: 'hunter2' } })
    hub.flush()
    const text = fs.readFileSync(path.join(dir, 'database', '2026-11-04.jsonl'), 'utf8')
    expect(text).not.toContain('hunter2')
    expect(JSON.stringify(seen)).not.toContain('hunter2')
  })

  it('links entries from different modules in one call chain by correlation id', async () => {
    const hub = hubWith()
    await runWithCorrelation(async () => {
      hub.logger('git').error('spawn failed')
      await new Promise(r => setTimeout(r, 1))
      await runWithCorrelation(async () => {
        await Promise.resolve()
        hub.logger('devenv').error('exited 1')
      }, { mod: 'devenv' })
    }, { mod: 'git' })
    hub.logger('work').info('unrelated')
    hub.flush()
    const [g] = readLines('git', '2026-11-04.jsonl')
    const [d] = readLines('devenv', '2026-11-04.jsonl')
    const [w] = readLines('work', '2026-11-04.jsonl')
    expect(g.cid).toMatch(/^c-/)
    expect(d.cid).toBe(g.cid)
    expect(w.cid).toBeUndefined()
    expect(hub.modulesOf(g.cid).sort()).toEqual(['devenv', 'git'])
  })

  it('collapses identical consecutive entries into one with a repeat count', () => {
    const hub = hubWith()
    const log = hub.logger('git')
    for (let i = 0; i < 5; i++) log.warn('index.lock exists')
    log.warn('something else')
    hub.flush()
    const lines = readLines('git', '2026-11-04.jsonl')
    expect(lines.map(l => [l.msg, l.rep])).toEqual([['index.lock exists', 5], ['something else', undefined]])
  })

  it('never collapses entries that carry an error', () => {
    const hub = hubWith()
    for (let i = 0; i < 3; i++) hub.logger('git').error('failed', new Error('same'))
    hub.flush()
    expect(readLines('git', '2026-11-04.jsonl')).toHaveLength(3)
  })

  it('rolls to a numbered file past the size limit', () => {
    const hub = hubWith({ maxFileBytes: 400 })
    for (let i = 0; i < 6; i++) hub.logger('git').info(`entry number ${i} ${'x'.repeat(60)}`)
    hub.flush()
    const files = fs.readdirSync(path.join(dir, 'git')).sort()
    expect(files.length).toBeGreaterThan(1)
    expect(files).toContain('2026-11-04.jsonl')
    expect(files).toContain('2026-11-04.1.jsonl')
    const all = files.flatMap(f => readLines('git', f))
    expect(all).toHaveLength(6)
  })

  it('starts a new file when the day changes', () => {
    const hub = hubWith()
    hub.logger('git').info('before midnight')
    hub.flush()
    clock = Date.parse('2026-11-05T00:00:01.000Z')
    hub.logger('git').info('after midnight')
    hub.flush()
    expect(fs.readdirSync(path.join(dir, 'git')).sort()).toEqual(['2026-11-04.jsonl', '2026-11-05.jsonl'])
  })

  it('gets errors to disk straight away, other entries on the timer', async () => {
    const hub = hubWith({ flushMs: 20 })
    hub.logger('git').error('crash')
    expect(readLines('git', '2026-11-04.jsonl')[0].msg).toBe('crash')
    hub.logger('git').info('later')
    expect(readLines('git', '2026-11-04.jsonl')).toHaveLength(1)
    await new Promise(r => setTimeout(r, 60))
    expect(readLines('git', '2026-11-04.jsonl')).toHaveLength(2)
  })

  it('keeps recent entries for the live tail and tells subscribers', () => {
    const hub = hubWith()
    const seen = []
    const off = hub.subscribe(e => seen.push(e.msg))
    hub.logger('git').info('one')
    off()
    hub.logger('git').info('two')
    expect(seen).toEqual(['one'])
    expect(hub.recent().map(e => e.msg)).toEqual(['one', 'two'])
  })

  it('never throws into the caller, even when the disk or a subscriber fails', () => {
    const fallback = { error: vi.fn() }
    const hub = hubWith({ fallback, dir: path.join(dir, 'file-not-folder') })
    fs.writeFileSync(path.join(dir, 'file-not-folder'), 'x')
    hub.subscribe(() => { throw new Error('subscriber bug') })
    expect(() => { hub.logger('git').error('still fine', new Error('x')); hub.flush() }).not.toThrow()
    expect(fallback.error).toHaveBeenCalled()
  })

  it('survives data it cannot serialise, and caps huge data', () => {
    const hub = hubWith()
    const loop = {}; loop.me = loop
    hub.logger('git').info('odd', loop, 10n)
    hub.logger('git').info('big', { blob: 'y'.repeat(20000) })
    hub.flush()
    const lines = readLines('git', '2026-11-04.jsonl')
    expect(lines[0].data).toEqual({ me: '[circular]' })
    expect(lines[1].data.truncated.length).toBeLessThanOrEqual(8192)
  })
})

describe('renderer ingest', () => {
  it('records a renderer entry for the module it names, marked as renderer', () => {
    const hub = hubWith()
    hub.ingest({ mod: 'database', lvl: 'error', msg: 'view crashed', err: { name: 'TypeError', message: 'x is undefined', stack: 'at y' }, scope: 'boundary' }, { win: 3 })
    hub.flush()
    expect(readLines('database', '2026-11-04.jsonl')[0]).toMatchObject({ proc: 'renderer', win: 3, lvl: 'error', scope: 'boundary', err: { name: 'TypeError' } })
  })

  it('does not trust the renderer: unknown modules become core, junk is ignored, ids must look like ours', () => {
    const hub = hubWith({ level: 'debug' })
    hub.ingest({ mod: '../../etc', lvl: 'bogus', msg: 'x', cid: 'not-valid' })
    expect(hub.ingest(null)).toBeNull()
    expect(hub.ingest('text')).toBeNull()
    hub.flush()
    const [e] = readLines('core', '2026-11-04.jsonl')
    expect(e).toMatchObject({ mod: 'core', lvl: 'debug', proc: 'renderer' })
    expect(e.cid).toBeUndefined()
  })

  it('rate-limits a noisy sender and says how many were dropped', () => {
    const hub = hubWith()
    for (let i = 0; i < 260; i++) hub.ingest({ mod: 'git', lvl: 'info', msg: `n${i}` }, { sender: 'w1' })
    clock += 1500
    hub.ingest({ mod: 'git', lvl: 'info', msg: 'after' }, { sender: 'w1' })
    hub.flush()
    expect(readLines('git', '2026-11-04.jsonl')).toHaveLength(201)
    const warn = readLines('core', '2026-11-04.jsonl')[0]
    expect(warn.msg).toMatch(/60 renderer log entries from w1 were dropped/)
  })
})

describe('electron-log transport', () => {
  it('routes what electron-log receives into the hub, under the module of the call chain', async () => {
    const hub = hubWith()
    const transport = createElectronLogTransport(hub)
    expect(transport.level).toBe('silly')
    transport({ level: 'warn', scope: 'apps', data: ['app "api-client" failed to start', new Error('ENOENT')] })
    await runWithCorrelation(async () => { transport({ level: 'info', data: ['from inside git'] }) }, { mod: 'git' })
    hub.flush()
    expect(readLines('core', '2026-11-04.jsonl')[0]).toMatchObject({ lvl: 'warn', scope: 'apps', msg: 'app "api-client" failed to start', err: { message: 'ENOENT' } })
    expect(readLines('git', '2026-11-04.jsonl')[0].msg).toBe('from inside git')
  })
})

describe('retention', () => {
  const put = (rel, size, ageDays) => {
    const file = path.join(dir, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'x'.repeat(size))
    return file
  }

  it('removes files older than the window, from modules and the legacy flat logs', () => {
    put('git/2026-10-01.jsonl', 10)
    put('git/2026-11-03.jsonl', 10)
    put('2026-10-01.log', 10)
    put('2026-10-01.old.log', 10)
    put('2026-11-03.log', 10)
    put('notes.txt', 10)
    const { deleted } = prune({ dir, days: 14, now: clock })
    expect(deleted.map(f => path.relative(dir, f).replace(/\\/g, '/')).sort()).toEqual(['2026-10-01.log', '2026-10-01.old.log', 'git/2026-10-01.jsonl'])
    expect(fs.existsSync(path.join(dir, 'notes.txt'))).toBe(true)
  })

  it('trims a module over the size cap, oldest first, keeping the newest file', () => {
    put('git/2026-11-01.jsonl', 100)
    put('git/2026-11-02.jsonl', 100)
    put('git/2026-11-03.jsonl', 100)
    put('work/2026-11-01.jsonl', 100)
    prune({ dir, days: 14, maxBytes: 150, now: clock })
    expect(fs.readdirSync(path.join(dir, 'git'))).toEqual(['2026-11-03.jsonl'])
    expect(fs.readdirSync(path.join(dir, 'work'))).toEqual(['2026-11-01.jsonl'])
  })

  it('does nothing before the logs folder exists', () => {
    expect(prune({ dir: path.join(dir, 'nope'), now: clock })).toEqual({ deleted: [] })
  })
})
