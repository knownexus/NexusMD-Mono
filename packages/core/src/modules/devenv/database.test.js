import { describe, it, expect } from 'vitest'
import { normaliseBaselines, normaliseSqlScripts, buildDbArgv, DB_EDITOR_URL } from './database.js'

const ID = '20261013T120000Z-aaaaaaaa'

describe('normaliseBaselines', () => {
  it('keeps baselines with safe types', () => {
    const b = normaliseBaselines({ kind: 'db-baselines', latest: ID, baselines: [
      { id: ID, createdUtc: '2026-10-13T12:00:00Z', size: 2048, isLatest: true, databases: ['Orders_Local'], sourceContainer: 'sql-dev', valid: true },
      { id: 'bad id', size: 'x' }, null,
    ] })
    expect(b.latest).toBe(ID)
    expect(b.baselines).toEqual([{ id: ID, createdUtc: '2026-10-13T12:00:00Z', size: 2048, isLatest: true, databases: ['Orders_Local'], sourceContainer: 'sql-dev', valid: true }])
  })
  it('rejects other results', () => { expect(() => normaliseBaselines({ kind: 'x' })).toThrow('Not a devenv db-baselines result') })
})

describe('normaliseSqlScripts', () => {
  it('keeps scripts and the default database', () => {
    expect(normaliseSqlScripts({ kind: 'db-scripts', database: 'Orders_Local', scripts: [{ id: 'example', about: 'a script' }, { about: 'no id' }] }))
      .toEqual({ database: 'Orders_Local', scripts: [{ id: 'example', about: 'a script' }] })
    expect(normaliseSqlScripts({ kind: 'db-scripts', database: null, scripts: null })).toEqual({ database: null, scripts: [] })
  })
})

describe('buildDbArgv', () => {
  it('builds every action', () => {
    expect(buildDbArgv({ kind: 'start' })).toEqual(['db', 'start'])
    expect(buildDbArgv({ kind: 'stop' })).toEqual(['db', 'stop'])
    expect(buildDbArgv({ kind: 'backup' })).toEqual(['db', 'backup'])
    expect(buildDbArgv({ kind: 'verify' })).toEqual(['db', 'verify'])
    expect(buildDbArgv({ kind: 'ui' })).toEqual(['db', 'ui'])
    expect(buildDbArgv({ kind: 'ui-off' })).toEqual(['db', 'ui', '--off'])
    expect(buildDbArgv({ kind: 'restore' })).toEqual(['db', 'restore'])
    expect(buildDbArgv({ kind: 'restore', baseline: ID })).toEqual(['db', 'restore', '--baseline', ID])
    expect(buildDbArgv({ kind: 'sql', script: 'example', database: 'Orders_Local' })).toEqual(['db', 'sql', 'example', '--database', 'Orders_Local'])
    expect(buildDbArgv({ kind: 'sql', script: 'example' })).toEqual(['db', 'sql', 'example'])
  })
  it('refuses bad baselines, scripts and databases', () => {
    expect(() => buildDbArgv({ kind: 'restore', baseline: 'latest' })).toThrow()
    expect(() => buildDbArgv({ kind: 'sql', script: '-x' })).toThrow()
    expect(() => buildDbArgv({ kind: 'sql', script: 'a b' })).toThrow()
    expect(() => buildDbArgv({ kind: 'sql', script: 'ok', database: 'x;drop' })).toThrow()
    expect(() => buildDbArgv({ kind: 'drop' })).toThrow()
  })
  it('knows the DB editor address', () => { expect(DB_EDITOR_URL).toBe('http://127.0.0.1:14331') })
})
