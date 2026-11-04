// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createLogHub, runWithCorrelation } = require('./index.cjs')
const { createLogReader } = require('./reader.cjs')

let dir, clock, hub, reader
const now = () => clock
const at = iso => { clock = Date.parse(iso) }

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-read-'))
  at('2026-11-04T12:00:00.000Z')
  hub = createLogHub({ dir, now, flushMs: 5, level: 'debug', fallback: { error: vi.fn() } })
  reader = createLogReader({ dir, beforeRead: () => hub.flush() })
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('log reader: modules', () => {
  it('lists the modules that have logs, core first, with their days newest first', () => {
    hub.logger('git').info('a')
    hub.logger('core').info('b')
    at('2026-11-05T09:00:00.000Z')
    hub.logger('git').info('c')
    fs.writeFileSync(path.join(dir, '2026-11-04.log'), 'old flat file') // not a module
    fs.mkdirSync(path.join(dir, 'Not A Module'))                         // not a valid id
    const mods = reader.modules()
    expect(mods.map(m => m.mod)).toEqual(['core', 'git'])
    expect(mods[1].days.map(d => d.date)).toEqual(['2026-11-05', '2026-11-04'])
    expect(mods[1].days[0].size).toBeGreaterThan(0)
  })

  it('is empty before anything has been logged', () => {
    expect(createLogReader({ dir: path.join(dir, 'nope') }).modules()).toEqual([])
  })
})

describe('log reader: query', () => {
  beforeEach(() => {
    hub.logger('git').error('push failed', new Error('rejected'))
    at('2026-11-04T12:00:01.000Z'); hub.logger('git').info('fetched origin')
    at('2026-11-04T12:00:02.000Z'); hub.logger('work').warn('token expires soon', { account: 'a' })
    at('2026-11-04T12:00:03.000Z'); hub.logger('core').debug('tick')
  })

  it('merges modules in time order and says nothing was cut off', () => {
    const r = reader.query({ date: '2026-11-04' })
    expect(r.entries.map(e => e.msg)).toEqual(['push failed', 'fetched origin', 'token expires soon', 'tick'])
    expect(r.truncated).toBe(false)
  })

  it('filters by module, level, and text (message, error and data)', () => {
    expect(reader.query({ date: '2026-11-04', mods: ['git'] }).entries.map(e => e.msg)).toEqual(['push failed', 'fetched origin'])
    expect(reader.query({ date: '2026-11-04', levels: ['error', 'warn'] }).entries.map(e => e.msg)).toEqual(['push failed', 'token expires soon'])
    expect(reader.query({ date: '2026-11-04', text: 'REJECTED' }).entries.map(e => e.msg)).toEqual(['push failed'])
    expect(reader.query({ date: '2026-11-04', text: 'account' }).entries.map(e => e.msg)).toEqual(['token expires soon'])
  })

  it('keeps the newest entries when there are more than the limit', () => {
    const r = reader.query({ date: '2026-11-04', limit: 2 })
    expect(r.entries.map(e => e.msg)).toEqual(['token expires soon', 'tick'])
    expect(r.truncated).toBe(true)
  })

  it('reads only the day asked for', () => {
    at('2026-11-05T01:00:00.000Z'); hub.logger('git').info('next day')
    expect(reader.query({ date: '2026-11-05' }).entries.map(e => e.msg)).toEqual(['next day'])
  })

  it('ignores a torn or corrupt line and reports how many', () => {
    hub.flush()
    fs.appendFileSync(path.join(dir, 'git', '2026-11-04.jsonl'), '{"v":1,"ts":"2026-11-04T12:00:09.0')
    const r = reader.query({ date: '2026-11-04', mods: ['git'] })
    expect(r.entries).toHaveLength(2)
    expect(r.skipped).toBe(1)
  })

  it('ignores a module or date that could point outside the log folder', () => {
    expect(reader.query({ date: '2026-11-04', mods: ['../x', 'git'] }).entries.map(e => e.mod)).toEqual(['git', 'git'])
    expect(() => reader.query({ date: '../../etc' })).not.toThrow()
    expect(reader.query({ date: '../../etc' }).entries).toEqual([])
  })
})

describe('log reader: follow one call across modules', () => {
  it('returns every module\'s entries for a correlation id, on any day, in order', async () => {
    let cid
    await runWithCorrelation(async () => {
      hub.logger('core').info('handler started')
      cid = require('./index.cjs').currentCorrelation().cid
      at('2026-11-04T12:00:01.000Z')
      await runWithCorrelation(async () => { hub.logger('git').error('spawn failed') }, { mod: 'git' })
      at('2026-11-05T00:00:01.000Z') // the chain ran across midnight
      await runWithCorrelation(async () => { hub.logger('devenv').error('exited 1') }, { mod: 'devenv' })
    }, { mod: 'core' })
    hub.logger('work').info('unrelated')

    const r = reader.follow(cid)
    expect(r.entries.map(e => `${e.mod}:${e.msg}`)).toEqual(['core:handler started', 'git:spawn failed', 'devenv:exited 1'])
    expect(r.modules).toEqual(['core', 'git', 'devenv'])
    expect(r.entries[2].via).toEqual(['core'])
  })

  it('rejects anything that is not a correlation id', () => {
    expect(reader.follow('../x').entries).toEqual([])
    expect(reader.follow(undefined).entries).toEqual([])
  })
})
